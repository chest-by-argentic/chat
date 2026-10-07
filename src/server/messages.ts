import type { Member } from "@argentic/chest-sdk/member";
import * as files from "@argentic/chest-sdk/files";
import type { Draft, FileInfo, Message, Page, Thread, ThreadSummary } from "../shared/types.js";
import { isEmoji, maxFiles, maxText, pageSize } from "../shared/rules.js";
import { mentions as mentionsOf } from "../shared/markdown.js";
import type postgres from "postgres";
import { db, type Sql } from "./db.js";
import { Problem, forbidden, invalid, notFound } from "./problem.js";
import { context, open, seal } from "./sealing.js";
import { access, membersOf, writable, type Access } from "./conversations.js";
import { afterPost, afterRead, refreshBadges } from "./notify.js";
import { later } from "./later.js";
import * as live from "./live.js";

// Messages, their threads, reactions, files, pins, saved items and drafts.

export type MessageRow = {
  id: number;
  conversation_id: number;
  thread_id: number | null;
  author: string;
  kind: Message["kind"];
  body: string;
  meta: Message["meta"];
  mentions: string[];
  mention_all: boolean;
  mention_here: boolean;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  pinned_at: Date | null;
  reply_count: number;
  last_reply_at: Date | null;
  repliers: string[];
};

type AttachmentRow = { id: number; message_id: number; object: string; name: string; type: string; size: number; width: number | null; height: number | null };

// Where the Chest puts a member's uploads: a folder of their own, the
// object named by the Chest.
export const uploadFolder = (member: string) => `u/${member}/`;

// roomForUpload refuses an upload to a member who already has two
// messages' worth of files waiting to be sent (what a conversation's and a
// thread's composers hold): uploads nobody sends cannot fill the tool's
// space. The nightly tidy removes those older than a day.
export async function roomForUpload(who: Member): Promise<void> {
  const waiting = (await files.list({ prefix: uploadFolder(who.id) })).files.map(f => f.name);
  if (waiting.length < 2 * maxFiles) return;
  const sent = new Set((await db()<{ object: string }[]>`select object from attachments where object = any(${waiting}::text[])`).map(r => r.object));
  if (waiting.filter(o => !sent.has(o)).length >= 2 * maxFiles) throw new Problem(429, "too_many_uploads");
}

// readable is the SQL condition a member may read the conversation c of a
// message: a public channel, or one they are in.
const readable = (sql: Sql, who: string) => sql`(c.kind = 'public' or exists (select 1 from conversation_members r where r.conversation_id = c.id and r.member_id = ${who}))`;

// hydrate turns rows into what a page shows: bodies and file names opened
// for the member (one call; bodies already opened are given), reactions,
// files, their saved marks.
export async function hydrate(sql: Sql, request: Request, who: Member, rows: MessageRow[], known = new Map<number, string>()): Promise<Message[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [reactions, attachments, saved] = await Promise.all([
    sql<{ message_id: number; emoji: string; members: string[] }[]>`
      select message_id, emoji, array_agg(member_id order by created_at, member_id) as members
      from reactions where message_id = any(${ids}::bigint[]) group by message_id, emoji order by min(created_at), emoji`,
    sql<AttachmentRow[]>`select * from attachments where message_id = any(${ids}::bigint[]) order by id`,
    sql<{ message_id: number }[]>`select message_id from saved where member_id = ${who.id} and message_id = any(${ids}::bigint[])`,
  ]);
  const bodies = rows.map(r => (r.kind === "message" && !r.deleted_at && !known.has(r.id) ? { sealed: r.body, context: context.message(r.id) } : { sealed: "", context: "" }));
  const opened = await open(request, [...bodies, ...attachments.map(a => ({ sealed: a.name, context: context.file(a.object) }))]);
  const names = new Map(attachments.map((a, i) => [a.id, opened[rows.length + i] ?? null]));
  const savedIds = new Set(saved.map(s => s.message_id));
  return rows.map((r, i) => ({
    id: r.id, conversation: r.conversation_id, thread: r.thread_id, author: r.author, kind: r.kind,
    text: known.get(r.id) ?? opened[i] ?? null, meta: r.meta, mentions: r.mentions, mentionAll: r.mention_all,
    createdAt: r.created_at.toISOString(), editedAt: r.edited_at?.toISOString() ?? null, deleted: r.deleted_at !== null,
    pinned: r.pinned_at !== null, replyCount: r.reply_count, lastReplyAt: r.last_reply_at?.toISOString() ?? null, repliers: r.repliers,
    reactions: reactions.filter(x => x.message_id === r.id).map(x => ({ emoji: x.emoji, members: x.members })),
    files: attachments.filter(a => a.message_id === r.id).map((a): FileInfo => ({ id: a.id, name: names.get(a.id) ?? null, type: a.type, size: a.size, width: a.width, height: a.height })),
    saved: savedIds.has(r.id),
  }));
}

