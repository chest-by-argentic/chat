import * as realtime from "@argentic/chest-sdk/realtime";
import type { Activity, ReadEvent, ThreadEvent } from "../shared/types.js";
import { later as after } from "./later.js";

// What the tool tells members' pages directly, beside the feeds of the
// conversation they show (chest.json): ids and counts, never a member's
// words. A page that missed one refetches when it comes back.

// The direct events, by name.
export const events = { activity: "activity", thread: "thread", read: "read", conversations: "conversations" } as const;

const send = (ids: Iterable<string>, event: string, payload: unknown) => {
  const to = [...new Set(ids)];
  if (to.length) after(`live ${event}`, () => realtime.send(to, event, payload));
};

export const later = {
  // activity: a message was posted where these members are.
  activity: (ids: Iterable<string>, a: Activity) => send(ids, events.activity, a),
  // thread: a reply in a thread these members follow.
  thread: (ids: Iterable<string>, t: ThreadEvent) => send(ids, events.thread, t),
  // read: the member read up to a message on one of their pages.
  read: (id: string, r: ReadEvent) => send([id], events.read, r),
  // conversations: their list changed (added, removed, renamed, settings).
  conversations: (ids: Iterable<string>) => send(ids, events.conversations, {}),
};

// active lists the members whose page is in front of them now: they see
// what comes, nobody notifies them.
export async function active(): Promise<{ active: Set<string>; online: Set<string> }> {
  const { members } = await realtime.presence("everyone");
  return {
    online: new Set(members.map(m => m.id)),
    active: new Set(members.filter(m => m.state["away"] !== true).map(m => m.id)),
  };
}
