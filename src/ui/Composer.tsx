import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import type { FileInfo, Person } from "../shared/types.js";
import { byName, find } from "../shared/emoji.js";
import { maxFiles, maxText, maxUpload, normalize } from "../shared/rules.js";
import { size } from "../shared/format.js";
import { post, upload } from "./api.js";
import { draftKey, type Shown } from "./store.js";
import { nameOf, titleOf, useActions, useSnapshot, useStore, useWords } from "./context.js";
import { Avatar, Icon } from "./bits.js";
import { EmojiPicker } from "./EmojiPicker.js";

// What a member writes: a message, a reply, or an edit. Mentions are
// written as names and sent as tokens; ":name:" becomes its emoji; files go
// to the Chest as they are added; what is written is kept as a draft on
// every device.

type Upload = { key: string; file: File; progress: number; object: string | null; failed: boolean; preview: string | null; abort: AbortController };
type Suggestion = { kind: "person" | "special" | "channel" | "emoji"; value: string; label: string; detail?: string; person?: Person };

// Names the composer shows, and the tokens they stand for.
type Names = Map<string, string>;

// display turns a stored text (tokens) into what the composer shows
// (names), noting each name's token.
function display(text: string, names: Names, person: (id: string) => string, channel: (id: number) => string | null): string {
  return text.replace(/<(@mbr_[a-z2-7]{26}|#[1-9][0-9]{0,17}|!channel|!here)>/gu, (token, body: string) => {
    if (body === "!channel" || body === "!here") return "@" + body.slice(1);
    const shown = body.startsWith("@") ? "@" + person(body.slice(1)) : channel(Number(body.slice(1))) ? "#" + channel(Number(body.slice(1))) : null;
    if (!shown) return token;
    names.set(shown, token);
    return shown;
  });
}