// page is a page of a conversation's top-level messages, oldest first: the
// latest, those before or after a message, or those around one.
export async function page(request: Request, who: Member, conversation: number, at: { before?: number; after?: number; around?: number } = {}): Promise<Page> {
  const sql = db();
  await access(sql, who, conversation);
  const top = sql`conversation_id = ${conversation} and thread_id is null`;
  let rows: MessageRow[], before = false, after = false;
  if (at.after !== undefined) {
    rows = await sql<MessageRow[]>`select * from messages where ${top} and id > ${at.after} order by id limit ${pageSize + 1}`;
    after = rows.length > pageSize;
    rows = rows.slice(0, pageSize);
    before = true;
  } else if (at.around !== undefined) {
    const half = pageSize / 2;
    const older = await sql<MessageRow[]>`select * from messages where ${top} and id <= ${at.around} order by id desc limit ${half + 1}`;
    const newer = await sql<MessageRow[]>`select * from messages where ${top} and id > ${at.around} order by id limit ${half + 1}`;
    before = older.length > half;
    after = newer.length > half;
    rows = [...older.slice(0, half).reverse(), ...newer.slice(0, half)];
  } else {
    rows = await sql<MessageRow[]>`select * from messages where ${top} ${at.before !== undefined ? sql`and id < ${at.before}` : sql``} order by id desc limit ${pageSize + 1}`;
    before = rows.length > pageSize;
    rows = rows.slice(0, pageSize).reverse();
  }
  return { messages: await hydrate(sql, request, who, rows), before, after };
}

// byIds are the messages a page was told of live, those the member may read.
export async function byIds(request: Request, who: Member, ids: number[]): Promise<Message[]> {
  const sql = db();
  const rows = await sql<MessageRow[]>`
    select m.* from messages m join conversations c on c.id = m.conversation_id
    where m.id = any(${ids}::bigint[]) and ${readable(sql, who.id)} order by m.id`;
  return hydrate(sql, request, who, rows);
}

async function rowOf(sql: Sql, id: number): Promise<MessageRow> {
  const [row] = await sql<MessageRow[]>`select * from messages where id = ${id}`;
  if (!row) throw notFound();
  return row;
}

// thread is a root and its latest replies (a page's worth; those before a
// reply on asking), oldest first.
export async function thread(request: Request, who: Member, root: number, before?: number): Promise<Thread> {
  const sql = db();
  const r = await rowOf(sql, root);
  if (r.thread_id !== null) throw notFound();
  await access(sql, who, r.conversation_id);
  const replies = await sql<MessageRow[]>`select * from messages where thread_id = ${root} ${before ? sql`and id < ${before}` : sql``} order by id desc limit ${pageSize + 1}`;
  const more = replies.length > pageSize;
  const [follow] = await sql<{ following: boolean; last_read: number }[]>`select following, last_read from thread_follows where message_id = ${root} and member_id = ${who.id}`;
  const [first, ...rest] = await hydrate(sql, request, who, [r, ...replies.slice(0, pageSize).reverse()]);
  return { root: first!, replies: rest, more, following: follow?.following ?? false, lastRead: follow?.last_read ?? 0 };
}

type Outgoing = { text: string; thread: number | null; files: { object: string; name: string }[] };

