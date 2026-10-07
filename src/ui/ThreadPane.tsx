import { useCallback, useEffect, useMemo } from "react";
import { titleOf, useActions, useStore, useWords } from "./context.js";
import { Icon } from "./bits.js";
import { MessageList } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { Typing } from "./ConversationView.js";
import { Menu } from "./Menu.js";

// A thread beside its conversation (in front of it on a phone): the root,
// its replies, a composer, following.
export function ThreadPane() {
  const w = useWords();
  const a = useActions();
  const thread = useStore(s => s.thread);
  const route = useStore(s => s.route);
  const viewing = useStore(s => s.viewing);
  const people = useStore(s => s.people);
  const me = useStore(s => s.me.id);
  const noop = useCallback(() => {}, []);
  const older = useCallback(() => void a.loadOlderReplies(), [a]);
  const messages = useMemo(() => (thread ? [thread.root, ...thread.replies] : []), [thread?.root, thread?.replies]);
  useEffect(() => { void a.maybeRead(); }, [thread?.replies.length]);
  if (route.view !== "conversation" || !route.thread) return null;
  const close = () => void a.go({ view: "conversation", id: route.id, thread: null, message: null });
  const where = viewing ? (viewing.kind === "direct" ? titleOf(viewing, people, me, w) : `#${viewing.name}`) : "";
  return (
    <aside className="thread-pane" aria-labelledby="thread-title" onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); close(); } }}>
      <header className="pane-head">
        <button type="button" className="icon-button back" aria-label={w.back} onClick={close}><Icon name="back" /></button>
        <h2 id="thread-title" className="title"><span>{w.thread}</span><span className="where">{where}</span></h2>
        <span className="grow" />
        {thread ? <Menu label={w.more} icon="more" items={[{ label: thread.following ? w.unfollow : w.follow, icon: "bell", run: () => void a.follow(thread.root.id, !thread.following) }]} /> : null}
        <button type="button" className="icon-button close" aria-label={w.close} title={w.close} onClick={close}><Icon name="close" /></button>
      </header>
      {thread ? (
        <>
          <MessageList key={thread.root.id} label={w.thread} messages={messages} before={thread.more} after={false} loading={thread.loading}
            newLine={null} focus={null} inThread={true} intro={null} onOlder={older} onNewer={noop} />
          <Typing conversation={route.id} thread={thread.root.id} />
          {viewing?.joined && !viewing.archived && !thread.root.deleted ? <Composer conversation={route.id} thread={thread.root.id} /> : null}
        </>
      ) : <div className="messages-frame" aria-busy="true" />}
    </aside>
  );
}
