import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Message } from "../shared/types.js";
import { day, stamp, time } from "../shared/format.js";
import { normalize } from "../shared/rules.js";
import { nameOf, titleOf, useActions, useStore, useWords } from "./context.js";
import { Avatar, Icon } from "./bits.js";
import { Text } from "./Text.js";
import { Back } from "./ConversationView.js";

// The member's own views — Threads, Mentions, Saved, Drafts — and Search.

export function ListView() {
  const w = useWords();
  const a = useActions();
  const route = useStore(s => s.route);
  const list = useStore(s => s.list);
  const drafts = useStore(s => s.drafts);
  const conversations = useStore(s => s.conversations);
  const people = useStore(s => s.people);
  const me = useStore(s => s.me.id);
  if (route.view !== "threads" && route.view !== "mentions" && route.view !== "saved" && route.view !== "drafts") return null;
  const title = { threads: w.threads, mentions: w.mentions, saved: w.saved, drafts: w.drafts }[route.view];
  const empty = { threads: w.threadsEmpty, mentions: w.mentionsEmpty, saved: w.savedEmpty, drafts: w.draftsEmpty }[route.view];
  const ready = list?.view === route.view;
  let body: ReactNode;
  if (route.view === "drafts") {
    const entries = Object.entries(drafts);
    body = entries.length ? (
      <ul className="cards">
        {entries.map(([key, text]) => {
          const [c, t] = key.split(":").map(Number) as [number, number];
          const conversation = conversations.find(x => x.id === c);
          return (
            <li key={key}>
              <a className="card" href={`/chest/c/${c}${t ? `/t/${t}` : ""}`} onClick={e => { e.preventDefault(); void a.go({ view: "conversation", id: c, thread: t || null, message: null }); }}>
                <span className="card-where">{conversation ? titleOf(conversation, people, me, w) : ""}{t ? ` · ${w.thread}` : ""}</span>
                <Text text={text} />
              </a>
            </li>
          );
        })}
      </ul>
    ) : <p className="empty-state">{empty}</p>;
  } else if (!ready) {
    body = <div aria-busy="true" />;
  } else if (route.view === "threads") {
    body = list.threads.length ? (
      <ul className="cards">
        {list.threads.map(t => (
          <li key={t.root.id}>
            <div className={t.unread ? "card unread" : "card"}>
              <Where m={t.root} />
              <Card m={t.root} />
              {t.root.replyCount > t.latest.length ? (
                <button type="button" className="more-replies" onClick={() => void a.go({ view: "conversation", id: t.root.conversation, thread: t.root.id, message: null })}>{w.earlierReplies(t.root.replyCount - t.latest.length)}</button>
              ) : null}
              {t.latest.map(r => <Card key={r.id} m={r} />)}
              <button type="button" className="button quiet small" onClick={() => void a.go({ view: "conversation", id: t.root.conversation, thread: t.root.id, message: null })}>
                {w.viewThread}{t.unread ? ` · ${w.unread(t.unread)}` : ""}
              </button>
            </div>
          </li>
        ))}
      </ul>
    ) : <p className="empty-state">{empty}</p>;
  } else {
    body = list.messages.length ? (
      <ul className="cards">
        {list.messages.map(m => <li key={m.id}><Result m={m} /></li>)}
      </ul>
    ) : <p className="empty-state">{empty}</p>;
  }
  return (
    <main className="main" id="main" aria-labelledby="view-title">
      <header className="pane-head"><Back /><h2 id="view-title" className="title"><span>{title}</span></h2></header>
      <div className="view-scroll" aria-busy={list?.loading ?? false}>
        {body}
        {ready && list.more ? <button type="button" className="load-more" disabled={list.loading} onClick={() => void a.loadList(route.view as "threads" | "mentions" | "saved", true)}>{w.loadOlder}</button> : null}
      </div>
    </main>
  );
}

function Where({ m }: { m: Message }) {
  const w = useWords();
  const c = useStore(s => s.conversations.find(x => x.id === m.conversation));
  const people = useStore(s => s.people);
  const me = useStore(s => s.me.id);
  return <span className="card-where">{c ? <strong>{c.kind === "direct" ? titleOf(c, people, me, w) : `#${c.name}`}</strong> : null}</span>;
}

// Card is a message as a list shows it: author, time, text.
function Card({ m, highlight }: { m: Message; highlight?: string[] }) {
  const w = useWords();
  const author = useStore(s => s.people[m.author]);
  const zone = useStore(s => s.me.timeZone);
  const now = useStore(s => s.now);
  return (
    <div className="card-message">
      <Avatar person={author} size={24} />
      <div>
        <p className="meta"><span className="author">{nameOf(author, w)}</span>
          <time dateTime={m.createdAt} title={stamp(m.createdAt, zone, w, new Date(now))}>{day(m.createdAt, zone, w, new Date(now))} {time(m.createdAt, zone, w)}</time></p>
        {m.text === null ? <p className="placeholder">{w.sealedMessage}</p> : highlight?.length ? <Highlighted text={m.text} words={highlight} /> : <Text text={m.text} />}
        {m.files.length ? <p className="muted">{m.files.map(f => f.name ?? w.fileUnavailable).join(", ")}</p> : null}
      </div>
    </div>
  );
}

