import { connect, type Channel, type Live } from "@argentic/chest-sdk/realtime/client";
import type { Activity, Conversation, Details, FileInfo, Initial, Me, Message, Person, ReadEvent, Route, SearchResult, Sidebar, Thread, ThreadEvent, ThreadSummary } from "../shared/types.js";
import { pathOf, routeOf } from "../shared/route.js";
import { typingEvery, typingFor } from "../shared/rules.js";
import { ApiError, del, get, patch, post, put } from "./api.js";

// The page's state and everything that changes it: what the server
// rendered, then the member's actions and the Chest's live events. One
// store per page; components read slices of it (useStore) and call its
// actions. Nothing here runs on the server but building the first state.

// A message the page shows: one of the tool's, or one being sent (a
// negative id until the tool answers).
export type Outgoing = { object: string; name: string; info: FileInfo };
export type Shown = Message & { pending?: "sending" | "failed"; key?: string; outgoing?: Outgoing[] };

type PageState = { conversation: number; messages: Shown[]; before: boolean; after: boolean; loading: boolean; newLine: number | null; focus: number | null };
type ThreadState = { root: Shown; replies: Shown[]; more: boolean; following: boolean; lastRead: number; loading: boolean };
export type ListView = "threads" | "mentions" | "saved" | "drafts";
type ListState = { view: ListView; messages: Message[]; threads: ThreadSummary[]; more: boolean; loading: boolean };
type SearchState = { q: string; messages: Message[]; cursor: string | null; through: string | null; loading: boolean; done: boolean; error: string | null };
export type Dialog =
  | { kind: "switcher" | "direct" | "shortcuts" | "browse" }
  | { kind: "create"; name?: string }
  | { kind: "add"; conversation: number }
  | { kind: "confirm"; text: string; action: string; run: () => Promise<void> };
type Connection = "online" | "offline" | "access_removed" | "signed_out";

export type ViewState = {
  me: Me;
  organization: string;
  now: string;
  locked: boolean;
  conversations: Conversation[];
  viewing: Conversation | null;
  people: Record<string, Person>;
  drafts: Record<string, string>;
  threadsUnread: number;
  route: Route;
  // on a phone, the pane in front
  pane: "list" | "main" | "thread";
  page: PageState | null;
  thread: ThreadState | null;
  details: Details | null;
  detailsOpen: boolean;
  pinned: Message[] | null;
  away: Record<string, boolean>;
  typing: { conversation: number; thread: number | null; member: string; until: number }[];
  connection: Connection;
  missing: boolean;
  list: ListState | null;
  search: SearchState | null;
  dialog: Dialog | null;
  toast: { text: string; id: number } | null;
  editing: number | null;
};

export const draftKey = (conversation: number, thread: number | null) => `${conversation}:${thread ?? 0}`;

function first(initial: Initial): ViewState {
  const s = initial.state;
  const route = initial.route;
  return {
    me: s.me, organization: s.organization, now: s.now, locked: s.locked,
    conversations: s.conversations, viewing: initial.conversation,
    people: Object.fromEntries(s.people.map(p => [p.id, p])),
    drafts: Object.fromEntries(s.drafts.map(d => [draftKey(d.conversation, d.thread), d.text])),
    threadsUnread: s.threadsUnread, route,
    pane: initial.home ? "list" : route.view === "conversation" && route.thread ? "thread" : "main",
    page: initial.page && initial.conversation ? { conversation: initial.conversation.id, ...initial.page, loading: false, newLine: newLineOf(initial.conversation), focus: route.view === "conversation" ? route.message : null } : null,
    thread: initial.thread ? { ...initial.thread, loading: false } : null,
    details: null, detailsOpen: false, pinned: null,
    away: {}, typing: [], connection: "online", missing: initial.missing,
    list: null, search: route.view === "search" ? { q: route.q, messages: [], cursor: null, through: null, loading: route.q !== "", done: false, error: null } : null,
    dialog: null, toast: null, editing: null,
  };
}

const newLineOf = (c: Conversation) => (c.unread > 0 ? c.lastRead : null);

export type Store = ReturnType<typeof createStore>;