// post writes a member's message, sealed, and tells the others.
export async function post(request: Request, who: Member, conversation: number, input: Outgoing): Promise<Message> {
  const text = input.text.trim();
  if (text.length > maxText) throw new Problem(413, "too_long");
  if (!text && !input.files.length) throw invalid("empty");
  if (input.files.length > maxFiles) throw invalid("too_many_files");
  const sql = db();
  const a = await writable(sql, who, conversation);
  // Files: the member's own uploads, as the Chest kept them.
  const folder = uploadFolder(who.id);
  const kept = await Promise.all(input.files.map(async f => {
    if (!f.object.startsWith(folder) || f.object.length > 200 || f.name.length > 255 || !f.name.trim()) throw invalid("invalid_file");
    const info = await files.stat(f.object);
    if (!info) throw invalid("invalid_file");
    return { ...f, info };
  }));
  const found = mentionsOf(text);
  const direct = a.conversation.kind === "direct";
  const everyone = !direct && found.channel;
  const here = !direct && found.here && !everyone;
  // Only the conversation's members are mentioned: a name outside it
  // reaches nobody (and @here, those of them with Chat open now).
  const members = new Set((await membersOf(sql, conversation)).map(m => m.member_id));
  const people = new Set(found.members.filter(id => members.has(id)));
  if (here) for (const id of (await live.online([...members])).online) people.add(id);
  people.delete(who.id);
  const mentioned = [...people];
  const names = kept.length ? await seal(kept.map(f => ({ value: f.name.trim(), context: context.file(f.object) }))) : [];
  // Ids follow commit order in a conversation (reading, catching up and
  // unread counts rely on it): the body is sealed with its id before the
  // transaction, which then only checks, under the conversation's lock
  // held a few milliseconds, that no later id was written meanwhile — else
  // it takes a new id.
  let row: MessageRow | null = null;
  for (let attempt = 0; !row; attempt++) {
    const [{ id }] = await sql<{ id: number }[]>`select nextval(pg_get_serial_sequence('messages', 'id'))::bigint as id` as unknown as [{ id: number }];
    const [body] = await seal([{ value: text, context: context.message(id) }]);
    row = await sql.begin(async tx => {
      await tx`set local lock_timeout = '5s'`;
      const [c] = await tx<{ last_posted_id: number; archived_at: Date | null }[]>`select last_posted_id, archived_at from conversations where id = ${conversation} for update`;
      if (!c) throw notFound();
      if (c.archived_at) throw new Problem(409, "archived");
      if (c.last_posted_id > id) {
        if (attempt >= 3) throw new Problem(503, "busy");
        return null;
      }
      if (input.thread !== null) {
        const [root] = await tx<{ thread_id: number | null; kind: string; conversation_id: number }[]>`select thread_id, kind, conversation_id from messages where id = ${input.thread} for share`;
        if (!root || root.conversation_id !== conversation || root.thread_id !== null || root.kind !== "message") throw invalid("invalid_thread");
      }
      await tx`update conversations set last_posted_id = ${id} where id = ${conversation}`;
      return write(tx, id, body!);
    });
  }
  const done = row;
  const [shown] = await hydrate(sql, request, who, [done]);
  later("after a post", () => afterPost(who, a, done, text));
  return shown!;

  async function write(tx: postgres.TransactionSql, id: number, body: string): Promise<MessageRow> {
    const sealed = [body, ...names];
    const [m] = await tx<MessageRow[]>`
      insert into messages (id, conversation_id, thread_id, author, body, mentions, mention_all, mention_here, has_files)
      values (${id}, ${conversation}, ${input.thread}, ${who.id}, ${sealed[0]!}, ${mentioned}::text[], ${everyone}, ${here}, ${kept.length > 0})
      returning *`;
    if (kept.length) {
      try {
        await tx`insert into attachments ${tx(kept.map((f, i) => ({ message_id: id, object: f.object, name: sealed[i + 1]!, type: f.info.type, size: f.info.size, width: f.info.width ?? null, height: f.info.height ?? null, uploader: who.id })))}`;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw invalid("invalid_file");
        throw error;
      }
    }
    if (input.thread !== null) {
      await tx`update messages set reply_count = reply_count + 1, last_reply_at = ${m!.created_at},
        repliers = (array[${who.id}::text] || array_remove(repliers, ${who.id}::text))[1:3] where id = ${input.thread}`;
      await tx`insert into thread_follows (message_id, member_id, last_read) values (${input.thread}, ${who.id}, ${id})
        on conflict (message_id, member_id) do update set following = true, last_read = greatest(thread_follows.last_read, excluded.last_read)`;
      await tx`insert into thread_follows (message_id, member_id) select id, author from messages where id = ${input.thread} on conflict do nothing`;
    } else {
      await tx`update conversations set last_message_id = greatest(last_message_id, ${id}), last_message_at = greatest(last_message_at, ${m!.created_at}) where id = ${conversation}`;
      await tx`update conversation_members set last_read = greatest(last_read, ${id}) where conversation_id = ${conversation} and member_id = ${who.id}`;
    }
    if (mentioned.length) {
      await tx`insert into thread_follows (message_id, member_id) select ${input.thread ?? id}, p from unnest(${mentioned}::text[]) p
        on conflict (message_id, member_id) do update set following = true`;
    }
    await tx`delete from drafts where member_id = ${who.id} and conversation_id = ${conversation} and thread_id = ${input.thread ?? 0}`;
    return m!;
  }
}

