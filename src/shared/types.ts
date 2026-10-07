// What the tool's API answers and the page holds: one shape on both sides.

export type Kind = "public" | "private" | "direct";
// How a member is told of a conversation: all, mentions or nothing;
// "default" follows the kind (all for direct messages, mentions for
// channels).
export type NotifySetting = "default" | "all" | "mentions" | "none";
export type Notify = Exclude<NotifySetting, "default">;

// A person as the Chest names them to the tool, now: a member who has it,
// someone it had (former, no_access, erased), or an id it never had.
export type Person = {
  id: string;
  name: string;
  photo: string | null;
  status: "member" | "former" | "no_access" | "erased" | "unknown";
};

export type Me = { id: string; name: string; isAdmin: boolean; language: string; timeZone: string };

// A conversation as the sidebar shows it to one member.
export type Conversation = {
  id: number;
  kind: Kind;
  name: string | null;
  // direct: the people in it, the member included
  people: string[];
  archived: boolean;
  joined: boolean;
  starred: boolean;
  notify: NotifySetting;
  // top-level messages after the last one read (at most 100, "99+")
  unread: number;
  mentions: number;
  lastRead: number;
  lastMessageId: number;
  lastMessageAt: string | null;
  isDefault: boolean;
  createdBy: string | null;
};

// A conversation's details: its description (opened), members, groups,
// pinned messages.
export type Details = {
  id: number;
  about: string | null;
  members: string[];
  groups: { id: string; name: string }[];
  canManage: boolean;
  memberCount: number;
};

export type FileInfo = {
  id: number;
  // the name the member gave it (opened), null when it cannot be shown
  name: string | null;
  type: string;
  size: number;
  width: number | null;
  height: number | null;
};

export type Reaction = { emoji: string; members: string[] };

export type SystemKind = "created" | "joined" | "left" | "added" | "removed" | "renamed" | "about" | "archived" | "unarchived";

export type Message = {
  id: number;
  conversation: number;
  thread: number | null;
  author: string;
  kind: "message" | SystemKind;
  // the text (opened); null when it cannot be shown to this member, "" once deleted
  text: string | null;
  // the tool's lines: people added or removed, groups added (by name, as
  // they were called), a channel's former and new name
  meta: { members?: string[]; groups?: string[]; from?: string; to?: string } | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  pinned: boolean;
  replyCount: number;
  lastReplyAt: string | null;
  repliers: string[];
  reactions: Reaction[];
  files: FileInfo[];
  saved: boolean;
};

// A page of a conversation's messages, oldest first; more says whether
// older (before) or newer (after) messages remain.
export type Page = { messages: Message[]; before: boolean; after: boolean };

// A thread: its root, its latest replies (more: older ones remain).
export type Thread = { root: Message; replies: Message[]; more: boolean; following: boolean; lastRead: number };

// A followed thread, as the Threads view lists it.
export type ThreadSummary = { root: Message; unread: number; latest: Message[] };

export type SearchResult = {
  messages: Message[];
  // where to continue (older), null once everything was looked through
  cursor: string | null;
  // the date of the oldest message looked at, when the search stopped early
  through: string | null;
  scanned: number;
};

export type Draft = { conversation: number; thread: number | null; text: string; updatedAt: string };

// What a page is given when it is rendered: the member, the organisation,
// their conversations, the people they show, and the route's content.
export type State = {
  me: Me;
  organization: string;
  conversations: Conversation[];
  people: Person[];
  drafts: Draft[];
  // followed threads with unread replies
  threadsUnread: number;
  locked: boolean;
  // when the page was rendered: what "Today" is on its first render
  now: string;
};

// Where a page is: a conversation (a thread open beside it, a message to
// show), one of the member's views, or a search.
export type Route =
  | { view: "conversation"; id: number; thread: number | null; message: number | null }
  | { view: "threads" | "mentions" | "saved" | "drafts" | "browse" }
  | { view: "search"; q: string };

// What the server renders a page with.
export type Initial = {
  state: State;
  route: Route;
  conversation: Conversation | null;
  page: Page | null;
  thread: Thread | null;
  missing: boolean;
  // opened at /chest: on a phone, the list of conversations comes first
  home: boolean;
};

// The direct events the tool sends a member's pages (realtime.send).
export type Activity = { c: number; m: number; t: number | null; a: string; mentions: string[]; all: boolean; here: boolean };
export type ReadEvent = { c: number; m: number; t: number | null };
// A reply in a thread the member follows.
export type ThreadEvent = { c: number; t: number; m: number; a: string };

// The sidebar again: after a reconnect, a change of the member's
// conversations, a read on another device.
export type Sidebar = { conversations: Conversation[]; people: Person[]; threadsUnread: number };
