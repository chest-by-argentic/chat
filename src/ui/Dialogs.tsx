import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { Conversation, Person } from "../shared/types.js";
import { channelName, maxAbout, normalize } from "../shared/rules.js";
import { ApiError } from "./api.js";
import type { Dialog } from "./store.js";
import { titleOf, useActions, useStore, useWords } from "./context.js";
import { Avatar, Icon, Presence } from "./bits.js";

// The dialogs of the page: one at a time, modal, Escape closes, the focus
// returns where it was.
export function Dialogs() {
  const dialog = useStore(s => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case "switcher": return <Switcher />;
    case "create": return <CreateChannel />;
    case "direct": return <NewDirect />;
    case "browse": return <Browse />;
    case "add": return <AddPeople conversation={dialog.conversation} />;
    case "shortcuts": return <Shortcuts />;
    case "confirm": return <Confirm dialog={dialog} />;
  }
}

function Modal({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const a = useActions();
  const back = useRef<Element | null>(null);
  return (
    <dialog className={`modal ${className ?? ""}`} aria-label={label}
      ref={d => {
        if (d && !d.open) {
          back.current = document.activeElement;
          d.showModal();
        }
      }}
      onClose={() => { a.openDialog(null); (back.current as HTMLElement | null)?.focus?.(); }}
      onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

function Head({ title }: { title: string }) {
  const w = useWords();
  return (
    <header className="modal-head">
      <h2>{title}</h2>
      <form method="dialog"><button className="icon-button" aria-label={w.close} title={w.close}><Icon name="close" /></button></form>
    </header>
  );
}

const close = (from: HTMLElement | null) => from?.closest("dialog")?.close();

// Switcher: Cmd-K, a conversation or a person by name.
function Switcher() {
  const w = useWords();
  const a = useActions();
  const conversations = useStore(s => s.conversations);
  const people = useStore(s => s.people);
  const me = useStore(s => s.me.id);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [at, setAt] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!q.trim()) return setFound([]);
    const timer = setTimeout(() => { void a.people(q.trim()).then(setFound, () => setFound([])); }, 120);
    return () => clearTimeout(timer);
  }, [q]);
  type Item = { key: string; label: string; detail: string; icon: ReactNode; run: () => void };
  const items: Item[] = useMemo(() => {
    const t = normalize(q.trim());
    const mine = conversations
      .map(c => ({ c, title: titleOf(c, people, me, w) }))
      .filter(x => !t || normalize(x.title).includes(t))
      .sort((x, y) => (y.c.unread > 0 ? 1 : 0) - (x.c.unread > 0 ? 1 : 0) || (y.c.lastMessageAt ?? "").localeCompare(x.c.lastMessageAt ?? ""))
      .slice(0, 12)
      .map(({ c, title }): Item => ({
        key: `c${c.id}`, label: c.kind === "direct" ? title : `#${title}`, detail: c.kind === "private" ? w.privateChannel : c.kind === "public" ? w.publicChannel : w.directLabel,
        icon: c.kind === "direct" ? <Avatar person={people[c.people.find(p => p !== me) ?? me]} size={20} /> : <Icon name={c.kind === "private" ? "lock" : "hash"} size={16} />,
        run: () => void a.go({ view: "conversation", id: c.id, thread: null, message: null }),
      }));
    const directs = new Set(conversations.filter(c => c.kind === "direct" && c.people.length === 2).map(c => c.people.find(p => p !== me)));
    const others = found.filter(p => !directs.has(p.id)).slice(0, 8).map((p): Item => ({
      key: `p${p.id}`, label: p.name, detail: w.directLabel, icon: <Avatar person={p} size={20} />,
      run: () => void a.direct(p.id === me ? [] : [p.id]).catch(a.fail),
    }));
    return [...mine, ...others];
  }, [q, found, conversations, people]);
  useEffect(() => setAt(0), [q]);
  const keys = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((at + 1) % Math.max(items.length, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((at - 1 + items.length) % Math.max(items.length, 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const item = items[at]; if (item) { close(input.current); item.run(); } }
  };
  return (
    <Modal label={w.switcherLabel} className="switcher">
      <div className="switcher-input">
        <Icon name="search" />
        <input ref={input} autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={keys} placeholder={w.jumpTo} aria-label={w.switcherLabel}
          role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={items[at] ? `${listId}-${at}` : undefined} />
      </div>
      <ul className="switcher-list" role="listbox" id={listId} aria-label={w.switcherLabel}>
        {items.map((item, i) => (
          <li key={item.key} id={`${listId}-${i}`} role="option" aria-selected={i === at} onPointerDown={e => e.preventDefault()}
            onClick={() => { close(input.current); item.run(); }} onPointerMove={() => setAt(i)}>
            {item.icon}<span className="grow">{item.label}</span><span className="detail">{item.detail}</span>
          </li>
        ))}
      </ul>
      {!items.length ? <p className="empty">{w.switcherEmpty}</p> : null}
      <p className="hint">{w.switcherHint}</p>
    </Modal>
  );
}

// PeoplePicker chooses people (and groups, when offered) by name.
function PeoplePicker({ chosen, setChosen, groups, chosenGroups, setChosenGroups, exclude, label, autoFocus }: {
  chosen: Person[]; setChosen: (p: Person[]) => void; groups?: { id: string; name: string; size: number }[];
  chosenGroups?: string[]; setChosenGroups?: (g: string[]) => void; exclude: string[]; label: string; autoFocus?: boolean;
}) {
  const w = useWords();
  const a = useActions();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [at, setAt] = useState(0);
  const listId = useId();
  useEffect(() => {
    if (!q.trim()) return setFound([]);
    const timer = setTimeout(() => { void a.people(q.trim()).then(setFound, () => setFound([])); }, 120);
    return () => clearTimeout(timer);
  }, [q]);
  const t = normalize(q.trim());
  const groupItems = t && groups ? groups.filter(g => normalize(g.name).includes(t) && !chosenGroups?.includes(g.id)) : [];
  const personItems = found.filter(p => !chosen.some(c => c.id === p.id) && !exclude.includes(p.id));
  const total = groupItems.length + personItems.length;
  const pick = (i: number) => {
    if (i < groupItems.length) setChosenGroups?.([...(chosenGroups ?? []), groupItems[i]!.id]);
    else if (personItems[i - groupItems.length]) setChosen([...chosen, personItems[i - groupItems.length]!]);
    setQ("");
    setAt(0);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && total) { e.preventDefault(); setAt((at + 1) % total); }
    else if (e.key === "ArrowUp" && total) { e.preventDefault(); setAt((at - 1 + total) % total); }
    else if (e.key === "Enter" && total) { e.preventDefault(); pick(at); }
    else if (e.key === "Backspace" && !q) {
      if (chosen.length) setChosen(chosen.slice(0, -1));
      else if (chosenGroups?.length) setChosenGroups?.(chosenGroups.slice(0, -1));
    }
  };
  return (
    <div className="picker">
      <div className="chips">
        {(chosenGroups ?? []).map(id => {
          const g = groups?.find(x => x.id === id);
          return <span key={id} className="chip"><Icon name="people" size={14} />{g?.name}<button type="button" aria-label={`${w.remove} ${g?.name ?? ""}`} onClick={() => setChosenGroups?.((chosenGroups ?? []).filter(x => x !== id))}><Icon name="close" size={12} /></button></span>;
        })}
        {chosen.map(p => <span key={p.id} className="chip"><Avatar person={p} size={20} />{p.name}<button type="button" aria-label={`${w.remove} ${p.name}`} onClick={() => setChosen(chosen.filter(x => x.id !== p.id))}><Icon name="close" size={12} /></button></span>)}
        <input value={q} onChange={e => { setQ(e.target.value); setAt(0); }} onKeyDown={keys} placeholder={label} aria-label={label} autoFocus={autoFocus}
          role="combobox" aria-expanded={total > 0} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={total ? `${listId}-${at}` : undefined} />
      </div>
      {q.trim() ? (
        <ul className="picker-list" role="listbox" id={listId} aria-label={label}>
          {groupItems.map((g, i) => (
            <li key={g.id} id={`${listId}-${i}`} role="option" aria-selected={i === at} onPointerDown={e => e.preventDefault()} onClick={() => pick(i)}>
              <Icon name="people" size={20} /><span className="grow">{g.name}</span><span className="detail">{w.groupMembers(g.size)}</span>
            </li>
          ))}
          {personItems.map((p, j) => (
            <li key={p.id} id={`${listId}-${groupItems.length + j}`} role="option" aria-selected={groupItems.length + j === at} onPointerDown={e => e.preventDefault()} onClick={() => pick(groupItems.length + j)}>
              <span className="row-avatar"><Avatar person={p} size={20} /><Presence id={p.id} /></span><span className="grow">{p.name}</span>
            </li>
          ))}
          {!total ? <li className="empty" role="option" aria-selected="false" aria-disabled="true">{w.noPeople}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function CreateChannel() {
  const w = useWords();
  const a = useActions();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [kind, setKind] = useState<"public" | "private">("public");
  const [chosen, setChosen] = useState<Person[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; size: number }[]>([]);
  const [chosenGroups, setChosenGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const me = useStore(s => s.me.id);
  useEffect(() => { void a.groups().then(setGroups, () => setGroups([])); }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!channelName.test(name)) return setError(w.nameInvalid);
    setBusy(true);
    try {
      await a.create({ kind, name, ...(about.trim() ? { about: about.trim() } : {}), members: chosen.map(p => p.id), groups: chosenGroups });
      close(form);
    } catch (error) {
      setError(error instanceof ApiError && error.code === "name_taken" ? w.nameTaken : w.failed);
    } finally { setBusy(false); }
  };
  return (
    <Modal label={w.createTitle}>
      <Head title={w.createTitle} />
      <form onSubmit={e => void submit(e)} className="form">
        <label className="field">
          <span>{w.nameLabel}</span>
          <span className="prefixed"><span aria-hidden="true">#</span><input autoFocus value={name} onChange={e => { setName(e.target.value.toLowerCase().replace(/\s+/gu, "-")); setError(null); }} maxLength={80} required aria-describedby="name-hint" aria-invalid={!!error} /></span>
          <span id="name-hint" className={error ? "error" : "muted"} role={error ? "alert" : undefined}>{error ?? w.nameHint}</span>
        </label>
        <label className="field">
          <span>{w.about}</span>
          <textarea value={about} onChange={e => setAbout(e.target.value)} maxLength={maxAbout} rows={2} placeholder={w.aboutPlaceholder} />
        </label>
        <fieldset className="choices">
          <legend>{w.visibility}</legend>
          <label><input type="radio" name="kind" checked={kind === "public"} onChange={() => setKind("public")} /><span><Icon name="hash" size={16} />{w.public}<span className="muted"> — {w.publicHint}</span></span></label>
          <label><input type="radio" name="kind" checked={kind === "private"} onChange={() => setKind("private")} /><span><Icon name="lock" size={16} />{w.private}<span className="muted"> — {w.privateHint}</span></span></label>
        </fieldset>
        <div className="field">
          <span>{w.addPeople}</span>
          <PeoplePicker chosen={chosen} setChosen={setChosen} groups={groups} chosenGroups={chosenGroups} setChosenGroups={setChosenGroups} exclude={[me]} label={w.addPeopleHint} />
        </div>
        <div className="form-actions">
          <button type="button" className="button quiet" onClick={e => close(e.currentTarget)}>{w.cancel}</button>
          <button type="submit" className="button" disabled={busy || !name}>{w.create}</button>
        </div>
      </form>
    </Modal>
  );
}

function NewDirect() {
  const w = useWords();
  const a = useActions();
  const [chosen, setChosen] = useState<Person[]>([]);
  const me = useStore(s => s.me.id);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await a.direct(chosen.map(p => p.id));
      close(form);
    } catch (error) { a.fail(error); }
  };
  return (
    <Modal label={w.newDirectTitle}>
      <Head title={w.newDirectTitle} />
      <form onSubmit={e => void submit(e)} className="form">
        <div className="field">
          <span>{w.to}</span>
          <PeoplePicker chosen={chosen} setChosen={p => setChosen(p.slice(0, 8))} exclude={[me]} label={w.peopleSearch} autoFocus />
        </div>
        <div className="form-actions">
          <button type="button" className="button quiet" onClick={e => close(e.currentTarget)}>{w.cancel}</button>
          <button type="submit" className="button" disabled={!chosen.length}>{w.start}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddPeople({ conversation }: { conversation: number }) {
  const w = useWords();
  const a = useActions();
  const details = useStore(s => s.details);
  const viewing = useStore(s => s.viewing);
  const [chosen, setChosen] = useState<Person[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; size: number }[]>([]);
  const [chosenGroups, setChosenGroups] = useState<string[]>([]);
  useEffect(() => { void a.groups().then(setGroups, () => setGroups([])); }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await a.add(conversation, chosen.map(p => p.id), chosenGroups);
      close(form);
    } catch (error) { a.fail(error); }
  };
  const title = w.addPeopleTo(viewing?.name ?? "");
  return (
    <Modal label={title}>
      <Head title={title} />
      <form onSubmit={e => void submit(e)} className="form">
        <PeoplePicker chosen={chosen} setChosen={setChosen} groups={groups.filter(g => !details?.groups.some(x => x.id === g.id))} chosenGroups={chosenGroups}
          setChosenGroups={setChosenGroups} exclude={details?.members ?? []} label={w.addPeopleHint} autoFocus />
        <div className="form-actions">
          <button type="button" className="button quiet" onClick={e => close(e.currentTarget)}>{w.cancel}</button>
          <button type="submit" className="button" disabled={!chosen.length && !chosenGroups.length}>{w.addPeople}</button>
        </div>
      </form>
    </Modal>
  );
}

function Browse() {
  const w = useWords();
  const a = useActions();
  const [all, setAll] = useState<(Conversation & { memberCount: number })[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { void a.browse().then(setAll, error => { setAll([]); a.fail(error); }); }, []);
  const t = normalize(q.trim());
  const shown = (all ?? []).filter(c => !t || normalize(c.name ?? "").includes(t));
  return (
    <Modal label={w.browseTitle} className="browse">
      <Head title={w.browseTitle} />
      <div className="form">
        <input type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={w.browseSearch} aria-label={w.browseSearch} />
        <ul className="browse-list" aria-busy={all === null}>
          {shown.map(c => (
            <li key={c.id}>
              <button type="button" className="browse-row" onClick={e => { close(e.currentTarget); void a.go({ view: "conversation", id: c.id, thread: null, message: null }); }}>
                <Icon name="hash" size={16} />
                <span className="grow">{c.name}</span>
                <span className="detail">{[c.archived ? w.archived : null, c.joined ? w.joined : null, w.members(c.memberCount)].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
        {all && !shown.length ? <p className="empty">{w.noChannels}</p> : null}
        <div className="form-actions">
          <button type="button" className="button quiet" onClick={e => { close(e.currentTarget); a.openDialog({ kind: "create" }); }}><Icon name="plus" size={16} />{w.newChannel}</button>
        </div>
      </div>
    </Modal>
  );
}

function Shortcuts() {
  const w = useWords();
  return (
    <Modal label={w.shortcuts}>
      <Head title={w.shortcuts} />
      <dl className="shortcuts">
        {w.shortcutList.map(([keys, what]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>)}
      </dl>
    </Modal>
  );
}

function Confirm({ dialog }: { dialog: Extract<Dialog, { kind: "confirm" }> }) {
  const w = useWords();
  const a = useActions();
  const [busy, setBusy] = useState(false);
  return (
    <Modal label={dialog.action} className="confirm">
      <p>{dialog.text}</p>
      <div className="form-actions">
        <button type="button" className="button quiet" autoFocus onClick={e => close(e.currentTarget)}>{w.cancel}</button>
        <button type="button" className="button danger" disabled={busy} onClick={async e => {
          const from = e.currentTarget;
          setBusy(true);
          try { await dialog.run(); close(from); } catch (error) { setBusy(false); a.fail(error); }
        }}>{dialog.action}</button>
      </div>
    </Modal>
  );
}

