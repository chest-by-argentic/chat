import * as realtime from "@argentic/chest-sdk/realtime";
import type { ReadEvent, ThreadEvent } from "../shared/types.js";
import { later as after } from "./later.js";

// What the tool tells members' pages directly, beside the feeds of their
// conversations (chest.json): what a feed does not say — a reply in a
// thread they follow, a read on another device, their list of
// conversations changed. Ids only, never a member's words; a page that
// missed one asks again when it comes back.

// The direct events, by name.
export const events = { thread: "thread", read: "read", conversations: "conversations" } as const;

const send = (ids: Iterable<string>, event: string, payload: unknown) => {
  const to = [...new Set(ids)];
  if (to.length) after(`live ${event}`, () => realtime.send(to, event, payload));
};

export const later = {
  // thread: a reply in a thread these members follow.
  thread: (ids: Iterable<string>, t: ThreadEvent) => send(ids, events.thread, t),
  // read: the member read up to a message on one of their pages.
  read: (id: string, r: ReadEvent) => send([id], events.read, r),
  // conversations: their list changed (added, removed, renamed, settings).
  conversations: (ids: Iterable<string>) => send(ids, events.conversations, {}),
};

// online says which of these members have Chat open, and which of them
// watch the conversation (a page in front of them, focused on it): those
// see a message come; the others are notified.
export async function online(ids: string[], conversation?: number): Promise<{ online: Set<string>; watching: Set<string> }> {
  if (!ids.length) return { online: new Set(), watching: new Set() };
  const answer = await realtime.online(ids, conversation === undefined ? {} : { channel: `c:${conversation}` });
  return { online: new Set(answer.online), watching: new Set(answer.watching) };
}