// Result is a message found, opening where it was written.
function Result({ m, highlight }: { m: Message; highlight?: string[] }) {
  const a = useActions();
  const route = { view: "conversation" as const, id: m.conversation, thread: m.thread, message: m.thread ? null : m.id };
  return (
    <a className="card" href={`/chest/c/${m.conversation}${m.thread ? `/t/${m.thread}` : `?m=${m.id}`}`} onClick={e => { e.preventDefault(); void a.go(route); }}>
      <Where m={m} />
      <Card m={m} {...(highlight ? { highlight } : {})} />
    </a>
  );
}

// Highlighted marks the words searched for in a found message's text.
function Highlighted({ text, words }: { text: string; words: string[] }) {
  const plainText = text.replace(/<@mbr_[a-z2-7]{26}>/gu, "@…").replace(/<#\d+>/gu, "#…").replace(/<!(channel|here)>/gu, "@$1");
  const folded = normalize(plainText);
  // Folding keeps one character per character only for most scripts: when it
  // does not, show the text without marks.
  if (folded.length !== plainText.length) return <p className="text">{plainText}</p>;
  const marks: [number, number][] = [];
  for (const word of words) {
    let at = folded.indexOf(word);
    while (word && at >= 0) { marks.push([at, at + word.length]); at = folded.indexOf(word, at + word.length); }
  }
  marks.sort((x, y) => x[0] - y[0]);
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const [s, e] of marks) {
    if (s < pos) continue;
    parts.push(plainText.slice(pos, s), <mark key={s}>{plainText.slice(s, e)}</mark>);
    pos = e;
  }
  parts.push(plainText.slice(pos));
  return <p className="text">{parts}</p>;
}

export function SearchView() {
  const w = useWords();
  const a = useActions();
  const search = useStore(s => s.search);
  const route = useStore(s => s.route);
  const zone = useStore(s => s.me.timeZone);
  const now = useStore(s => s.now);
  const last = useStore(s => s.conversations.find(c => c.isDefault)?.id ?? s.conversations[0]?.id);
  const [q, setQ] = useState(route.view === "search" ? route.q : "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  if (route.view !== "search") return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) void a.go({ view: "search", q: q.trim() }, { replace: true });
  };
  // A filter's chip writes its start in the field, where the member ends it.
  const filter = (start: string) => {
    const next = `${q.trim()} ${start}`.trimStart();
    setQ(next);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.length, next.length); });
  };
  const words = (search?.q ?? "").split(/\s+/u).filter(x => x && !/^(in|from|has|is|before|after):/u.test(x)).map(x => normalize(x.replace(/"/gu, "")));
  return (
    <main className="main" id="main" aria-labelledby="search-title">
      <header className="pane-head">
        <Back />
        <h2 id="search-title" className="sr-only">{w.search}</h2>
        <form className="search-form" role="search" onSubmit={submit}>
          <Icon name="search" />
          <input ref={input} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={w.searchPlaceholder} aria-label={w.searchPlaceholder} enterKeyHint="search" />
        </form>
        {last ? <button type="button" className="icon-button close" aria-label={w.closeSearch} title={w.closeSearch} onClick={() => void a.go({ view: "conversation", id: last, thread: null, message: null })}><Icon name="close" /></button> : null}
      </header>
      <div className="view-scroll">
        <div className="filters" role="group" aria-label={w.filters}>
          {([["in:#", w.filterIn], ["from:@", w.filterFrom], ["has:file", w.filterFile], ["is:thread", w.filterThread], ["after:", w.filterAfter], ["before:", w.filterBefore]] as const).map(([start, label]) => (
            <button key={start} type="button" onClick={() => filter(start)}>{label}</button>
          ))}
        </div>
        {search?.q ? (
          <>
            <p className="muted" role="status">{search.loading && !search.messages.length ? w.searching : search.error ? w.failed : w.results(search.messages.length)}</p>
            <ul className="cards">{search.messages.map(m => <li key={m.id}><Result m={m} highlight={words} /></li>)}</ul>
            {!search.loading && !search.error && search.messages.length === 0 && search.done ? <p className="empty-state">{w.noResults}</p> : null}
            {search.done && search.messages.length ? <p className="muted">{w.searchedAll}</p> : null}
            {!search.done && search.through ? (
              <p className="search-more">
                {w.searchedBack(day(search.through, zone, w, new Date(now)))}{" "}
                <button type="button" className="button quiet small" disabled={search.loading} onClick={() => void a.search(search.q, true)}>{search.loading ? w.searching : w.searchOlder}</button>
              </p>
            ) : null}
          </>
        ) : <p className="muted">{w.searchNewestFirst}</p>}
      </div>
    </main>
  );
}
