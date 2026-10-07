import type { Member } from "@argentic/chest-sdk/member";
import * as notifications from "@argentic/chest-sdk/notifications";
import { en } from "../shared/i18n/en.js";
import { fr } from "../shared/i18n/fr.js";
import { db } from "./db.js";
import type { Access } from "./conversations.js";
import { badges } from "./counts.js";
import { resolvedNotify } from "../shared/rules.js";
import type { MessageRow } from "./messages.js";
import * as live from "./live.js";
import { later } from "./later.js";

// After a message: the members' pages are told (ids only), those who are
// not looking and want to know are notified in the Chest (who and where,
// never the words: a notice is kept and mailed in clear), and the badges
// that changed are set.

const titleCut = 80;
const cut = (s: string) => (s.length > titleCut ? s.slice(0, titleCut - 1) + "…" : s);

export async function afterPost(author: Member, a: Access, m: MessageRow): Promise<void> {
  const sql = db();
  const c = a.conversation;
  const members = await sql<{ member_id: string; notify: "default" | "all" | "mentions" | "none" }[]>`select member_id, notify from conversation_members where conversation_id = ${c.id}`;
  // Followers of the thread among the conversation's members: someone who
  // left it hears nothing more of it.
  const inside = new Set(members.map(r => r.member_id));
  const followers = m.thread_id === null ? new Set<string>() : new Set((await sql<{ member_id: string }[]>`
    select member_id from thread_follows where message_id = ${m.thread_id} and following`).map(r => r.member_id).filter(id => inside.has(id)));
  const mentioned = new Set(m.mentions);
  live.later.activity(members.map(r => r.member_id), { c: c.id, m: m.id, t: m.thread_id, a: author.id, mentions: m.mentions, all: m.mention_all, here: m.mention_here });
  if (m.thread_id !== null) live.later.thread(followers, { c: c.id, t: m.thread_id, m: m.id, a: author.id });

  // Who wants to know: their setting, mentions, the threads they follow.
  const wants = (id: string, notify: (typeof members)[number]["notify"]) => {
    if (id === author.id) return false;
    const level = resolvedNotify(c.kind, notify);
    if (level === "none") return false;
    const named = mentioned.has(id) || m.mention_all;
    if (m.thread_id !== null) return named || followers.has(id);
    return level === "all" || named;
  };
  const candidates = members.filter(r => wants(r.member_id, r.notify)).map(r => r.member_id);
  // A member who is looking at Chat sees it come: no notice.
  const { active } = candidates.length ? await live.active() : { active: new Set<string>() };
  const away = candidates.filter(id => !active.has(id));
  if (away.length) {
    const named = away.filter(id => mentioned.has(id) || m.mention_all);
    const others = away.filter(id => !named.includes(id));
    const where = c.kind === "direct" ? null : c.name!;
    const words = (w: typeof en) => {
      const title = m.thread_id !== null ? w.notifyTitleThread(author.name, where ? `#${where}` : w.directLabel.toLowerCase()) : where ? w.notifyTitleChannel(author.name, where) : w.notifyTitleDirect(author.name);
      return { title: cut(title) };
    };
    const key = m.thread_id !== null ? `t:${m.thread_id}` : `c:${c.id}`;
    const path = m.thread_id !== null ? `/chest/c/${c.id}/t/${m.thread_id}` : `/chest/c/${c.id}?m=${m.id}`;
    const send = (ids: string[], body: (w: typeof en) => string) => ids.length
      ? notifications.notify(ids, { ...words(en), body: body(en), path, key, translations: { fr: { ...words(fr), body: body(fr) } } })
      : Promise.resolve();
    await Promise.all([send(named, w => w.notifyMention), send(others, w => w.notifyNew)]);
  }

  // Badges: unread direct messages and mentions; only theirs moved.
  refreshBadges(members.map(r => r.member_id).filter(id => id !== author.id && (c.kind === "direct" || mentioned.has(id) || m.mention_all)));
}

// afterRead withdraws a notice the member has now read, and sets their badge.
export async function afterRead(memberId: string, key: string | null): Promise<void> {
  if (key) await notifications.withdraw(key, [memberId]);
  refreshBadges([memberId]);
}

// refreshBadges sets these members' badges again, once for what happens
// within half a second: a burst of messages (an @channel in a large
// channel, a lively conversation) costs one count per member.
const badgeDelay = 500;
const waiting = new Set<string>();
let scheduled = false;
export function refreshBadges(ids: Iterable<string>): void {
  for (const id of ids) waiting.add(id);
  if (scheduled || !waiting.size) return;
  scheduled = true;
  later("badges", async () => {
    await new Promise(resolve => setTimeout(resolve, badgeDelay));
    scheduled = false;
    const batch = [...waiting];
    waiting.clear();
    const counts = await badges(db(), batch);
    await notifications.badge.setMany([...counts].map(([memberId, count]) => ({ memberId, count: Math.min(count, 9999) })));
  });
}