export function createStore(initial: Initial) {
  let state = first(initial);
  const listeners = new Set<() => void>();
  const set = (change: Partial<ViewState> | ((s: ViewState) => Partial<ViewState>)) => {
    state = { ...state, ...(typeof change === "function" ? change(state) : change) };
    for (const l of [...listeners]) l();
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  let live: Live | undefined;
  let everyone: Channel | undefined;
  let current: { id: number; channel: Channel; off: (() => void)[] } | undefined;
  let toastId = 0;
  // A draft is kept once the member pauses: its timer per conversation and
  // thread.
  const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // A draft being kept: a message sent meanwhile waits for it, so that the
  // post (which forgets the draft) comes after it.
  const draftRequests = new Map<string, Promise<unknown>>();
  let lastTyping = 0;
  let reading = false;
  // A conversation marked unread stays so while the member stays in it.
  let heldUnread: number | null = null;

  const toast = (text: string) => {
    const id = ++toastId;
    set({ toast: { text, id } });
    setTimeout(() => { if (state.toast?.id === id) set({ toast: null }); }, 5000);
  };
  // fail says what went wrong in words the page knows (words.failed by
  // default), never a code.
  let failWords = { failed: "", locked: "" };
  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.code === "locked") set({ locked: true });
    else toast(failWords.failed);
  };

  // People: named by the Chest, asked for as the page meets ids; what
  // shows a message waits for its names, so that nobody is shown nameless.
  const asking = new Map<string, Promise<void>>();
  const known = async (ids: Iterable<string>): Promise<void> => {
    const wanted = [...new Set(ids)].filter(Boolean);
    const missing = wanted.filter(id => !state.people[id] && !asking.has(id));
    for (let i = 0; i < missing.length; i += 200) {
      const batch = missing.slice(i, i + 200);
      const done = get<Person[]>(`/people?ids=${batch.join(",")}`)
        .then(found => set(s => ({ people: { ...s.people, ...Object.fromEntries(found.map(p => [p.id, p])) } })), () => { /* named on the next page */ })
        .finally(() => batch.forEach(id => asking.delete(id)));
      batch.forEach(id => asking.set(id, done));
    }
    await Promise.all(wanted.map(id => asking.get(id)));
  };
  const ensurePeople = (ids: Iterable<string>) => void known(ids);
  const peopleOf = (messages: Message[]) => messages.flatMap(m => [m.author, ...m.repliers, ...(m.meta?.members ?? []), ...m.reactions.flatMap(r => r.members)]);

  // The messages a page was told of live, fetched in one call per frame.
  let fetching = new Set<number>(), fetchTimer: ReturnType<typeof setTimeout> | undefined;
  const queueFetch = (id: number) => {
    fetching.add(id);
    fetchTimer ??= setTimeout(async () => {
      const ids = [...fetching];
      fetching = new Set();
      fetchTimer = undefined;
      try {
        const fetched = await get<Message[]>(`/messages?ids=${ids.join(",")}`);
        await known(peopleOf(fetched));
        merge(fetched);
      } catch (error) {
        if (error instanceof ApiError && error.code === "locked") set({ locked: true });
      }
    }, 30);
  };

  // Messages in their order, those being sent last.
  const byId = (a: Shown, b: Shown) => ((a.id < 0) !== (b.id < 0) ? (a.id < 0 ? 1 : -1) : a.id - b.id);
  // merge puts messages where the page shows them: its conversation's page,
  // the open thread, the lists.
  const merge = (messages: Message[]) => {
    if (!messages.length) return;
    ensurePeople(peopleOf(messages));
    set(s => {
      let page = s.page, thread = s.thread;
      for (const m of messages) {
        if (page && m.conversation === page.conversation && m.thread === null) {
          const at = page.messages.findIndex(x => x.id === m.id);
          if (at >= 0) page = { ...page, messages: page.messages.map(x => (x.id === m.id ? m : x)) };
          else if (!page.after && (!page.before || m.id > (page.messages.find(x => x.id > 0)?.id ?? 0))) page = { ...page, messages: [...page.messages, m].sort(byId) };
        }
        if (thread && (m.id === thread.root.id)) thread = { ...thread, root: m };
        else if (thread && m.thread === thread.root.id) {
          const at = thread.replies.findIndex(x => x.id === m.id);
          thread = { ...thread, replies: at >= 0 ? thread.replies.map(x => (x.id === m.id ? m : x)) : [...thread.replies, m].sort(byId) };
        }
      }
      return { page, thread };
    });
  };
  const dropMessage = (id: number) => set(s => ({
    page: s.page ? { ...s.page, messages: s.page.messages.filter(m => m.id !== id) } : null,
    thread: s.thread?.root.id === id ? null : s.thread ? { ...s.thread, replies: s.thread.replies.filter(m => m.id !== id) } : null,
    pinned: s.pinned?.filter(m => m.id !== id) ?? null,
  }));
  const updateMessage = (id: number, change: (m: Shown) => Shown) => set(s => ({
    page: s.page ? { ...s.page, messages: s.page.messages.map(m => (m.id === id ? change(m) : m)) } : null,
    thread: s.thread ? { ...s.thread, root: s.thread.root.id === id ? change(s.thread.root) : s.thread.root, replies: s.thread.replies.map(m => (m.id === id ? change(m) : m)) } : null,
    list: s.list ? { ...s.list, messages: s.list.messages.map(m => (m.id === id ? change(m) as Message : m)) } : null,
  }));
  const reactLocally = (id: number, emoji: string, member: string, on: boolean) => updateMessage(id, m => {
    const has = m.reactions.find(r => r.emoji === emoji);
    if (on && has?.members.includes(member)) return m;
    if (!on && !has?.members.includes(member)) return m;
    const reactions = on
      ? has ? m.reactions.map(r => (r.emoji === emoji ? { ...r, members: [...r.members, member] } : r)) : [...m.reactions, { emoji, members: [member] }]
      : m.reactions.map(r => (r.emoji === emoji ? { ...r, members: r.members.filter(x => x !== member) } : r)).filter(r => r.members.length);
    return { ...m, reactions };
  });

  const updateConversation = (id: number, change: (c: Conversation) => Conversation) => set(s => ({
    conversations: s.conversations.map(c => (c.id === id ? change(c) : c)),
    viewing: s.viewing?.id === id ? change(s.viewing) : s.viewing,
  }));

  const refreshSidebar = async () => {
    try {
      const sidebar = await get<Sidebar>("/sidebar");
      set(s => {
        const viewing = s.viewing ? sidebar.conversations.find(c => c.id === s.viewing!.id) ?? { ...s.viewing, joined: false } : null;
        const lost = s.viewing && s.viewing.kind !== "public" && !sidebar.conversations.some(c => c.id === s.viewing!.id);
        return { conversations: sidebar.conversations, people: { ...s.people, ...Object.fromEntries(sidebar.people.map(p => [p.id, p])) }, threadsUnread: sidebar.threadsUnread, viewing: lost ? null : viewing, missing: s.missing || !!lost };
      });
      if (state.viewing && state.viewing.joined && current?.id !== state.viewing.id) follow(state.viewing.id);
    } catch { /* the next event tries again */ }
  };

  // The live channel of the conversation shown: its feeds and typing.
  const follow = (id: number | null) => {
    if (current && current.id !== id) {
      current.off.forEach(f => f());
      current.channel.leave();
      current = undefined;
    }
    if (!live || id === null || current) return;
    const channel = live.channel(`c:${id}`);
    // The Chest's events (feeds, kicked) come without a sender; members'
    // sends come with one. A member could send an event of any name on the
    // channel: only typing is taken from a member, the rest only from the
    // Chest.
    const chest = (listener: (payload: unknown) => void) => (payload: unknown, from: string | undefined) => { if (from === undefined) listener(payload); };
    const row = (p: unknown) => (p !== null && typeof p === "object" ? p as Record<string, unknown> : {});
    const idOf = (p: unknown) => (typeof row(p)["id"] === "number" ? row(p)["id"] as number : null);
    const reaction = (on: boolean) => chest(p => {
      const r = row(p);
      if (typeof r["message_id"] !== "number" || typeof r["emoji"] !== "string" || typeof r["member_id"] !== "string") return;
      ensurePeople([r["member_id"]]);
      reactLocally(r["message_id"], r["emoji"], r["member_id"], on);
    });
    const off = [
      channel.on("joined", ({ replayed }) => { if (!replayed) void catchUp(id); }),
      channel.on("resync", () => void catchUp(id)),
      channel.on("messages.insert", chest(p => { const m = idOf(p); if (m) queueFetch(m); })),
      channel.on("messages.update", chest(p => { const m = idOf(p); if (m) queueFetch(m); })),
      channel.on("messages.delete", chest(p => { const m = idOf(p); if (m) dropMessage(m); })),
      channel.on("reactions.insert", reaction(true)),
      channel.on("reactions.delete", reaction(false)),
      channel.on("typing", (p, from) => {
        if (!from || from === state.me.id) return;
        const thread = typeof (p as { t?: unknown })?.t === "number" ? (p as { t: number }).t : null;
        set(s => ({ typing: [...s.typing.filter(t => !(t.member === from && t.conversation === id)), { conversation: id, thread, member: from, until: Date.now() + typingFor }] }));
        ensurePeople([from]);
      }),
      // Taken out (or never let in): no live channel any more; the sidebar
      // says what the member still has.
      channel.on("kicked", () => { follow(null); void refreshSidebar(); }),
      channel.on("refused", code => {
        follow(null);
        if (code === "forbidden") void refreshSidebar();
        else setTimeout(() => { if (state.viewing?.id === id && state.viewing.joined && !current) follow(id); }, 5000);
      }),
    ];
    current = { id, channel, off };
  };

  // catchUp sets right what live events may have missed (they come at
  // most once): the latest page again, or the messages shown, and the open
  // thread.
  let catchUpAfterLoad = false;
  const catchUp = async (id: number) => {
    const page = state.page;
    if (!page || page.conversation !== id) return;
    // A page being loaded: what came meanwhile is fetched once it is in.
    if (page.loading) { catchUpAfterLoad = true; return; }
    if (!page.after) {
      const newest = [...page.messages].reverse().find(m => m.id > 0)?.id;
      if (newest === undefined) await reloadPage(id);
      else {
        try {
          const newer = await get<{ messages: Message[]; after: boolean }>(`/conversations/${id}/messages?after=${newest}`);
          if (newer.after) await reloadPage(id);
          else {
            await known(peopleOf(newer.messages));
            merge(newer.messages);
            const shown = page.messages.filter(m => m.id > 0).map(m => m.id).slice(-200);
            if (shown.length) merge(await get<Message[]>(`/messages?ids=${shown.join(",")}`));
          }
        } catch { /* the next join tries again */ }
      }
    }
    else {
      const shown = page.messages.filter(m => m.id > 0).map(m => m.id);
      try { if (shown.length) merge(await get<Message[]>(`/messages?ids=${shown.slice(-200).join(",")}`)); } catch { /* the next join tries again */ }
    }
    if (state.thread) void reloadThread(state.thread.root.id);
  };

  const reloadPage = async (id: number, at: { around?: number } = {}) => {
    try {
      const page = await get<{ messages: Message[]; before: boolean; after: boolean }>(`/conversations/${id}/messages${at.around ? `?around=${at.around}` : ""}`);
      await known(peopleOf(page.messages));
      set(s => {
        if (s.viewing?.id !== id) return {};
        // What is being sent, or failed, stays where it was.
        const pending = s.page?.conversation === id ? s.page.messages.filter(m => m.pending) : [];
        return { page: { conversation: id, ...page, messages: [...page.messages, ...pending], loading: false, newLine: s.page?.conversation === id ? s.page.newLine : null, focus: at.around ?? (s.page?.conversation === id ? s.page.focus : null) } };
      });
      if (catchUpAfterLoad) {
        catchUpAfterLoad = false;
        void catchUp(id);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) set({ missing: true, page: null });
      else fail(error);
    }
  };

  const reloadThread = async (root: number) => {
    try {
      const thread = await get<Thread>(`/threads/${root}`);
      await known(peopleOf([thread.root, ...thread.replies]));
      set(s => (s.route.view === "conversation" && s.route.thread === root ? { thread: { ...thread, replies: [...thread.replies, ...(s.thread?.root.id === root ? s.thread.replies.filter(m => m.pending) : [])], loading: false } } : {}));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) set({ thread: null });
      else fail(error);
    }
  };

  // Direct events: the member's own.
  const direct = (event: string, payload: unknown) => {
    if (event === "activity") {
      const a = payload as Activity;
      const c = state.conversations.find(x => x.id === a.c);
      if (!c) return void refreshSidebar();
      const mine = a.a === state.me.id;
      const named = a.mentions.includes(state.me.id) || a.all;
      updateConversation(a.c, x => a.t === null
        ? mine ? { ...x, lastMessageId: a.m, lastMessageAt: new Date().toISOString(), unread: 0, mentions: 0, lastRead: a.m }
          : { ...x, lastMessageId: a.m, lastMessageAt: new Date().toISOString(), unread: a.m > x.lastRead ? Math.min(x.unread + 1, 100) : x.unread, mentions: x.mentions + (named && a.m > x.lastRead ? 1 : 0) }
        : { ...x, mentions: x.mentions + (named && !mine ? 1 : 0) });
      if (state.list?.view === "mentions" && named && !mine) void loadList("mentions");
    } else if (event === "thread") {
      const t = payload as ThreadEvent;
      if (t.a !== state.me.id) laterSidebar();
      if (state.list?.view === "threads") void loadList("threads");
    } else if (event === "read") {
      const r = payload as ReadEvent;
      if (r.t !== null) return void refreshSidebar();
      const c = state.conversations.find(x => x.id === r.c);
      if (c && r.m >= c.lastMessageId) updateConversation(r.c, x => ({ ...x, lastRead: r.m, unread: 0, mentions: 0 }));
      else void refreshSidebar();
    } else if (event === "conversations") void refreshSidebar();
  };

  const visible = () => typeof document !== "undefined" && document.visibilityState === "visible";
  // laterSidebar asks the sidebar again once things settle: the threads'
  // count is the tool's to say.
  let sidebarTimer: ReturnType<typeof setTimeout> | undefined;
  const laterSidebar = () => {
    clearTimeout(sidebarTimer);
    sidebarTimer = setTimeout(() => void refreshSidebar(), 400);
  };

  // start connects the page once it runs in a browser.
  const start = (words: { failed: string; locked: string }) => {
    failWords = words;
    live = connect();
    everyone = live.channel("everyone");
    const track = () => everyone?.presence.track({ away: !visible() });
    track();
    document.addEventListener("visibilitychange", () => {
      track();
      if (visible()) maybeRead();
    });
    everyone.presence.on(list => set({ away: Object.fromEntries(list.map(p => [p.id, p.state["away"] === true])) }));
    let lost = false;
    live.on("status", connected => {
      set({ connection: connected ? "online" : "offline" });
      if (connected && lost) void refreshSidebar();
      lost = !connected;
    });
    live.on("closed", reason => set({ connection: reason }));
    live.on("direct", direct);
    if (state.viewing?.joined) follow(state.viewing.id);
    window.addEventListener("popstate", () => {
      const route = routeOf(location.pathname, new URLSearchParams(location.search));
      if (route) void go(route, { history: false });
    });
    setInterval(() => {
      const now = Date.now();
      if (state.typing.some(t => t.until <= now)) set(s => ({ typing: s.typing.filter(t => t.until > now) }));
    }, 1000);
    ensurePeople([...peopleOf(state.page?.messages ?? []), ...(state.thread ? peopleOf([state.thread.root, ...state.thread.replies]) : [])]);
    if (state.route.view === "search" && state.search?.q) void search(state.search.q);
    if (state.route.view !== "conversation" && state.route.view !== "search" && state.route.view !== "browse") void loadList(state.route.view);
  };

  // go opens a route: the conversation, thread, list or search it names.
  const go = async (route: Route, options: { history?: boolean; replace?: boolean } = {}) => {
    const before = state.route;
    if (options.history !== false && typeof history !== "undefined") {
      if (options.replace) history.replaceState(null, "", pathOf(route));
      else history.pushState(null, "", pathOf(route));
    }
    const pane = route.view === "conversation" && route.thread ? "thread" : "main";
    if (route.view !== "conversation" || route.id !== heldUnread) heldUnread = null;
    set({ route, pane, dialog: null, editing: null });
    if (route.view === "conversation") {
      const sameConversation = before.view === "conversation" && before.id === route.id && state.page?.conversation === route.id && !state.missing;
      if (!sameConversation) {
        const known = state.conversations.find(c => c.id === route.id) ?? null;
        set({ viewing: known, page: known ? { conversation: route.id, messages: [], before: false, after: false, loading: true, newLine: newLineOf(known), focus: route.message } : null, missing: false, details: null, pinned: null, thread: null });
        follow(known?.joined ? route.id : null);
        try {
          const viewing = known ?? await get<Conversation>(`/conversations/${route.id}`);
          if (!known) set({ viewing });
          await reloadPage(route.id, route.message ? { around: route.message } : {});
          if (state.page) set(s => ({ page: s.page ? { ...s.page, newLine: newLineOf(viewing) } : null }));
          if (state.detailsOpen) void loadDetails(route.id);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) set({ missing: true, viewing: null, page: null });
          else fail(error);
        }
      } else if (route.message) {
        if (!state.page?.messages.some(m => m.id === route.message)) await reloadPage(route.id, { around: route.message });
        else set(s => ({ page: s.page ? { ...s.page, focus: route.message } : null }));
      }
      if (route.thread && state.thread?.root.id !== route.thread) {
        set({ thread: null });
        await reloadThread(route.thread);
      } else if (!route.thread) set({ thread: null });
    } else {
      follow(null);
      set({ viewing: null, page: null, thread: null, missing: false });
      if (route.view === "search") {
        if (route.q) void search(route.q);
        else set({ search: { q: "", messages: [], cursor: null, through: null, loading: false, done: false, error: null } });
      } else if (route.view !== "browse") void loadList(route.view);
    }
  };

  const loadList = async (view: ListView, more = false) => {
    const current = state.list?.view === view ? state.list : null;
    set({ list: { view, messages: more ? current?.messages ?? [] : current?.messages ?? [], threads: more ? current?.threads ?? [] : current?.threads ?? [], more: current?.more ?? false, loading: true } });
    try {
      if (view === "threads") {
        const cursor = more ? state.list?.threads.at(-1)?.root.id : undefined;
        const threads = await get<ThreadSummary[]>(`/threads${cursor ? `?before=${cursor}` : ""}`);
        await known(peopleOf(threads.flatMap(t => [t.root, ...t.latest])));
        set(s => ({ list: { view, messages: [], threads: more ? [...(s.list?.threads ?? []), ...threads] : threads, more: threads.length === 20, loading: false } }));
      } else if (view === "drafts") {
        const drafts = await get<{ conversation: number; thread: number | null; text: string }[]>("/drafts");
        set({ drafts: Object.fromEntries(drafts.map(d => [draftKey(d.conversation, d.thread), d.text])), list: { view, messages: [], threads: [], more: false, loading: false } });
      } else {
        const last = more ? state.list?.messages.at(-1) : undefined;
        const messages = await get<Message[]>(`/${view}${last ? `?before=${last.id}` : ""}`);
        await known(peopleOf(messages));
        set(s => ({ list: { view, messages: more ? [...(s.list?.messages ?? []), ...messages] : messages, threads: [], more: messages.length === 30, loading: false } }));
      }
    } catch (error) {
      set(s => ({ list: s.list ? { ...s.list, loading: false } : null }));
      fail(error);
    }
  };

  const search = async (q: string, more = false) => {
    const prior = more ? state.search : null;
    set({ search: { q, messages: prior?.messages ?? [], cursor: prior?.cursor ?? null, through: prior?.through ?? null, loading: true, done: false, error: null } });
    try {
      const result = await get<SearchResult>(`/search?q=${encodeURIComponent(q)}${prior?.cursor ? `&cursor=${prior.cursor}` : ""}`);
      await known(peopleOf(result.messages));
      set(s => (s.search?.q === q ? { search: { q, messages: [...(prior?.messages ?? []), ...result.messages], cursor: result.cursor, through: result.through, loading: false, done: result.cursor === null, error: null } } : {}));
    } catch (error) {
      set(s => ({ search: s.search ? { ...s.search, loading: false, error: error instanceof ApiError ? error.code : "failed" } : null }));
    }
  };

  const loadDetails = async (id: number) => {
    try {
      const [details, pinned] = await Promise.all([get<Details>(`/conversations/${id}/details`), get<Message[]>(`/conversations/${id}/pinned`)]);
      await known([...details.members, ...peopleOf(pinned)]);
      set(s => (s.viewing?.id === id ? { details, pinned } : {}));
    } catch (error) {
      fail(error);
    }
  };

  // maybeRead marks what the member sees as read: the conversation once its
  // latest message is on screen, the open thread.
  let atBottom = true;
  const maybeRead = async () => {
    if (!visible() || reading) return;
    const page = state.page, viewing = state.viewing;
    if (page && viewing?.joined && !page.after && atBottom && heldUnread !== viewing.id) {
      const last = [...page.messages].reverse().find(m => m.id > 0);
      if (last && (last.id > viewing.lastRead || viewing.unread > 0 || viewing.mentions > 0)) {
        reading = true;
        updateConversation(viewing.id, c => ({ ...c, lastRead: last.id, unread: 0, mentions: 0 }));
        try { await put(`/conversations/${viewing.id}/read`, { message: last.id }); } catch { /* read again later */ }
        reading = false;
      }
    }
    const thread = state.thread;
    if (thread && (state.pane === "thread" || typeof window === "undefined" || window.innerWidth >= 768)) {
      const last = thread.replies.filter(m => m.id > 0).at(-1);
      if (last && last.id > thread.lastRead && thread.following) {
        set(s => ({ thread: s.thread ? { ...s.thread, lastRead: last.id } : null }));
        try { await put(`/threads/${thread.root.id}/read`, { message: last.id }); } catch { /* read again later */ }
        laterSidebar();
      }
    }
  };

  const actions = {
    start, go, merge, refreshSidebar, loadList, search, loadDetails, ensurePeople, toast, fail,
    setAtBottom(value: boolean) {
      atBottom = value;
      if (value) void maybeRead();
    },
    maybeRead,
    // markRead marks the conversation shown read, as the member asks (Esc).
    async markRead() {
      const viewing = state.viewing;
      if (!viewing?.joined || !viewing.lastMessageId) return;
      heldUnread = null;
      updateConversation(viewing.id, c => ({ ...c, lastRead: c.lastMessageId, unread: 0, mentions: 0 }));
      set(s => ({ page: s.page ? { ...s.page, newLine: null } : null }));
      try { await put(`/conversations/${viewing.id}/read`, { message: viewing.lastMessageId }); } catch { /* read again later */ }
    },
    setPane(pane: ViewState["pane"]) { set({ pane }); },
    openDialog(dialog: Dialog | null) { set({ dialog }); },
    setEditing(id: number | null) { set({ editing: id }); },
    toggleDetails(open?: boolean) {
      const next = open ?? !state.detailsOpen;
      set({ detailsOpen: next });
      if (next && state.viewing) void loadDetails(state.viewing.id);
    },
    async loadOlder() {
      const page = state.page;
      if (!page || page.loading || !page.before) return;
      const oldest = page.messages.find(m => m.id > 0);
      if (!oldest) return;
      set({ page: { ...page, loading: true } });
      try {
        const older = await get<{ messages: Message[]; before: boolean }>(`/conversations/${page.conversation}/messages?before=${oldest.id}`);
        await known(peopleOf(older.messages));
        set(s => (s.page?.conversation === page.conversation ? { page: { ...s.page, messages: [...older.messages, ...s.page.messages], before: older.before, loading: false } } : {}));
      } catch (error) {
        set(s => ({ page: s.page ? { ...s.page, loading: false } : null }));
        fail(error);
      }
    },
    async loadNewer() {
      const page = state.page;
      if (!page || page.loading || !page.after) return;
      const newest = [...page.messages].reverse().find(m => m.id > 0);
      if (!newest) return;
      set({ page: { ...page, loading: true } });
      try {
        const newer = await get<{ messages: Message[]; after: boolean }>(`/conversations/${page.conversation}/messages?after=${newest.id}`);
        await known(peopleOf(newer.messages));
        set(s => (s.page?.conversation === page.conversation ? { page: { ...s.page, messages: [...s.page.messages, ...newer.messages], after: newer.after, loading: false } } : {}));
      } catch (error) {
        set(s => ({ page: s.page ? { ...s.page, loading: false } : null }));
        fail(error);
      }
    },
    async loadOlderReplies() {
      const thread = state.thread;
      if (!thread || thread.loading || !thread.more) return;
      const oldest = thread.replies.find(m => m.id > 0);
      if (!oldest) return;
      set({ thread: { ...thread, loading: true } });
      try {
        const older = await get<Thread>(`/threads/${thread.root.id}?before=${oldest.id}`);
        await known(peopleOf(older.replies));
        set(s => (s.thread?.root.id === thread.root.id ? { thread: { ...s.thread, replies: [...older.replies, ...s.thread.replies], more: older.more, loading: false } } : {}));
      } catch (error) {
        set(s => ({ thread: s.thread ? { ...s.thread, loading: false } : null }));
        fail(error);
      }
    },
    async jumpToLatest() {
      if (state.viewing) await reloadPage(state.viewing.id);
    },

    // send: the message shows at once, then as the tool kept it.
    async send(conversation: number, thread: number | null, text: string, files: Outgoing[]) {
      const key = `p${Date.now()}${Math.random()}`;
      const draft: Shown = {
        id: -Date.now(), conversation, thread, author: state.me.id, kind: "message", text, meta: null, mentions: [], mentionAll: false,
        createdAt: new Date().toISOString(), editedAt: null, deleted: false, pinned: false, replyCount: 0, lastReplyAt: null, repliers: [],
        reactions: [], files: files.map(f => f.info), saved: false, pending: "sending", key, outgoing: files,
      };
      const place = (m: Shown | null) => set(s => {
        const swap = (list: Shown[]) => {
          const without = list.filter(x => x.key !== key);
          return m && !without.some(x => x.id === m.id) ? [...without, m].sort(byId) : without;
        };
        return {
          page: s.page && thread === null && s.page.conversation === conversation ? { ...s.page, messages: swap(s.page.messages) } : s.page,
          thread: s.thread && thread === s.thread.root.id ? { ...s.thread, replies: swap(s.thread.replies) } : s.thread,
        };
      });
      place(draft);
      // Sent: the draft goes, and a draft about to be kept is not.
      clearTimeout(draftTimers.get(draftKey(conversation, thread)));
      draftTimers.delete(draftKey(conversation, thread));
      if (thread === null && heldUnread === conversation) heldUnread = null;
      set(s => ({ drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== draftKey(conversation, thread))) }));
      try {
        await draftRequests.get(draftKey(conversation, thread));
        const sent = await post<Message>(`/conversations/${conversation}/messages`, { text, thread, files: files.map(f => ({ object: f.object, name: f.name })) });
        place(sent);
        // Writing in a thread follows it.
        if (thread !== null) set(st => ({ thread: st.thread?.root.id === thread ? { ...st.thread, following: true, lastRead: Math.max(st.thread.lastRead, sent.id) } : st.thread }));
        if (thread === null) updateConversation(conversation, c => ({ ...c, lastRead: sent.id, lastMessageId: sent.id, lastMessageAt: sent.createdAt, unread: 0, mentions: 0 }));
        return true;
      } catch (error) {
        place({ ...draft, pending: "failed" });
        if (error instanceof ApiError && error.code === "locked") set({ locked: true });
        return false;
      }
    },
    async retry(m: Shown) {
      set(s => ({
        page: s.page ? { ...s.page, messages: s.page.messages.filter(x => x.key !== m.key) } : null,
        thread: s.thread ? { ...s.thread, replies: s.thread.replies.filter(x => x.key !== m.key) } : null,
      }));
      await actions.send(m.conversation, m.thread, m.text ?? "", m.outgoing ?? []);
    },
    discard(m: Shown) {
      set(s => ({
        page: s.page ? { ...s.page, messages: s.page.messages.filter(x => x.key !== m.key) } : null,
        thread: s.thread ? { ...s.thread, replies: s.thread.replies.filter(x => x.key !== m.key) } : null,
      }));
    },
    async edit(id: number, text: string) {
      try {
        merge([await patch<Message>(`/messages/${id}`, { text })]);
        set({ editing: null });
      } catch (error) { fail(error); }
    },
    async remove(id: number) {
      try {
        await del(`/messages/${id}`);
        const shown = state.page?.messages.find(m => m.id === id) ?? state.thread?.replies.find(m => m.id === id);
        if (shown && shown.thread === null && shown.replyCount > 0) updateMessage(id, m => ({ ...m, deleted: true, text: "", files: [], reactions: [] }));
        else dropMessage(id);
      } catch (error) { fail(error); }
    },
    async react(id: number, emoji: string, on: boolean) {
      reactLocally(id, emoji, state.me.id, on);
      try { await put(`/messages/${id}/reactions`, { emoji, on }); } catch (error) {
        reactLocally(id, emoji, state.me.id, !on);
        fail(error);
      }
    },
    async pin(id: number, on: boolean) {
      updateMessage(id, m => ({ ...m, pinned: on }));
      try {
        await put(`/messages/${id}/pin`, { on });
        if (state.detailsOpen && state.viewing) void loadDetails(state.viewing.id);
      } catch (error) {
        updateMessage(id, m => ({ ...m, pinned: !on }));
        fail(error);
      }
    },
    async save(id: number, on: boolean) {
      updateMessage(id, m => ({ ...m, saved: on }));
      try {
        await put(`/messages/${id}/saved`, { on });
        if (!on && state.list?.view === "saved") set(s => ({ list: s.list ? { ...s.list, messages: s.list.messages.filter(m => m.id !== id) } : null }));
      } catch (error) {
        updateMessage(id, m => ({ ...m, saved: !on }));
        fail(error);
      }
    },
    async markUnread(id: number) {
      try {
        const r = await post<{ conversation: number; thread: number | null; lastRead: number }>(`/messages/${id}/unread`);
        if (r.thread === null) {
          set(s => ({ page: s.page?.conversation === r.conversation ? { ...s.page, newLine: r.lastRead } : s.page }));
          heldUnread = r.conversation;
        }
        await refreshSidebar();
      } catch (error) { fail(error); }
    },
    async follow(root: number, on: boolean) {
      set(s => ({ thread: s.thread?.root.id === root ? { ...s.thread, following: on } : s.thread }));
      try { await put(`/threads/${root}/follow`, { on }); } catch (error) { fail(error); }
    },

    // The composer.
    keepDraft(conversation: number, thread: number | null, text: string) {
      const key = draftKey(conversation, thread);
      set(s => ({ drafts: text.trim() ? { ...s.drafts, [key]: text } : Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== key)) }));
      clearTimeout(draftTimers.get(key));
      draftTimers.set(key, setTimeout(() => {
        draftTimers.delete(key);
        const kept = put("/drafts", { conversation, thread, text }).catch(() => { /* kept on the page; the next keystroke tries again */ });
        draftRequests.set(key, kept);
        void kept.finally(() => { if (draftRequests.get(key) === kept) draftRequests.delete(key); });
      }, 800));
    },
    typing(conversation: number, thread: number | null) {
      if (!current || current.id !== conversation || Date.now() - lastTyping < typingEvery) return;
      lastTyping = Date.now();
      current.channel.send("typing", { t: thread });
    },
    stopTyping() { lastTyping = 0; },

    // Conversations.
    async create(input: { kind: "public" | "private"; name: string; about?: string; members: string[]; groups: string[] }) {
      const made = await post<Conversation>("/conversations", input);
      set(s => ({ conversations: [...s.conversations.filter(c => c.id !== made.id), made] }));
      await go({ view: "conversation", id: made.id, thread: null, message: null });
    },
    async direct(members: string[]) {
      const made = await post<Conversation>("/direct", { members });
      set(s => ({ conversations: [...s.conversations.filter(c => c.id !== made.id), made] }));
      ensurePeople(made.people);
      await go({ view: "conversation", id: made.id, thread: null, message: null });
    },
    async join(id: number) {
      try {
        const joined = await post<Conversation>(`/conversations/${id}/join`);
        set(s => ({ conversations: [...s.conversations.filter(c => c.id !== id), joined], viewing: s.viewing?.id === id ? joined : s.viewing }));
        follow(id);
      } catch (error) { fail(error); }
    },
    async leave(id: number) {
      await post(`/conversations/${id}/leave`);
      set(s => ({ conversations: s.conversations.filter(c => c.id !== id), detailsOpen: false }));
      const next = state.conversations.find(c => c.isDefault) ?? state.conversations[0];
      await go(next ? { view: "conversation", id: next.id, thread: null, message: null } : { view: "browse" });
    },
    async add(id: number, members: string[], groups: string[]) {
      await post(`/conversations/${id}/members`, { members, groups });
      void loadDetails(id);
    },
    async removeMember(id: number, member: string) {
      try {
        await del(`/conversations/${id}/members/${member}`);
        void loadDetails(id);
      } catch (error) { fail(error); }
    },
    async removeGroup(id: number, group: string) {
      try {
        await del(`/conversations/${id}/groups/${group}`);
        void loadDetails(id);
      } catch (error) { fail(error); }
    },
    async update(id: number, change: { name?: string; about?: string; archived?: boolean; confidential?: boolean }) {
      // A switch moves at once; the answer sets it right.
      if (change.confidential !== undefined) updateConversation(id, c => ({ ...c, confidential: change.confidential! }));
      const updated = await patch<Conversation>(`/conversations/${id}`, change);
      updateConversation(id, () => updated);
      if (change.archived) set(s => ({ conversations: s.conversations.filter(c => c.id !== id), viewing: s.viewing?.id === id ? updated : s.viewing }));
      if (change.archived === false) set(s => ({ conversations: [...s.conversations.filter(c => c.id !== id), updated] }));
      if (state.detailsOpen) void loadDetails(id);
    },
    async settings(id: number, change: { notify?: Conversation["notify"]; starred?: boolean }) {
      updateConversation(id, c => ({ ...c, ...change }));
      try { await put(`/conversations/${id}/settings`, change); } catch (error) { fail(error); }
    },
    async people(q: string): Promise<Person[]> {
      const found = await get<Person[]>(`/people?q=${encodeURIComponent(q)}`);
      set(s => ({ people: { ...s.people, ...Object.fromEntries(found.map(p => [p.id, p])) } }));
      return found;
    },
    groups: () => get<{ id: string; name: string; size: number }[]>("/groups"),
    browse: () => get<Conversation[]>("/conversations"),
  };

  return { get: () => state, subscribe, actions };
}
