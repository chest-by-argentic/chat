import { memo, useRef, useState } from "react";
import type { FileInfo, Message } from "../shared/types.js";
import { quick } from "../shared/emoji.js";
import { day, size, stamp, time } from "../shared/format.js";
import { pathOf } from "../shared/route.js";
import type { Shown } from "./store.js";
import { nameOf, useActions, useStore, useWords } from "./context.js";
import { Avatar, Icon } from "./bits.js";
import { Text } from "./Text.js";
import { Menu, type MenuItem } from "./Menu.js";
import { EmojiPicker } from "./EmojiPicker.js";
import { Composer } from "./Composer.js";

// One message: its author and time (unless grouped with the one before),
// its text, files, reactions, thread, and the actions a member has on it.
export const MessageItem = memo(function MessageItem({ m, grouped, inThread, focused, highlighted }: { m: Shown; grouped: boolean; inThread: boolean; focused: boolean; highlighted: boolean }) {
  const w = useWords();
  const a = useActions();
  const me = useStore(s => s.me);
  const author = useStore(s => s.people[m.author]);
  const editing = useStore(s => s.editing === m.id);
  const now = useStore(s => s.now);
  const joined = useStore(s => !!s.viewing?.joined);
  const writable = useStore(s => !!s.viewing?.joined && !s.viewing.archived);
  const [picking, setPicking] = useState(false);
  const [held, setHeld] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout>>(undefined);
  const zone = me.timeZone;
  const own = m.author === me.id;

  if (m.kind !== "message") return <SystemLine m={m} />;

  const link = () => `${location.origin}${pathOf(m.thread === null ? { view: "conversation", id: m.conversation, thread: null, message: m.id } : { view: "conversation", id: m.conversation, thread: m.thread, message: null })}`;
  const thread = m.thread === null && !inThread ? () => void a.go({ view: "conversation", id: m.conversation, thread: m.id, message: null }) : null;
  const save = () => void a.save(m.id, !m.saved);
  const more: MenuItem[] = [
    ...(own && !m.deleted && m.text !== null && writable ? [{ label: w.edit, icon: "edit" as const, run: () => a.setEditing(m.id) }] : []),
    ...(writable && m.thread === null && !m.deleted ? [{ label: m.pinned ? w.unpin : w.pin, icon: "pin" as const, run: () => void a.pin(m.id, !m.pinned) }] : []),
    { label: w.copyLink, icon: "link" as const, run: () => { void navigator.clipboard?.writeText(link()).then(() => a.toast(w.linkCopied)); } },
    ...(joined ? [{ label: w.markUnread, icon: "unread" as const, run: () => void a.markUnread(m.id) }] : []),
    ...((own || me.isAdmin) && !m.deleted ? [{ label: w.delete, icon: "trash" as const, run: () => a.openDialog({ kind: "confirm", text: w.confirmDelete, action: w.delete, run: () => a.remove(m.id) }) }] : []),
  ];
  const pending = m.pending !== undefined;
  const actionable = !pending && !editing && !m.deleted && m.text !== null;
  // A long press on a touch screen opens the message's actions.
  const touchStart = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || !actionable) return;
    press.current = setTimeout(() => setHeld(true), 450);
  };
  const touchEnd = () => clearTimeout(press.current);
  const mentionsMe = !own && (m.mentions.includes(me.id) || m.mentionAll);

  return (
    <article className={`message${grouped ? " grouped" : ""}${highlighted ? " highlighted" : ""}${mentionsMe ? " mentions-me" : ""}${pending ? ` ${m.pending}` : ""}${held || picking ? " held" : ""}`}
      data-message={m.id} tabIndex={focused ? 0 : -1} aria-labelledby={`m${m.id}-who`}
      onPointerDown={touchStart} onPointerUp={touchEnd} onPointerCancel={touchEnd} onPointerMove={touchEnd}
      onContextMenu={e => { if (held) e.preventDefault(); }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" && thread && !pending) { e.preventDefault(); thread(); }
        else if (e.key === "e" && own && !pending && !m.deleted) { e.preventDefault(); a.setEditing(m.id); }
      }}>
      <div className="gutter">
        {grouped ? <time className="hover-time" dateTime={m.createdAt} title={stamp(m.createdAt, zone, w, new Date(now))}>{time(m.createdAt, zone, w)}</time> : <Avatar person={author} size={36} />}
      </div>
      <div className="body">
        <div className={grouped ? "meta sr-only" : "meta"}>
          <span className="author" id={`m${m.id}-who`}>{nameOf(author, w)}</span>
          <time dateTime={m.createdAt} title={stamp(m.createdAt, zone, w, new Date(now))}>{time(m.createdAt, zone, w)}</time>
          {m.pinned ? <span className="tag"><Icon name="pin" size={12} />{w.pinned}</span> : null}
        </div>
        {editing ? (
          <Composer conversation={m.conversation} thread={m.thread} editing={m} />
        ) : m.deleted ? (
          <p className="placeholder">{w.deletedMessage}</p>
        ) : m.text === null ? (
          <p className="placeholder">{w.sealedMessage}</p>
        ) : (
          <>
            {m.text ? <Text text={m.text} /> : null}
            {m.editedAt ? <span className="edited" title={stamp(m.editedAt, zone, w, new Date(now))}>{w.edited}</span> : null}
          </>
        )}
        {m.files.length ? <Files files={m.files} pending={pending} /> : null}
        {m.reactions.length ? (
          <div className="reactions">
            {m.reactions.map(r => <ReactionButton key={r.emoji} m={m} emoji={r.emoji} members={r.members} disabled={!writable} />)}
            {writable ? <button type="button" className="reaction add" aria-label={w.react} title={w.react} onClick={() => setPicking(true)}><Icon name="smile" size={16} /></button> : null}
          </div>
        ) : null}
        {m.replyCount > 0 && !inThread ? <ThreadSummary m={m} /> : null}
        {m.pending === "sending" ? <p className="status-line">…</p> : null}
        {m.pending === "failed" ? (
          <p className="status-line failed" role="alert">
            {w.notSent} <button type="button" className="link" onClick={() => void a.retry(m)}>{w.retry}</button> · <button type="button" className="link" onClick={() => a.discard(m)}>{w.discard}</button>
          </p>
        ) : null}
      </div>
      {actionable ? (
        <div className="toolbar" role="toolbar" aria-label={w.messageActions}>
          {writable ? quick.slice(0, 3).map(e => (
            <button key={e} type="button" className="icon-button emoji" aria-label={w.reactWith(e)} title={w.reactWith(e)}
              onClick={() => void a.react(m.id, e, !m.reactions.find(r => r.emoji === e)?.members.includes(me.id))}>{e}</button>
          )) : null}
          {writable ? <button type="button" className="icon-button" aria-label={w.react} title={w.react} onClick={() => setPicking(true)}><Icon name="smile" size={16} /></button> : null}
          {thread ? <button type="button" className="icon-button" aria-label={w.replyInThread} title={w.replyInThread} onClick={thread}><Icon name="reply" size={16} /></button> : null}
          <button type="button" className="icon-button" aria-pressed={m.saved} aria-label={m.saved ? w.removeFromSaved : w.saveForLater} title={m.saved ? w.removeFromSaved : w.saveForLater}
            onClick={save}><Icon name="bookmark" size={16} /></button>
          <Menu label={w.more} icon="more" items={more} />
        </div>
      ) : null}
      {held ? (
        <ActionSheet onClose={() => setHeld(false)}
          react={writable ? e => void a.react(m.id, e, !m.reactions.find(r => r.emoji === e)?.members.includes(me.id)) : null}
          mine={e => !!m.reactions.find(r => r.emoji === e)?.members.includes(me.id)}
          items={[
            ...(writable ? [{ label: w.react, icon: "smile" as const, run: () => setPicking(true) }] : []),
            ...(thread ? [{ label: w.replyInThread, icon: "reply" as const, run: thread }] : []),
            { label: m.saved ? w.removeFromSaved : w.saveForLater, icon: "bookmark" as const, run: save },
            ...(m.text ? [{ label: w.copyText, icon: "copy" as const, run: () => { void navigator.clipboard?.writeText(m.text ?? "").then(() => a.toast(w.textCopied)); } }] : []),
            ...more,
          ]} />
      ) : null}
      {picking ? <EmojiPicker onPick={e => { void a.react(m.id, e, true); setPicking(false); }} onClose={() => setPicking(false)} /> : null}
    </article>
  );
});

