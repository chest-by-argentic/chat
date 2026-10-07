import { useEffect, useState } from "react";
import type { Initial } from "../shared/types.js";
import { routeOf } from "../shared/route.js";
import { words as wordsOf } from "../shared/i18n/index.js";
import { createStore } from "./store.js";
import { StoreContext, WordsContext, useActions, useSnapshot, useStore, useWords } from "./context.js";
import { Sidebar } from "./Sidebar.js";
import { ConversationView } from "./ConversationView.js";
import { ThreadPane } from "./ThreadPane.js";
import { DetailsPane } from "./DetailsPane.js";
import { ListView, SearchView } from "./Views.js";
import { Dialogs } from "./Dialogs.js";

// Chat: the whole page, rendered by the server with what it knows, then
// live in the browser.
export function Chat({ initial }: { initial: Initial }) {
  const [store] = useState(() => createStore(initial));
  const words = wordsOf(initial.state.me.language);
  return (
    <StoreContext.Provider value={store}>
      <WordsContext.Provider value={words}>
        <Frame />
      </WordsContext.Provider>
    </StoreContext.Provider>
  );
}

function Frame() {
  const w = useWords();
  const a = useActions();
  const snapshot = useSnapshot();
  const route = useStore(s => s.route);
  const pane = useStore(s => s.pane);
  const thread = useStore(s => s.route.view === "conversation" && s.route.thread !== null);
  const details = useStore(s => s.detailsOpen && s.route.view === "conversation");
  const connection = useStore(s => s.connection);
  const toast = useStore(s => s.toast);
  const attention = useStore(s => s.conversations.reduce((n, c) => n + (c.notify === "none" ? 0 : c.kind === "direct" ? c.unread : c.mentions), 0));

  useEffect(() => a.start({ failed: w.failed, locked: w.locked }), []);
  useEffect(() => { document.title = attention ? `(${attention}) ${w.title}` : w.title; }, [attention]);

  // The page's keys, and its own links handled in place.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const s = snapshot();
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); a.openDialog(s.dialog?.kind === "switcher" ? null : { kind: "switcher" }); return; }
      if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); void a.go({ view: "search", q: "" }); return; }
      if (mod && e.key === "/") { e.preventDefault(); a.openDialog({ kind: "shortcuts" }); return; }
      if (s.dialog) return;
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const order = [...document.querySelectorAll<HTMLAnchorElement>(".sidebar .section a.row")];
        const at = order.findIndex(x => x.getAttribute("aria-current") === "page");
        const step = e.key === "ArrowDown" ? 1 : -1;
        for (let i = at + step; i >= 0 && i < order.length; i += step) {
          if (!e.shiftKey || order[i]!.classList.contains("unread")) { order[i]!.click(); break; }
        }
        return;
      }
      if (e.key === "Escape" && !e.defaultPrevented && s.route.view === "conversation") {
        if (s.detailsOpen) a.toggleDetails(false);
        else if (s.route.thread) void a.go({ ...s.route, thread: null, message: null });
        else void a.maybeRead();
      }
    };
    const links = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target || link.origin !== location.origin || !link.pathname.startsWith("/chest/") || link.pathname.startsWith("/chest/api/")) return;
      const route = routeOf(link.pathname, new URLSearchParams(link.search));
      if (!route) return;
      e.preventDefault();
      void a.go(route);
    };
    document.addEventListener("keydown", keys);
    document.addEventListener("click", links);
    return () => { document.removeEventListener("keydown", keys); document.removeEventListener("click", links); };
  }, []);

  return (
    <div className="app" data-pane={pane} data-thread={thread} data-details={details}>
      <a className="skip" href="#main">{w.title}</a>
      <Sidebar />
      {route.view === "conversation" ? <ConversationView /> : route.view === "search" ? <SearchView /> : <ListView />}
      {route.view === "conversation" ? <ThreadPane /> : null}
      {details ? <DetailsPane /> : null}
      <Dialogs />
      {connection !== "online" ? (
        <div className={connection === "offline" ? "banner" : "banner blocking"} role="status">
          {connection === "offline" ? w.offline : connection === "access_removed" ? w.accessRemoved : w.signedOut}
          {connection === "signed_out" ? <button type="button" className="button small" onClick={() => location.reload()}>{w.reload}</button> : null}
        </div>
      ) : null}
      {toast ? <div className="toast" role="status" key={toast.id}>{toast.text}</div> : null}
    </div>
  );
}
