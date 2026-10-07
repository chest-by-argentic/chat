import { useEffect, useState, type ReactNode } from "react";
import type { Conversation } from "../shared/types.js";
import { pathOf } from "../shared/route.js";
import { draftKey } from "./store.js";
import { titleOf, useActions, useStore, useWords } from "./context.js";
import { Avatar, Icon, Presence } from "./bits.js";
import { Menu } from "./Menu.js";

// The list of conversations: the member's views, their channels (starred
// first), their direct messages (latest first). Unread conversations are
// written in ink, read ones in grey; a count says mentions.
export function Sidebar() {
  const w = useWords();
  const a = useActions();
  const organization = useStore(s => s.organization);
  const conversations = useStore(s => s.conversations);
  const threadsUnread = useStore(s => s.threadsUnread);
  // Drafts elsewhere than where the member is writing now.
  const hasDrafts = useStore(s => Object.keys(s.drafts).some(k => !(s.route.view === "conversation" && k.startsWith(`${s.route.id}:`))));
  const route = useStore(s => s.route);
  const channels = conversations.filter(c => c.kind !== "direct").sort((x, y) => Number(y.starred) - Number(x.starred) || (x.name ?? "").localeCompare(y.name ?? ""));
  const directs = conversations.filter(c => c.kind === "direct").sort((x, y) => (y.lastMessageAt ?? "").localeCompare(x.lastMessageAt ?? "") || y.id - x.id);
  const mentions = conversations.reduce((n, c) => n + (c.notify === "none" ? 0 : c.mentions), 0);
  const view = route.view;
  return (
    <nav className="sidebar" aria-label={w.sidebar}>
      <header className="sidebar-head">
        <h1 className="org">{organization}</h1>
        <button type="button" className="jump" onClick={() => a.openDialog({ kind: "switcher" })} aria-keyshortcuts="Control+K Meta+K">
          <Icon name="search" size={16} />
          <span>{w.jumpTo}</span>
          <Shortcut />
        </button>
      </header>
      <div className="sidebar-scroll">
        <ul className="views">
          <ViewLink view="threads" icon="threads" label={w.threads} current={view === "threads"} count={threadsUnread} dot />
          <ViewLink view="mentions" icon="at" label={w.mentions} current={view === "mentions"} count={mentions} />
          <ViewLink view="saved" icon="bookmark" label={w.saved} current={view === "saved"} count={0} />
          {hasDrafts ? <ViewLink view="drafts" icon="pencil" label={w.drafts} current={view === "drafts"} count={0} /> : null}
        </ul>
        <Section title={w.channels} add={
          <Menu label={w.addChannel} icon="plus" items={[
            { label: w.newChannel, run: () => a.openDialog({ kind: "create" }) },
            { label: w.browseChannels, run: () => a.openDialog({ kind: "browse" }) },
          ]} />
        }>
          {channels.map(c => <Row key={c.id} c={c} />)}
        </Section>
        <Section title={w.directMessages} add={
          <button type="button" className="icon-button" onClick={() => a.openDialog({ kind: "direct" })} aria-label={w.newMessage} title={w.newMessage}><Icon name="plus" size={16} /></button>
        }>
          {directs.map(c => <Row key={c.id} c={c} />)}
        </Section>
      </div>
    </nav>
  );
}

function ViewLink({ view, icon, label, current, count, dot }: { view: "threads" | "mentions" | "saved" | "drafts"; icon: "threads" | "at" | "bookmark" | "pencil"; label: string; current: boolean; count: number; dot?: boolean }) {
  const a = useActions();
  const w = useWords();
  return (
    <li>
      <a href={pathOf({ view })} className={count > 0 ? "row unread" : "row"} aria-current={current ? "page" : undefined}
        onClick={e => { e.preventDefault(); void a.go({ view }); }}>
        <Icon name={icon} size={16} />
        <span className="row-name">{label}</span>
        {count > 0 ? (dot ? <span className="dot" role="img" aria-label={w.unread(count)} /> : <span className="pill" aria-label={w.mentionCount(count)}>{count > 99 ? "99+" : count}</span>) : null}
      </a>
    </li>
  );
}

function Section({ title, add, children }: { title: string; add: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="section">
      <div className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="caret" aria-hidden="true">{open ? "▾" : "▸"}</span>{title}
        </button>
        {add}
      </div>
      {open ? <ul>{children}</ul> : null}
    </section>
  );
}

function Row({ c }: { c: Conversation }) {
  const w = useWords();
  const a = useActions();
  const people = useStore(s => s.people);
  const me = useStore(s => s.me.id);
  const current = useStore(s => s.route.view === "conversation" && s.route.id === c.id);
  const draft = useStore(s => !current && !!s.drafts[draftKey(c.id, null)]);
  const muted = c.notify === "none";
  const unread = !muted && c.unread > 0;
  const count = muted ? 0 : c.kind === "direct" ? c.unread : c.mentions;
  const title = titleOf(c, people, me, w);
  const other = c.kind === "direct" ? c.people.find(p => p !== me) ?? me : null;
  const label = [title, c.kind === "private" ? w.privateChannel : null, unread ? w.unread(c.unread) : null, count ? w.mentionCount(count) : null].filter(Boolean).join(", ");
  return (
    <li>
      <a href={pathOf({ view: "conversation", id: c.id, thread: null, message: null })} className={`row${unread ? " unread" : ""}${muted ? " muted" : ""}`}
        aria-current={current ? "page" : undefined} aria-label={label}
        onClick={e => { e.preventDefault(); void a.go({ view: "conversation", id: c.id, thread: null, message: null }); }}>
        {c.kind === "direct"
          ? <span className="row-avatar"><Avatar person={people[other!]} size={20} />{c.people.length <= 2 ? <Presence id={other!} /> : null}</span>
          : <Icon name={c.kind === "private" ? "lock" : "hash"} size={16} />}
        <span className="row-name">{title}</span>
        {draft ? <Icon name="pencil" size={14} /> : null}
        {count > 0 ? <span className="pill" aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
      </a>
    </li>
  );
}

// Shortcut shows the switcher's keys as this computer writes them, once
// the page knows which it is (the server cannot).
function Shortcut() {
  const [keys, setKeys] = useState("");
  useEffect(() => setKeys(/Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘K" : "Ctrl K"), []);
  return keys ? <kbd>{keys}</kbd> : null;
}