// ActionSheet is a message's actions on a touch screen: reactions at a
// thumb's reach, then each action in words.
function ActionSheet({ items, react, mine, onClose }: { items: MenuItem[]; react: ((emoji: string) => void) | null; mine: (emoji: string) => boolean; onClose: () => void }) {
  const w = useWords();
  const run = (f: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.closest("dialog")?.close(); f(); };
  return (
    <dialog className="sheet" aria-label={w.messageActions} ref={d => { if (d && !d.open) d.showModal(); }} onClose={onClose}
      onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      {react ? (
        <div className="quick">
          {quick.map(e => <button key={e} type="button" aria-pressed={mine(e)} aria-label={w.reactWith(e)} onClick={run(() => react(e))}>{e}</button>)}
        </div>
      ) : null}
      <ul>
        {items.map(item => (
          <li key={item.label}><button type="button" onClick={run(item.run)}>{item.icon ? <Icon name={item.icon} size={20} /> : null}{item.label}</button></li>
        ))}
      </ul>
    </dialog>
  );
}

function ReactionButton({ m, emoji, members, disabled }: { m: Message; emoji: string; members: string[]; disabled: boolean }) {
  const w = useWords();
  const a = useActions();
  const me = useStore(s => s.me.id);
  const people = useStore(s => s.people);
  const mine = members.includes(me);
  const names = w.and(members.map(id => (id === me ? w.you : nameOf(people[id], w))));
  return (
    <button type="button" className={mine ? "reaction mine" : "reaction"} aria-pressed={mine} disabled={disabled}
      title={w.reactedBy(emoji, names)} aria-label={`${w.reactedBy(emoji, names)}. ${mine ? w.removeReaction(emoji) : w.reactWith(emoji)}`}
      onClick={() => void a.react(m.id, emoji, !mine)}>
      <span className="reaction-emoji">{emoji}</span><span>{members.length}</span>
    </button>
  );
}

