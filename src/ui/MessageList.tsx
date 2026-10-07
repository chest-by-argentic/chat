import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { day, dayKey } from "../shared/format.js";
import { plain } from "../shared/markdown.js";
import type { Shown } from "./store.js";
import { nameOf, useActions, useSnapshot, useStore, useWords } from "./context.js";
import { Icon } from "./bits.js";
import { Joined, MessageItem } from "./MessageItem.js";

// A list of messages, oldest at the top: day dividers, the New line,
// messages of one author within five minutes grouped. It stays at the
// bottom while the member is there, keeps its place when older messages
// come, loads more at either end, and moves between messages with the
// arrows.

const groupWindow = 5 * 60 * 1000;

export function MessageList({ messages, before, after, loading, newLine, focus, inThread, intro, onOlder, onNewer, label }: {
  messages: Shown[]; before: boolean; after: boolean; loading: boolean; newLine: number | null; focus: number | null; inThread: boolean;
  intro: ReactNode; onOlder: () => void; onNewer: () => void; label: string;
}) {
  const w = useWords();
  const a = useActions();
  const snapshot = useSnapshot();
  const me = useStore(s => s.me);
  const now = useStore(s => s.now);
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const firstId = useRef<number | undefined>(undefined);
  const height = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [active, setActive] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const lastSeen = useRef<number>(messages.at(-1)?.id ?? 0);

  // Where to start: the message asked for, the New line, or the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = focus ?? (newLine !== null ? messages.find(m => m.id > newLine && m.author !== me.id)?.id : undefined);
    const node = target !== undefined ? el.querySelector<HTMLElement>(`[data-message="${target}"]`) : null;
    if (node) {
      node.scrollIntoView({ block: focus ? "center" : "start" });
      stick.current = false;
      if (focus) setActive(focus);
    } else {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
    }
    firstId.current = messages[0]?.id;
    height.current = el.scrollHeight;
    scrolled();
  }, [focus, label]);

  // After a change: older messages above keep the place; new ones below
  // follow the bottom when the member was there.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (messages[0]?.id !== firstId.current && firstId.current !== undefined && messages.some(m => m.id === firstId.current)) {
      el.scrollTop += el.scrollHeight - height.current;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
    firstId.current = messages[0]?.id;
    height.current = el.scrollHeight;
  }, [messages]);

  // Say what arrives, once, to a screen reader.
  useEffect(() => {
    const newest = messages.at(-1);
    if (!newest || newest.id <= lastSeen.current || newest.id < 0) return;
    lastSeen.current = newest.id;
    if (newest.author === me.id || newest.kind !== "message" || !newest.text) return;
    const s = snapshot();
    const words = plain(newest.text, { member: id => nameOf(s.people[id], w), channel: id => s.conversations.find(c => c.id === id)?.name ?? "", special: k => k }).slice(0, 140);
    setAnnounce(`${nameOf(s.people[newest.author], w)}: ${words}`);
  }, [messages]);

  // More at either end, as the member scrolls there.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (e.target === top.current && before) onOlder();
        if (e.target === bottom.current && after) onNewer();
      }
    }, { root: el, rootMargin: "400px 0px" });
    if (top.current) seen.observe(top.current);
    if (bottom.current) seen.observe(bottom.current);
    return () => seen.disconnect();
  }, [before, after, onOlder, onNewer]);

  const scrolled = () => {
    const el = scroller.current!;
    const end = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stick.current = end;
    height.current = el.scrollHeight;
    if (end !== atBottom) setAtBottom(end);
    if (!inThread) a.setAtBottom(end && !after);
    else if (end) void a.maybeRead();
  };

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (!(e.target as HTMLElement).matches("[data-message], .messages")) return;
    const items = [...scroller.current!.querySelectorAll<HTMLElement>("article[data-message]")];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = items[at < 0 ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]!;
    e.preventDefault();
    setActive(Number(next.dataset["message"]));
    next.focus();
  };

  const rows: ReactNode[] = [];
  let prev: Shown | undefined, prevDay = "", newShown = false;
  const tabbable = active ?? [...messages].reverse().find(m => m.kind === "message")?.id;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const d = dayKey(m.createdAt, me.timeZone);
    // People joining one after another: one line.
    if (m.kind === "joined") {
      const run = [m];
      while (messages[i + 1]?.kind === "joined" && dayKey(messages[i + 1]!.createdAt, me.timeZone) === d) run.push(messages[++i]!);
      if (d !== prevDay) rows.push(<div key={`d${d}`} className="divider day" role="separator"><span>{day(m.createdAt, me.timeZone, w, new Date(now))}</span></div>);
      rows.push(<Joined key={m.id} run={run} />);
      prev = run.at(-1);
      prevDay = d;
      continue;
    }
    const isNew = !newShown && newLine !== null && m.id > newLine && m.id > 0 && m.author !== me.id && m.kind === "message" && !inThread;
    if (d !== prevDay) rows.push(<div key={`d${d}`} className="divider day" role="separator"><span>{day(m.createdAt, me.timeZone, w, new Date(now))}</span></div>);
    if (isNew) {
      newShown = true;
      rows.push(<div key="new" className="divider new" role="separator"><span>{w.newLine}</span></div>);
    }
    const grouped = !!prev && prev.kind === "message" && m.kind === "message" && prev.author === m.author && d === prevDay && !isNew
      && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < groupWindow && !prev.pending;
    rows.push(<MessageItem key={m.key ?? m.id} m={m} grouped={grouped} inThread={inThread} focused={m.id === tabbable} highlighted={m.id === focus} />);
    // In a thread, its root, then how many replied.
    if (inThread && i === 0 && m.replyCount > 0) {
      rows.push(<div key="replies" className="thread-divider" role="separator">{w.replies(m.replyCount)}</div>);
      prev = undefined;
      prevDay = d;
      continue;
    }
    prev = m;
    prevDay = d;
  }

  return (
    <div className="messages-frame">
      <div ref={scroller} className="messages" onScroll={scrolled} onKeyDown={keys} role="region" aria-label={label} aria-busy={loading}>
        <div ref={top} className="sentinel" />
        {intro && !before && !loading ? <div className="intro">{intro}</div> : null}
        {before ? <button type="button" className="load-more" onClick={onOlder} disabled={loading}>{w.loadOlder}</button> : null}
        {rows}
        <div ref={bottom} className="sentinel" />
      </div>
      {(!atBottom || after) && messages.length ? (
        <button type="button" className="jump-latest" onClick={() => { stick.current = true; if (after) void a.jumpToLatest(); else scroller.current!.scrollTop = scroller.current!.scrollHeight; }}>
          <Icon name="down" size={14} />{w.jumpToLatest}
        </button>
      ) : null}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>
    </div>
  );
}
