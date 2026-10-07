import { useCallback } from "react";
import type { Conversation } from "../shared/types.js";
import { nameOf, titleOf, useActions, useStore, useWords } from "./context.js";
import { Icon } from "./bits.js";
import { MessageList } from "./MessageList.js";
import { Composer } from "./Composer.js";

// The conversation in front: its header, its messages, who is typing, and
// the composer — or what stands in its place (join a public channel, an
// archived channel, locked messages).
export function ConversationView() {
  const w = useWords();
  const a = useActions();
  const viewing = useStore(s => s.viewing);
  const page = useStore(s => s.page);
  const people = useStore(s => s.people);
  const me = useStore(s => s.me.id);
  const missing = useStore(s => s.missing);
  const locked = useStore(s => s.locked);
  const detailsOpen = useStore(s => s.detailsOpen);
  const onOlder = useCallback(() => void a.loadOlder(), [a]);
  const onNewer = useCallback(() => void a.loadNewer(), [a]);

  if (missing) return <main className="main empty-state" id="main"><Back /><p>{w.notFound}</p></main>;
  if (!viewing) return <main className="main" id="main" aria-busy="true" />;
  const title = titleOf(viewing, people, me, w);
  const heading = viewing.kind === "direct" ? title : viewing.name!;
  const others = viewing.people.filter(p => p !== me);
  const intro = viewing.kind === "direct"
    ? (others.length ? w.beginningDirect(w.and(others.map(id => nameOf(people[id], w)))) : w.beginningNotes)
    : w.beginningChannel(viewing.name!);

  return (
    <main className="main" id="main" aria-labelledby="conversation-title">
      <header className="pane-head">
        <Back />
        <h2 id="conversation-title" className="title">
          {viewing.kind !== "direct" ? <Icon name={viewing.kind === "private" ? "lock" : "hash"} size={18} /> : null}
          <span>{heading}</span>
          {viewing.kind === "private" ? <span className="sr-only">{w.privateChannel}</span> : null}
        </h2>
        {viewing.joined ? (
          <button type="button" className="icon-button" aria-pressed={viewing.starred} aria-label={viewing.starred ? w.unstar : w.star} title={viewing.starred ? w.unstar : w.star}
            onClick={() => void a.settings(viewing.id, { starred: !viewing.starred })}><Icon name="star" /></button>
        ) : null}
        <span className="grow" />
        {viewing.kind !== "direct" ? (
          <button type="button" className="head-count" aria-label={w.members(viewing.memberCount)} title={w.members(viewing.memberCount)} onClick={() => a.toggleDetails(true)}>
            <Icon name="people" size={16} />{viewing.memberCount}
          </button>
        ) : null}
        <button type="button" className="icon-button" aria-label={w.searchIn(heading)} title={w.searchIn(heading)}
          onClick={() => void a.go({ view: "search", q: viewing.kind === "direct" ? "" : `in:#${viewing.name} ` })}><Icon name="search" /></button>
        <button type="button" className="icon-button" aria-label={w.details} title={w.details} aria-expanded={detailsOpen} aria-controls="details"
          onClick={() => a.toggleDetails()}><Icon name="info" /></button>
      </header>
      {locked ? <p className="notice" role="status">{w.locked}</p> : page && !(page.loading && !page.messages.length) ? (
        <MessageList key={viewing.id} label={heading} messages={page.messages} before={page.before} after={page.after} loading={page.loading}
          newLine={page.newLine} focus={page.focus} inThread={false} intro={<><p className="intro-title">{heading}</p><p>{intro}</p></>}
          onOlder={onOlder} onNewer={onNewer} />
      ) : null}
      <Typing conversation={viewing.id} thread={null} />
      <Footer c={viewing} />
    </main>
  );
}

function Footer({ c }: { c: Conversation }) {
  const w = useWords();
  const a = useActions();
  if (c.archived) return <p className="notice">{w.archivedNote}</p>;
  if (!c.joined) {
    return (
      <div className="join-bar">
        <p>{w.previewing(c.name ?? "")}</p>
        <button type="button" className="button" onClick={() => void a.join(c.id)}>{w.joinTo(c.name ?? "")}</button>
      </div>
    );
  }
  return <Composer conversation={c.id} thread={null} />;
}

// Typing says who is writing here now, from their pages' signs.
export function Typing({ conversation, thread }: { conversation: number; thread: number | null }) {
  const w = useWords();
  const typing = useStore(s => s.typing);
  const people = useStore(s => s.people);
  const names = typing.filter(t => t.conversation === conversation && t.thread === thread).map(t => nameOf(people[t.member], w));
  const text = names.length === 0 ? "" : names.length === 1 ? w.typing1(names[0]!) : names.length === 2 ? w.typing2(names[0]!, names[1]!) : w.typingMany;
  return <p className="typing" aria-live="polite">{text}</p>;
}

// Back leads, on a phone, to the list of conversations.
export function Back() {
  const w = useWords();
  const a = useActions();
  return <button type="button" className="icon-button back" aria-label={w.back} onClick={() => a.setPane("list")}><Icon name="back" /></button>;
}