function ThreadSummary({ m }: { m: Message }) {
  const w = useWords();
  const a = useActions();
  const people = useStore(s => s.people);
  const zone = useStore(s => s.me.timeZone);
  const now = useStore(s => s.now);
  return (
    <button type="button" className="thread-summary" onClick={() => void a.go({ view: "conversation", id: m.conversation, thread: m.id, message: null })}>
      <span className="repliers">{m.repliers.map(id => <Avatar key={id} person={people[id]} size={20} />)}</span>
      <span className="count">{w.replies(m.replyCount)}</span>
      {m.lastReplyAt ? <span className="when">{w.lastReply(`${day(m.lastReplyAt, zone, w, new Date(now)).toLowerCase()} ${time(m.lastReplyAt, zone, w)}`)}</span> : null}
    </button>
  );
}

// Joined is people who joined one after another, said once: “Camille
// Martin, Sam Taylor and 3 others joined.”
export function Joined({ run }: { run: Message[] }) {
  const w = useWords();
  const people = useStore(s => s.people);
  const zone = useStore(s => s.me.timeZone);
  const now = useStore(s => s.now);
  if (run.length === 1) return <SystemLine m={run[0]!} />;
  const names = [...new Set(run.map(m => m.author))].map(id => nameOf(people[id], w));
  const shown = names.length > 3 ? [...names.slice(0, 2), w.others(names.length - 2)] : names;
  const last = run.at(-1)!;
  return (
    <div className="system" data-message={last.id}>
      <span>{w.systemJoined(w.and(shown), names.length > 1)}</span>
      <time dateTime={last.createdAt} title={stamp(last.createdAt, zone, w, new Date(now))}>{time(last.createdAt, zone, w)}</time>
    </div>
  );
}

