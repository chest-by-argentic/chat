import * as events from "@argentic/chest-sdk/events";
import * as schedules from "@argentic/chest-sdk/schedules";
import * as files from "@argentic/chest-sdk/files";
import * as members from "@argentic/chest-sdk/members";
import { db } from "./db.js";
import { reconcile } from "./conversations.js";
import { uploadFolder } from "./messages.js";
import { refreshBadges } from "./notify.js";

// What the Chest calls the tool for by itself, signed: the members'
// lifecycle (POST /chest-events) and the nightly tidy (POST
// /chest-schedules). Each delivery comes at least once: its id is kept.

const seen: events.Seen = {
  has: async id => (await db()`select 1 from handled where id = ${id}`).length > 0,
  add: async id => { await db()`insert into handled (id) values (${id}) on conflict do nothing`; },
};

export function memberEvent(request: Request): Promise<number> {
  return events.handle(request, {
    // Their groups changed: the channels groups give them follow at once.
    "member.updated": async e => {
      if (!e.data.changed.includes("groups")) return;
      const m = await members.get(e.data.id);
      await reconcile(e.data.id, m?.groups ?? []);
    },
    // Their data is to be erased: their words, files, reactions, drafts,
    // saved items and places go; others' messages keep only their id.
    "member.erased": async e => {
      const id = e.data.id;
      const touched = await db().begin(async sql => {
        // The conversations it touches, locked first and in order, as posts
        // lock them: no deadlock with a member writing there.
        const conversations = (await sql<{ id: number }[]>`
          select id from conversations where id in (select conversation_id from messages where author = ${id}) or created_by = ${id}
          order by id for update`).map(r => r.id);
        // Their messages others replied to stay as "deleted"; the rest go.
        await sql`update messages set body = '', deleted_at = now(), mentions = '{}', mention_all = false, mention_here = false,
          has_files = false, pinned_at = null, pinned_by = null where author = ${id} and kind = 'message' and thread_id is null and reply_count > 0`;
        await sql`delete from reactions r using messages m where r.message_id = m.id and m.author = ${id} and m.deleted_at is not null`;
        const roots = (await sql<{ thread_id: number }[]>`
          with gone as (delete from messages where author = ${id} and (kind <> 'message' or thread_id is not null or reply_count = 0) returning thread_id)
          select distinct thread_id from gone where thread_id is not null`).map(r => r.thread_id);
        if (roots.length) {
          await sql`update messages r set reply_count = (select count(*) from messages x where x.thread_id = r.id),
            last_reply_at = (select max(created_at) from messages x where x.thread_id = r.id),
            repliers = array_remove(r.repliers, ${id}::text) where r.id = any(${roots}::bigint[])`;
          await sql`delete from messages where id = any(${roots}::bigint[]) and reply_count = 0 and deleted_at is not null`;
        }
        await sql`update messages set mentions = array_remove(mentions, ${id}::text), repliers = array_remove(repliers, ${id}::text) where mentions @> array[${id}::text] or repliers @> array[${id}::text]`;
        await sql`update messages set pinned_by = null where pinned_by = ${id}`;
        await sql`delete from attachments where uploader = ${id}`;
        for (const table of ["reactions", "saved", "drafts", "thread_follows", "conversation_members", "conversation_leaves", "people"]) {
          await sql`delete from ${sql(table)} where member_id = ${id}`;
        }
        await sql`update conversations set created_by = null where created_by = ${id}`;
        if (conversations.length) await sql`update conversations c set last_message_id = coalesce(m.id, 0), last_message_at = m.at
          from (select x.id as conversation, max(m.id) as id, max(m.created_at) as at from unnest(${conversations}::bigint[]) x(id)
            left join messages m on m.conversation_id = x.id and m.thread_id is null and m.kind = 'message' group by x.id) m
          where c.id = m.conversation`;
        return conversations.length ? (await sql<{ member_id: string }[]>`select distinct member_id from conversation_members where conversation_id = any(${conversations}::bigint[])`).map(r => r.member_id) : [];
      });
      refreshBadges(touched);
      // Their files, sent or not, are all in their own folder: the
      // erasure is acknowledged once it is empty (a failure leaves the
      // event to be delivered again).
      let left: string[];
      do {
        left = (await files.list({ prefix: uploadFolder(id) })).files.map(f => f.name);
        await Promise.all(left.map(name => files.delete(name)));
      } while (left.length);
      await events.acknowledgeErasure(e.data.erasure);
    },
  }, { seen });
}

// A day: what an upload not sent with any message is given before it goes.
const day = 24 * 3600 * 1000;

export function scheduleRun(request: Request): Promise<number> {
  return schedules.handle(request, {
    // The night's tidy: files uploaded and never sent, deliveries remembered
    // long enough.
    tidy: async () => {
      const sql = db();
      let after: string | undefined;
      do {
        const page = await files.list({ prefix: "u/", ...(after ? { after } : {}) });
        const old = page.files.filter(f => Date.now() - Date.parse(f.updated) > day).map(f => f.name);
        if (old.length) {
          const used = new Set((await sql<{ object: string }[]>`select object from attachments where object = any(${old}::text[])`).map(r => r.object));
          await Promise.all(old.filter(o => !used.has(o)).map(o => files.delete(o)));
        }
        after = page.next ?? undefined;
      } while (after);
      await sql`delete from handled where at < now() - interval '30 days'`;
    },
  }, { seen });
}
