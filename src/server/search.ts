import type { Member } from "@argentic/chest-sdk/member";
import * as members from "@argentic/chest-sdk/members";
import type { SearchResult } from "../shared/types.js";
import { normalize } from "../shared/rules.js";
import { db } from "./db.js";
import { context, open } from "./sealing.js";
import { hydrate, type MessageRow } from "./messages.js";
import { invalid } from "./problem.js";

// Search on sealed messages. Nothing indexes their words: the tool narrows
// in clear (what the member may read, author, dates, files, threads), then
// opens the candidates for the member, newest first, a chunk per call, and
// keeps those that hold every word. It stops at a page of results, or once
// it has looked through enough for one answer, and says how far back it
// looked: the next call goes on from there. Each message looked at is an
// open of the member's, journaled by the Chest: searching is reading.

type Query = {
  words: string[];
  conversation: number | null;
  conversationName: string | null;
  authors: string[];
  authorNames: string[];
  hasFile: boolean;
  inThread: boolean;
  before: string | null;
  after: string | null;
};

// One answer: a page of results, or what a search may look through in one
// go — 5,000 messages, 16 MB of them, 2 seconds — opened 200 at a time.
const results = 20, chunk = 200, budget = { messages: 5000, bytes: 16 << 20, ms: 2000 };
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().startsWith(value);
// A member searches one search at a time: a second waits for the first.
const searching = new Map<string, Promise<unknown>>();

// parse reads what the member typed: words, "phrases", and filters —
// in:#channel, from:@name (from:me), has:file, is:thread,
// before:2026-10-01, after:2026-09-01.
export function parse(q: string): Query {
  const query: Query = { words: [], conversation: null, conversationName: null, authors: [], authorNames: [], hasFile: false, inThread: false, before: null, after: null };
  for (const m of q.matchAll(/"([^"]*)"|(\S+)/gu)) {
    const phrase = m[1], word = m[2] ?? "";
    if (phrase !== undefined) {
      if (phrase.trim()) query.words.push(normalize(phrase.trim()));
      continue;
    }
    const [key, ...rest] = word.split(":");
    const value = rest.join(":");
    if (value && key === "in") query.conversationName = value.replace(/^#/u, "").toLowerCase();
    else if (value && key === "from") query.authorNames.push(value.replace(/^@/u, ""));
    else if (key === "has" && value === "file") query.hasFile = true;
    else if (key === "is" && value === "thread") query.inThread = true;
    else if (key === "before" && isDay(value)) query.before = value;
    else if (key === "after" && isDay(value)) query.after = value;
    else query.words.push(normalize(word));
  }
  return query;
}

// search runs a query for the member, from a cursor (the id it stopped
// at) or the newest message.
export async function search(request: Request, who: Member, q: Query, cursor: number | null): Promise<SearchResult> {
  const before = searching.get(who.id);
  const run = (async () => {
    await before?.catch(() => undefined);
    return scan(request, who, q, cursor);
  })();
  searching.set(who.id, run);
  try {
    return await run;
  } finally {
    if (searching.get(who.id) === run) searching.delete(who.id);
  }
}

async function scan(request: Request, who: Member, q: Query, cursor: number | null): Promise<SearchResult> {
  const sql = db();
  if (q.conversationName !== null) {
    const [c] = await sql<{ id: number }[]>`select id from conversations where name = ${q.conversationName}`;
    if (!c) return { messages: [], cursor: null, through: null, scanned: 0 };
    q.conversation = c.id;
  }
  for (const name of q.authorNames) {
    if (name === "me") q.authors.push(who.id);
    else q.authors.push(...(await members.list({ q: name, limit: 20 })).members.map(m => m.id));
  }
  if (q.authorNames.length && !q.authors.length) return { messages: [], cursor: null, through: null, scanned: 0 };
  if (!q.words.length && q.conversation === null && !q.authors.length && !q.hasFile && !q.inThread && !q.before && !q.after) throw invalid("empty_query");

  const started = Date.now();
  const found: MessageRow[] = [];
  const texts = new Map<number, string>();
  let scanned = 0, bytes = 0, from = cursor, last: MessageRow | undefined, done = false;
  while (found.length < results && scanned < budget.messages && bytes < budget.bytes && Date.now() - started < budget.ms) {
    const rows = await sql<MessageRow[]>`
      select m.* from messages m join conversations c on c.id = m.conversation_id
      where (c.kind = 'public' or exists (select 1 from conversation_members r where r.conversation_id = c.id and r.member_id = ${who.id}))
        and m.kind = 'message' and m.deleted_at is null
        ${from !== null ? sql`and m.id < ${from}` : sql``}
        ${q.conversation !== null ? sql`and m.conversation_id = ${q.conversation}` : sql``}
        ${q.authors.length ? sql`and m.author = any(${q.authors}::text[])` : sql``}
        ${q.hasFile ? sql`and m.has_files` : sql``}
        ${q.inThread ? sql`and (m.thread_id is not null or m.reply_count > 0)` : sql``}
        ${q.before ? sql`and m.created_at < ${q.before}::date` : sql``}
        ${q.after ? sql`and m.created_at >= ${q.after}::date + 1` : sql``}
      order by m.id desc limit ${chunk}`;
    if (!rows.length) { done = true; break; }
    const names = q.words.length ? await sql<{ message_id: number; object: string; name: string }[]>`select message_id, object, name from attachments where message_id = any(${rows.map(r => r.id)}::bigint[])` : [];
    const opened = q.words.length ? await open(request, [...rows.map(r => ({ sealed: r.body, context: context.message(r.id) })), ...names.map(n => ({ sealed: n.name, context: context.file(n.object) }))]) : rows.map(() => "");
    const fileNames = new Map<number, string>();
    names.forEach((n, j) => fileNames.set(n.message_id, `${fileNames.get(n.message_id) ?? ""} ${opened[rows.length + j] ?? ""}`));
    rows.forEach((r, i) => {
      if (found.length >= results) return;
      scanned++;
      bytes += r.body.length;
      last = r;
      const haystack = normalize(`${opened[i] ?? ""} ${fileNames.get(r.id) ?? ""}`);
      if (q.words.every(w => haystack.includes(w))) {
        found.push(r);
        if (opened[i]) texts.set(r.id, opened[i]!);
      }
    });
    from = last?.id ?? from;
    if (rows.length < chunk && found.length < results && last === rows[rows.length - 1]) { done = true; break; }
  }
  return {
    messages: await hydrate(sql, request, who, found, texts),
    cursor: done || !last ? null : String(last.id),
    through: done || !last ? null : last.created_at.toISOString(),
    scanned,
  };
}