function SystemLine({ m }: { m: Message }) {
  const w = useWords();
  const people = useStore(s => s.people);
  const me = useStore(s => s.me);
  const now = useStore(s => s.now);
  const who = nameOf(people[m.author], w);
  const whom = w.and([...(m.meta?.members ?? []).map(id => nameOf(people[id], w)), ...(m.meta?.groups ?? [])]);
  const text = {
    created: () => w.systemCreated(who), joined: () => w.systemJoined(who, false), left: () => w.systemLeft(who),
    added: () => w.systemAdded(who, whom), removed: () => w.systemRemoved(who, whom),
    renamed: () => w.systemRenamed(who, m.meta?.from ?? "", m.meta?.to ?? ""), about: () => w.systemAbout(who),
    archived: () => w.systemArchived(who), unarchived: () => w.systemUnarchived(who),
  }[m.kind as Exclude<Message["kind"], "message">]();
  return (
    <div className="system" data-message={m.id}>
      <span>{text}</span>
      <time dateTime={m.createdAt} title={stamp(m.createdAt, me.timeZone, w, new Date(now))}>{time(m.createdAt, me.timeZone, w)}</time>
    </div>
  );
}

// fit is an image's size within a box, its proportions kept.
const fit = (f: FileInfo, box: number) => {
  if (!f.width || !f.height) return { width: box, height: box };
  const scale = Math.min(1, box / Math.max(f.width, f.height));
  return { width: Math.max(1, Math.round(f.width * scale)), height: Math.max(1, Math.round(f.height * scale)) };
};
const isImage = (f: FileInfo) => /^image\/(jpeg|png|gif|webp)$/u.test(f.type) && f.size > 0;

function Files({ files, pending }: { files: FileInfo[]; pending: boolean }) {
  const w = useWords();
  const [open, setOpen] = useState<FileInfo | null>(null);
  if (pending) return <div className="files">{files.map((f, i) => <span key={i} className="file"><Icon name="file" size={20} /><span className="file-name">{f.name}</span><span className="file-size">{size(f.size, w)}</span></span>)}</div>;
  return (
    <div className="files">
      {files.map(f => isImage(f) ? (
        <button key={f.id} type="button" className="image" onClick={() => setOpen(f)} aria-label={`${w.openImage}: ${f.name ?? w.fileUnavailable}`}>
          <img src={`/chest/api/files/${f.id}?size=256`} alt={f.name ?? ""} {...fit(f, 256)} loading="lazy" />
        </button>
      ) : (
        <a key={f.id} className="file" href={`/chest/api/files/${f.id}?download`} download={f.name ?? undefined}>
          <Icon name="file" size={20} />
          <span className="file-name">{f.name ?? w.fileUnavailable}</span>
          <span className="file-size">{size(f.size, w)}</span>
          <Icon name="download" size={16} />
        </a>
      ))}
      {open ? <Lightbox file={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Lightbox({ file, onClose }: { file: FileInfo; onClose: () => void }) {
  const w = useWords();
  return (
    <dialog className="lightbox" ref={d => { if (d && !d.open) d.showModal(); }} onClose={onClose} aria-label={file.name ?? w.openImage}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <figure>
        <img src={`/chest/api/files/${file.id}?size=1024`} alt={file.name ?? ""} {...fit(file, 1024)} />
        <figcaption>
          <span>{file.name}</span>
          <a href={`/chest/api/files/${file.id}?download`} download={file.name ?? undefined}><Icon name="download" size={16} />{w.download}</a>
          <button type="button" className="icon-button" onClick={onClose} aria-label={w.close} autoFocus><Icon name="close" /></button>
        </figcaption>
      </figure>
    </dialog>
  );
}