// tokens turns what the composer shows into the stored text.
function tokens(text: string, names: Names, specials: boolean): string {
  let out = text;
  for (const [shown, token] of [...names].sort((x, y) => y[0].length - x[0].length)) out = out.split(shown).join(token);
  if (specials) out = out.replace(/(^|[\s(])@(channel|here)\b/gu, "$1<!$2>");
  return out.replace(/:([a-z0-9_+-]{2,32}):/gu, (all, name: string) => byName(name) ?? all);
}

export function Composer({ conversation, thread, editing }: { conversation: number; thread: number | null; editing?: Shown }) {
  const w = useWords();
  const a = useActions();
  const snapshot = useSnapshot();
  const viewing = useStore(s => (s.viewing?.id === conversation ? s.viewing : s.conversations.find(c => c.id === conversation) ?? null));
  const people = useStore(s => s.people);
  const me = useStore(s => s.me.id);
  const locked = useStore(s => s.locked);
  const names = useRef<Names>(new Map());
  const channelName = (id: number) => snapshot().conversations.find(c => c.id === id && c.kind !== "direct")?.name ?? null;
  const personName = (id: string) => nameOf(snapshot().people[id], w);
  const [text, setText] = useState(() => display(editing ? editing.text ?? "" : snapshot().drafts[draftKey(conversation, thread)] ?? "", names.current, personName, channelName));
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [suggest, setSuggest] = useState<{ start: number; items: Suggestion[]; at: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listId = useId();
  const searchSeq = useRef(0);
  const specials = viewing?.kind !== "direct";

  // The box grows with what is written, to a third of the screen.
  useLayoutEffect(() => {
    const t = area.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, Math.max(120, window.innerHeight / 3))}px`;
  }, [text]);
  useEffect(() => { if (editing) { area.current?.focus(); area.current?.setSelectionRange(text.length, text.length); } }, []);
  // The draft follows the conversation: another conversation, its own.
  const key = draftKey(conversation, thread);
  const shownKey = useRef(key);
  useEffect(() => {
    if (shownKey.current === key || editing) return;
    shownKey.current = key;
    names.current = new Map();
    setText(display(snapshot().drafts[key] ?? "", names.current, personName, channelName));
    setUploads([]);
    setSuggest(null);
  }, [key]);

  const over = tokens(text, names.current, specials).length - maxText;
  const busy = uploads.some(u => !u.object && !u.failed);
  const ready = uploads.filter(u => u.object);
  const canSend = !locked && over <= 0 && !busy && (text.trim().length > 0 || ready.length > 0);

  const change = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    setError(null);
    if (!editing) {
      a.keepDraft(conversation, thread, tokens(value, names.current, specials));
      if (value.trim()) a.typing(conversation, thread);
    }
    void lookFor(value, e.target.selectionStart);
  };

  // lookFor offers people, channels or emoji for what is typed at the caret.
  const lookFor = async (value: string, caret: number) => {
    const m = /(^|[\s(])([@#:])([^\s@#:]{0,40})$/u.exec(value.slice(0, caret));
    if (!m) return setSuggest(null);
    const [, , trigger, q] = m as unknown as [string, string, string, string];
    const start = caret - q.length - 1;
    const seq = ++searchSeq.current;
    const lower = normalize(q);
    if (trigger === ":") {
      if (q.length < 2) return setSuggest(null);
      return setSuggest({ start, at: 0, items: find(q, 8).map(e => ({ kind: "emoji", value: e.emoji, label: `:${e.name}:` })) });
    }
    if (trigger === "#") {
      const items = snapshot().conversations.filter(c => c.kind !== "direct" && c.name!.includes(lower)).slice(0, 8).map((c): Suggestion => ({ kind: "channel", value: String(c.id), label: `#${c.name}` }));
      return setSuggest(items.length ? { start, at: 0, items } : null);
    }
    const known = Object.values(snapshot().people).filter(p => p.status === "member" && normalize(p.name).split(" ").some(part => part.startsWith(lower)));
    const special: Suggestion[] = specials ? (["here", "channel"] as const).filter(s => s.startsWith(lower)).map(s => ({ kind: "special", value: s, label: `@${s}`, detail: s === "here" ? w.everyoneHere : w.everyoneChannel })) : [];
    const offer = (list: Person[]) => setSuggest({ start, at: 0, items: [...list.slice(0, 8).map((p): Suggestion => ({ kind: "person", value: p.id, label: p.name, person: p, ...(p.id === me ? { detail: w.youSuffix } : {}) })), ...special] });
    offer(known);
    if (q.length >= 1) {
      try {
        const found = await a.people(q);
        if (seq !== searchSeq.current) return;
        const merged = [...new Map([...known, ...found].map(p => [p.id, p])).values()];
        offer(merged);
      } catch { /* the names already known are offered */ }
    }
  };

  const choose = (s: Suggestion) => {
    const t = area.current!;
    const caret = t.selectionStart;
    let insert: string;
    if (s.kind === "emoji") insert = s.value;
    else if (s.kind === "special") insert = `@${s.value}`;
    else if (s.kind === "channel") {
      insert = s.label;
      names.current.set(insert, `<#${s.value}>`);
    } else {
      insert = `@${s.label}`;
      names.current.set(insert, `<@${s.value}>`);
    }
    const next = text.slice(0, suggest!.start) + insert + " " + text.slice(caret);
    setText(next);
    setSuggest(null);
    if (!editing) a.keepDraft(conversation, thread, tokens(next, names.current, specials));
    requestAnimationFrame(() => {
      const at = suggest!.start + insert.length + 1;
      t.focus();
      t.setSelectionRange(at, at);
    });
  };

  const send = async () => {
    if (!canSend) {
      if (over > 0) setError(w.tooLong(over));
      return;
    }
    const value = tokens(text, names.current, specials).trim();
    if (editing) {
      await a.edit(editing.id, value);
      return;
    }
    const files = ready.map(u => ({ object: u.object!, name: u.file.name, info: infoOf(u) }));
    setText("");
    names.current = new Map();
    uploads.forEach(u => { if (u.preview) URL.revokeObjectURL(u.preview); });
    setUploads([]);
    setSuggest(null);
    a.stopTyping();
    await a.send(conversation, thread, value, files);
  };

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (suggest) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = suggest.items.length;
        setSuggest({ ...suggest, at: (suggest.at + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = suggest.items[suggest.at];
        if (s) choose(s);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSuggest(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      // Enter in an open code block breaks the line.
      const before = text.slice(0, e.currentTarget.selectionStart);
      if ((before.match(/```/gu)?.length ?? 0) % 2 === 1) return;
      e.preventDefault();
      void send();
      return;
    }
    if (e.key === "Escape" && editing) { e.preventDefault(); e.stopPropagation(); a.setEditing(null); return; }
    if (e.key === "ArrowUp" && !text && !editing) {
      const s = snapshot();
      const list = thread === null ? s.page?.messages ?? [] : s.thread?.replies ?? [];
      const last = [...list].reverse().find(m => m.author === me && m.kind === "message" && !m.deleted && m.id > 0 && m.text !== null);
      if (last) { e.preventDefault(); a.setEditing(last.id); }
    }
  };

  // Files: each goes to the Chest as soon as it is added.
  const add = (list: FileList | File[]) => {
    const chosen = [...list];
    if (uploads.length + chosen.length > maxFiles) { setError(w.tooManyFiles); return; }
    for (const file of chosen) {
      if (file.size > maxUpload) { setError(w.tooLarge(file.name)); continue; }
      const u: Upload = { key: `${Date.now()}${Math.random()}`, file, progress: 0, object: null, failed: false, preview: /^image\//u.test(file.type) ? URL.createObjectURL(file) : null, abort: new AbortController() };
      setUploads(all => [...all, u]);
      void (async () => {
        const update = (change: Partial<Upload>) => setUploads(all => all.map(x => (x.key === u.key ? { ...x, ...change } : x)));
        try {
          const target = await post<{ url: string }>("/uploads", { conversation, size: file.size });
          const object = await upload(target.url, file, progress => update({ progress }), u.abort.signal);
          update({ object, progress: 1 });
        } catch {
          if (!u.abort.signal.aborted) {
            update({ failed: true });
            setError(w.uploadFailed(file.name));
          }
        }
      })();
    }
  };
  const drop = (u: Upload) => {
    u.abort.abort();
    if (u.preview) URL.revokeObjectURL(u.preview);
    setUploads(all => all.filter(x => x.key !== u.key));
  };

  const placeholder = editing ? "" : thread !== null ? w.replyPlaceholder : viewing ? w.messageTo(viewing.kind === "direct" ? titleOf(viewing, people, me, w) : `#${viewing.name}`) : "";
  const active = suggest ? `${listId}-${suggest.at}` : undefined;

  return (
    <div className={editing ? "composer editing" : "composer"}
      onDragOver={(e: DragEvent) => { if (!editing && e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e: DragEvent) => { if (!editing && e.dataTransfer.files.length) { e.preventDefault(); add(e.dataTransfer.files); } }}>
      {suggest ? (
        <ul className="suggestions" role="listbox" id={listId} aria-label={w.suggestions}>
          {suggest.items.map((s, i) => (
            <li key={`${s.kind}${s.value}`} id={`${listId}-${i}`} role="option" aria-selected={i === suggest.at}
              onPointerDown={e => { e.preventDefault(); choose(s); }}>
              {s.person ? <Avatar person={s.person} size={20} /> : s.kind === "emoji" ? <span className="suggest-emoji">{s.value}</span> : null}
              <span>{s.label}</span>
              {s.detail ? <span className="detail">{s.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {uploads.length ? (
        <ul className="uploads">
          {uploads.map(u => (
            <li key={u.key} className={u.failed ? "failed" : u.object ? "done" : "sending"}>
              {u.preview ? <img src={u.preview} alt="" width={40} height={40} /> : <Icon name="file" size={20} />}
              <span className="file-name">{u.file.name}</span>
              <span className="file-size">{u.object || u.failed ? size(u.file.size, w) : `${Math.round(u.progress * 100)} %`}</span>
              {!u.object && !u.failed ? <progress value={u.progress} max={1} aria-label={w.uploading} /> : null}
              <button type="button" className="icon-button" aria-label={w.removeFile(u.file.name)} onClick={() => drop(u)}><Icon name="close" size={14} /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea ref={area} value={text} onChange={change} onKeyDown={keys} rows={1} placeholder={placeholder} aria-label={placeholder || w.edit}
        disabled={locked} role="combobox" aria-autocomplete="list" aria-expanded={!!suggest} aria-controls={suggest ? listId : undefined} aria-activedescendant={active}
        onPaste={(e: ClipboardEvent) => { if (!editing && e.clipboardData.files.length) { e.preventDefault(); add(e.clipboardData.files); } }}
        onClick={e => void lookFor(text, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setSuggest(null), 100)} />
      {error ? <p className="composer-error" role="alert">{error}</p> : null}
      <div className="composer-bar">
        {editing ? (
          <>
            <span className="hint">{w.editHint}</span>
            <span className="grow" />
            <button type="button" className="button quiet" onClick={() => a.setEditing(null)}>{w.cancel}</button>
            <button type="button" className="button" onClick={() => void send()} disabled={!canSend}>{w.saveEdit}</button>
          </>
        ) : (
          <>
            <button type="button" className="icon-button" aria-label={w.attach} title={w.attach} onClick={() => fileInput.current?.click()} disabled={locked}><Icon name="clip" /></button>
            <input ref={fileInput} type="file" multiple hidden onChange={e => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
            <span className="picker-anchor">
              <button type="button" className="icon-button" aria-label={w.emoji} title={w.emoji} onClick={() => setPicking(true)} disabled={locked}><Icon name="smile" /></button>
              {picking ? <EmojiPicker onClose={() => { setPicking(false); area.current?.focus(); }} onPick={e => {
                const t = area.current!;
                const at = t.selectionStart;
                setText(text.slice(0, at) + e + text.slice(t.selectionEnd));
                setPicking(false);
                requestAnimationFrame(() => { t.focus(); t.setSelectionRange(at + e.length, at + e.length); });
              }} /> : null}
            </span>
            <span className="hint">{w.formatting}</span>
            <span className="grow" />
            <button type="button" className="send" aria-label={w.send} title={w.send} onClick={() => void send()} disabled={!canSend}><Icon name="send" /></button>
          </>
        )}
      </div>
    </div>
  );
}

function infoOf(u: Upload): FileInfo {
  return { id: 0, name: u.file.name, type: u.file.type || "application/octet-stream", size: u.file.size, width: null, height: null };
}

