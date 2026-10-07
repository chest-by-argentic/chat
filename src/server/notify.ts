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
import { preview } from "./preview.js";
import { later } from "./later.js";

// After a message: the members' pages are told (ids only), those who are
// not looking and want to know are notified in the Chest (who and where,
// never the words: a notice is kept and mailed in clear), and the badges
// that changed are set.

const titleCut = 80;
const cut = (s: string) => (s.length > titleCut ? s.slice(0, titleCut - 1) + "…" : s);

export async function afterPost(author: Member, a: Access, m: MessageRow, text: string): Promise<void> {
  const sql = db();
  const c = a.conversation;
  const members = await sql<{ member_id: string; notify: "default" | "all" | "mentions" | "none" }[]>`select member_id, notify from conversation_members where conversation_id = ${c.id}`;
  // Followers of the thread among the conversation's members: someone who
  // left it hears nothing more of it.
  const inside = new Set(members.map(r => r.member_id));
  const followers = m.thread_id === null ? new Set<string>() : new Set((await sql<{ member_id: string }[]>`
    select member_id from thread_follows where message_id = ${m.thread_id} and following`).map(r => r.member_id).filter(id => inside.has(id)));
  const mentioned = new Set(m.mentions);
  const mention = (id: string) => mentioned.has(id) || m.mention_all;
  if (m.thread_id !== null) live.later.thread(followers, { c: c.id, t: m.thread_id, m: m.id, a: author.id });

  // Who wants to know: their setting, mentions, the threads they follow.
  const wants = (id: string, notify: (typeof members)[number]["notify"]) => {
    if (id === author.id) return false;
    const level = resolvedNotify(c.kind, notify);
    if (level === "none") return false;
    if (m.thread_id !== null) return mention(id) || followers.has(id);
    return level === "all" || mention(id);
  };
  const candidates = members.filter(r => wants(r.member_id, r.notify)).map(r => r.member_id);
  // A member watching this conversation sees it come: no notice. Anyone
  // else — Chat closed, hidden, or on another conversation — is notified.
  const { watching } = await live.online(candidates, c.id);
  const away = candidates.filter(id => !watching.has(id));
  if (away.length) {
    const named = away.filter(mention);
    const others = away.filter(id => !mention(id));
    const where = c.kind === "direct" ? null : c.name!;
    // The title says who and where (and, with a preview below it, that it
    // mentions them); the body what the message says, or what happened.
    const words = (w: typeof en, toNamed: boolean) => {
      const place = where ? `#${where}` : w.directLabel.toLowerCase();
      const title = toNamed && shown ? w.notifyTitleMention(author.name, place)
        : m.thread_id !== null ? w.notifyTitleThread(author.name, place)
        : where ? w.notifyTitleChannel(author.name, where) : w.notifyTitleDirect(author.name);
      return { title: cut(title) };
    };
    const key = m.thread_id !== null ? `t:${m.thread_id}` : `c:${c.id}`;
    const path = m.thread_id !== null ? `/chest/c/${c.id}/t/${m.thread_id}` : `/chest/c/${c.id}?m=${m.id}`;
    // What the message says, as a preview — unless the channel is
    // confidential. The words leave the seal here: the Chest keeps the
    // notice in clear in its bell and mails it (push is encrypted end to
    // end).
    const shown = c.confidential ? "" : await preview(text);
    const send = (ids: string[], toNamed: boolean) => ids.length
      ? notifications.notify(ids, { ...words(en, toNamed), body: shown || (toNamed ? en.notifyMention : en.notifyNew), path, key,
        translations: { fr: { ...words(fr, toNamed), body: shown || (toNamed ? fr.notifyMention : fr.notifyNew) } } })
      : Promise.resolve();
    await Promise.all([send(named, true), send(others, false)]);
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