// edit changes the text of a member's own message. Its mentions follow the
// new text, among the conversation's members; @channel and @here may be
// taken out, never added: an edit notifies nobody.
export async function edit(request: Request, who: Member, id: number, raw: string): Promise<Message> {
  const text = raw.trim();
  if (text.length > maxText) throw new Problem(413, "too_long");
  const sql = db();
  const row = await rowOf(sql, id);
  if (row.author !== who.id || row.kind !== "message" || row.deleted_at) throw forbidden();
  await writable(sql, who, row.conversation_id);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from attachments where message_id = ${id}` as unknown as [{ n: number }];
  if (!text && !n) throw invalid("empty");
  const found = mentionsOf(text);
  const members = new Set((await membersOf(sql, row.conversation_id)).map(m => m.member_id));
  // Those @here reached when it was sent stay mentioned while @here stays.
  const [before] = row.mention_here ? await open(request, [{ sealed: row.body, context: context.message(id) }]) : [null];
  const explicitBefore = new Set(before ? mentionsOf(before).members : []);
  const here = row.mention_here && found.here;
  const people = new Set([...found.members.filter(m => members.has(m)), ...(here ? row.mentions.filter(m => !explicitBefore.has(m)) : [])]);
  people.delete(who.id);
  const [sealed] = await seal([{ value: text, context: context.message(id) }]);
  const updated = await sql.begin(async tx => {
    const [u] = await tx<MessageRow[]>`
      update messages set body = ${sealed!}, edited_at = now(), mentions = ${[...people]}::text[],
        mention_all = ${row.mention_all && found.channel}, mention_here = ${here}
      where id = ${id} and deleted_at is null returning *`;
    if (!u) throw notFound();
    const added = [...people].filter(p => !row.mentions.includes(p));
    if (added.length) await tx`insert into thread_follows (message_id, member_id) select ${row.thread_id ?? id}, p from unnest(${added}::text[]) p
      on conflict (message_id, member_id) do update set following = true`;
    return u!;
  });
  const moved = [...new Set([...people, ...row.mentions])].filter(p => people.has(p) !== row.mentions.includes(p) || (row.mention_all && !updated.mention_all));
  if (moved.length || (row.mention_all && !updated.mention_all)) refreshBadges(row.mention_all && !updated.mention_all ? [...members] : moved);
  return (await hydrate(sql, request, who, [updated]))[0]!;
}

// remove deletes a message: its author or an admin. A root with replies
// stays as “deleted”, its words and files gone; anything else goes.
export async function remove(who: Member, id: number): Promise<void> {
  const sql = db();
  const row = await rowOf(sql, id);
  if (row.kind !== "message" || (row.author !== who.id && !who.isAdmin)) throw forbidden();
  const a = await access(sql, who, row.conversation_id);
  const objects = await sql.begin(async tx => {
    // Taken with the conversation, as posts are: no reply lands on a root
    // being deleted.
    await tx`select 1 from conversations where id = ${row.conversation_id} for update`;
    const [now] = await tx<{ reply_count: number }[]>`select reply_count from messages where id = ${id}`;
    if (!now) return [];
    const gone = (await tx<{ object: string }[]>`delete from attachments where message_id = ${id} returning object`).map(r => r.object);
    if (row.thread_id === null && now.reply_count > 0) {
      await tx`delete from reactions where message_id = ${id}`;
      await tx`update messages set body = '', deleted_at = now(), mentions = '{}', mention_all = false, mention_here = false,
        has_files = false, pinned_at = null, pinned_by = null where id = ${id}`;
      return gone;
    }
    gone.push(...(await tx<{ object: string }[]>`select a.object from attachments a join messages m on m.id = a.message_id where m.thread_id = ${id}`).map(r => r.object));
    await tx`delete from messages where id = ${id}`;
    if (row.thread_id !== null) {
      const [root] = await tx<{ reply_count: number; deleted_at: Date | null }[]>`
        update messages r set reply_count = s.n, last_reply_at = s.last,
          repliers = coalesce((select array_agg(x.author order by x.at desc) from (select author, max(id) as at from messages where thread_id = r.id group by author order by at desc limit 3) x), '{}')
        from (select count(*)::int as n, max(created_at) as last from messages where thread_id = ${row.thread_id}) s
        where r.id = ${row.thread_id} returning r.reply_count, r.deleted_at`;
      if (root && root.reply_count === 0 && root.deleted_at) await tx`delete from messages where id = ${row.thread_id}`;
    } else {
      await tx`update conversations c set last_message_id = coalesce(m.id, 0), last_message_at = m.created_at
        from (select max(id) as id, max(created_at) as created_at from messages where conversation_id = ${row.conversation_id} and thread_id is null and kind = 'message') m
        where c.id = ${row.conversation_id} and c.last_message_id = ${id}`;
    }
    return gone;
  });
  if (objects.length) later("deleting files", () => Promise.all(objects.map(o => files.delete(o))));
  // Unread mentions and direct messages it held no longer count.
  refreshBadges(a.conversation.kind === "direct" ? (await membersOf(sql, row.conversation_id)).map(m => m.member_id) : row.mention_all ? (await membersOf(sql, row.conversation_id)).map(m => m.member_id) : row.mentions);
}

// react adds or takes back a member's emoji on a message.
export async function react(who: Member, id: number, emoji: string, on: boolean): Promise<void> {
  if (!isEmoji(emoji)) throw invalid("invalid_emoji");
  const sql = db();
  const row = await rowOf(sql, id);
  if (row.kind !== "message" || row.deleted_at) throw forbidden();
  await writable(sql, who, row.conversation_id);
  if (on) await sql`insert into reactions (message_id, emoji, member_id, conversation_id) values (${id}, ${emoji}, ${who.id}, ${row.conversation_id}) on conflict do nothing`;
  else await sql`delete from reactions where message_id = ${id} and emoji = ${emoji} and member_id = ${who.id}`;
}

// pin pins or unpins a message: any member of its conversation.
export async function pin(who: Member, id: number, on: boolean): Promise<void> {
  const sql = db();
  const row = await rowOf(sql, id);
  if (row.kind !== "message" || row.deleted_at || row.thread_id !== null) throw forbidden();
  await writable(sql, who, row.conversation_id);
  await sql`update messages set pinned_at = ${on ? sql`now()` : null}, pinned_by = ${on ? who.id : null} where id = ${id}`;
}

// save keeps or forgets a message for the member.
export async function save(who: Member, id: number, on: boolean): Promise<void> {
  const sql = db();
  const row = await rowOf(sql, id);
  await access(sql, who, row.conversation_id);
  if (on) await sql`insert into saved (member_id, message_id) values (${who.id}, ${id}) on conflict do nothing`;
  else await sql`delete from saved where member_id = ${who.id} and message_id = ${id}`;
}

// markUnread moves the member's reading back to just before a message.
export async function markUnread(who: Member, id: number): Promise<{ conversation: number; thread: number | null; lastRead: number }> {
  const sql = db();
  const row = await rowOf(sql, id);
  const a = await access(sql, who, row.conversation_id);
  if (!a.membership) throw forbidden();
  if (row.thread_id === null) {
    const [{ prev }] = await sql<{ prev: number }[]>`select coalesce(max(id), 0)::bigint as prev from messages where conversation_id = ${row.conversation_id} and thread_id is null and id < ${id}` as unknown as [{ prev: number }];
    await sql`update conversation_members set last_read = ${prev} where conversation_id = ${row.conversation_id} and member_id = ${who.id}`;
    live.later.read(who.id, { c: row.conversation_id, m: prev, t: null });
    later("badge", () => afterRead(who.id, null));
    return { conversation: row.conversation_id, thread: null, lastRead: prev };
  }
  const [{ prev }] = await sql<{ prev: number }[]>`select coalesce(max(id), ${row.thread_id})::bigint as prev from messages where thread_id = ${row.thread_id} and id < ${id}` as unknown as [{ prev: number }];
  await sql`insert into thread_follows (message_id, member_id, last_read) values (${row.thread_id}, ${who.id}, ${prev})
    on conflict (message_id, member_id) do update set last_read = excluded.last_read, following = true`;
  live.later.read(who.id, { c: row.conversation_id, m: prev, t: row.thread_id });
  later("badge", () => afterRead(who.id, null));
  return { conversation: row.conversation_id, thread: row.thread_id, lastRead: prev };
}

// readThread moves the member's reading of a thread they follow.
export async function readThread(who: Member, root: number, upTo: number): Promise<void> {
  const sql = db();
  const row = await rowOf(sql, root);
  await access(sql, who, row.conversation_id);
  const done = await sql`update thread_follows set last_read = greatest(last_read, ${upTo}) where message_id = ${root} and member_id = ${who.id} returning 1`;
  if (!done.length) return;
  live.later.read(who.id, { c: row.conversation_id, m: upTo, t: root });
  later("after a read", () => afterRead(who.id, `t:${root}`));
}

// follow follows or unfollows a thread.
export async function follow(who: Member, root: number, on: boolean): Promise<void> {
  const sql = db();
  const row = await rowOf(sql, root);
  if (row.thread_id !== null) throw invalid("invalid_thread");
  await access(sql, who, row.conversation_id);
  // Following from now: the replies so far count as read.
  await sql`insert into thread_follows (message_id, member_id, following, last_read)
    values (${root}, ${who.id}, ${on}, coalesce((select max(id) from messages where thread_id = ${root}), ${root}))
    on conflict (message_id, member_id) do update set following = excluded.following`;
}

// mentions are the messages that mention the member, newest first.
export async function mentioning(request: Request, who: Member, before?: number): Promise<Message[]> {
  const sql = db();
  const rows = await sql<MessageRow[]>`
    select m.* from messages m join conversation_members cm on cm.conversation_id = m.conversation_id and cm.member_id = ${who.id}
    where (m.mention_all or m.mentions <> '{}') and (m.mentions @> array[${who.id}::text] or m.mention_all)
      and m.author <> ${who.id} and m.deleted_at is null
      ${before ? sql`and m.id < ${before}` : sql``}
    order by m.id desc limit 30`;
  return hydrate(sql, request, who, rows);
}

// saved are the member's saved messages, last saved first; before is the
// last message of the page before.
export async function savedBy(request: Request, who: Member, before?: number): Promise<Message[]> {
  const sql = db();
  const rows = await sql<MessageRow[]>`
    select m.* from saved s join messages m on m.id = s.message_id join conversations c on c.id = m.conversation_id
    where s.member_id = ${who.id} and ${readable(sql, who.id)}
      ${before ? sql`and (s.created_at, s.message_id) < (select created_at, message_id from saved where member_id = ${who.id} and message_id = ${before})` : sql``}
    order by s.created_at desc, s.message_id desc limit 30`;
  return hydrate(sql, request, who, rows);
}

// threads are those the member follows, latest reply first, with what is
// unread in each and the last replies; before is the last root of the page
// before.
export async function followed(request: Request, who: Member, before?: number): Promise<ThreadSummary[]> {
  const sql = db();
  const roots = await sql<(MessageRow & { f_last_read: number; unread: number })[]>`
    select m.*, f.last_read as f_last_read,
      (select count(*) from messages r where r.thread_id = m.id and r.id > f.last_read and r.author <> ${who.id})::int as unread
    from thread_follows f join messages m on m.id = f.message_id join conversations c on c.id = m.conversation_id
    where f.member_id = ${who.id} and f.following and m.reply_count > 0 and ${readable(sql, who.id)}
      ${before ? sql`and (m.last_reply_at, m.id) < (select last_reply_at, id from messages where id = ${before})` : sql``}
    order by m.last_reply_at desc, m.id desc limit 20`;
  if (!roots.length) return [];
  const latest = await sql<MessageRow[]>`
    select * from (select r.*, row_number() over (partition by r.thread_id order by r.id desc) as n from messages r
      where r.thread_id = any(${roots.map(r => r.id)}::bigint[])) x where n <= 2 order by id`;
  const shown = await hydrate(sql, request, who, [...roots, ...latest]);
  return roots.map((r, i) => ({ root: shown[i]!, unread: r.unread, latest: shown.slice(roots.length).filter(m => m.thread === r.id) }));
}

// pinned are a conversation's pinned messages, the last 100 pinned (as
// Slack, a board of what matters, not an archive), last first.
export async function pinned(request: Request, who: Member, conversation: number): Promise<Message[]> {
  const sql = db();
  await access(sql, who, conversation);
  const rows = await sql<MessageRow[]>`select * from messages where conversation_id = ${conversation} and pinned_at is not null order by pinned_at desc limit 100`;
  return hydrate(sql, request, who, rows);
}

// drafts are what the member wrote and did not send, opened.
export async function drafts(request: Request, who: Member): Promise<Draft[]> {
  const rows = await db()<{ conversation_id: number; thread_id: number; body: string; updated_at: Date }[]>`
    select d.* from drafts d join conversations c on c.id = d.conversation_id where d.member_id = ${who.id} and ${readable(db(), who.id)}
    order by d.updated_at desc`;
  const texts = await open(request, rows.map(r => ({ sealed: r.body, context: context.draft(who.id, r.conversation_id, r.thread_id) })));
  return rows.flatMap((r, i) => (texts[i] ? [{ conversation: r.conversation_id, thread: r.thread_id || null, text: texts[i]!, updatedAt: r.updated_at.toISOString() }] : []));
}

// keepDraft seals and keeps what the member is writing; empty, it goes.
export async function keepDraft(who: Member, conversation: number, threadId: number | null, raw: string): Promise<void> {
  if (raw.length > maxText) throw new Problem(413, "too_long");
  const sql = db();
  await writable(sql, who, conversation);
  if (threadId !== null) {
    const root = await rowOf(sql, threadId);
    if (root.conversation_id !== conversation || root.thread_id !== null || root.kind !== "message") throw invalid("invalid_thread");
  }
  const t = threadId ?? 0;
  if (!raw.trim()) {
    await sql`delete from drafts where member_id = ${who.id} and conversation_id = ${conversation} and thread_id = ${t}`;
    return;
  }
  const [sealed] = await seal([{ value: raw, context: context.draft(who.id, conversation, t) }]);
  await sql`insert into drafts (member_id, conversation_id, thread_id, body) values (${who.id}, ${conversation}, ${t}, ${sealed!})
    on conflict (member_id, conversation_id, thread_id) do update set body = excluded.body, updated_at = now()`;
}

// fileLink is a signed link to a message's file, for a member who may read
// it: the image's thumbnail, or the file to show or download.
export async function fileLink(who: Member, attachment: number, as: { thumbnail?: 256 | 1024; download?: boolean }): Promise<string> {
  const sql = db();
  const [row] = await sql<{ object: string; conversation_id: number; type: string }[]>`
    select a.object, m.conversation_id, a.type from attachments a join messages m on m.id = a.message_id where a.id = ${attachment}`;
  if (!row) throw notFound();
  await access(sql, who, row.conversation_id);
  const thumbnail = as.thumbnail && /^image\/(jpeg|png|gif|webp)$/u.test(row.type) ? as.thumbnail : undefined;
  return (await files.url(row.object, { ...(thumbnail ? { thumbnail } : {}), ...(as.download ? { download: true } : {}) })).url;
}

export type { Access };
