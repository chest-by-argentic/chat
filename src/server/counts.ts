import type { Kind, NotifySetting } from "../shared/types.js";
import { resolvedNotify, unreadCap } from "../shared/rules.js";
import type { Sql } from "./db.js";

// The counts a member is shown: unread messages and mentions per
// conversation, and the badge on the tool's tile.

type Summary = { conversation_id: number; member_id: string; kind: Kind; notify: NotifySetting; unread: number; mentions: number };

// summaries counts, for each member and conversation they are in (not
// archived), the unread top-level messages (up to unreadCap) and the
// unread mentions — top-level, and replies of threads they follow.
export async function summaries(sql: Sql, memberIds: string[], conversation?: number): Promise<Summary[]> {
  // Each count reads only the unread range of its conversation, and only
  // the rows that mention someone (partial indexes); the replies of followed
  // threads are counted once per member, not once per conversation.
  return sql<Summary[]>`
    with mine as (
      select cm.conversation_id, cm.member_id, cm.last_read, cm.notify, c.kind
      from conversation_members cm join conversations c on c.id = cm.conversation_id
      where cm.member_id = any(${memberIds}::text[]) and c.archived_at is null ${conversation === undefined ? sql`` : sql`and cm.conversation_id = ${conversation}`}
    ), threads as (
      select f.member_id, r.conversation_id, count(*)::int as n
      from thread_follows f join messages r on r.thread_id = f.message_id and r.id > f.last_read
      where f.member_id = any(${memberIds}::text[]) and f.following
        and r.thread_id is not null and (r.mention_all or r.mentions <> '{}')
        and (r.mentions @> array[f.member_id] or r.mention_all) and r.author <> f.member_id and r.deleted_at is null
      group by f.member_id, r.conversation_id
    )
    select m.conversation_id, m.member_id, m.kind, m.notify,
      (select count(*) from (select 1 from messages x
         where x.conversation_id = m.conversation_id and x.thread_id is null and x.id > m.last_read
           and x.author <> m.member_id and x.kind = 'message' and x.deleted_at is null
         limit ${unreadCap}) u)::int as unread,
      ((select count(*) from (select 1 from messages x
         where x.conversation_id = m.conversation_id and x.thread_id is null and x.id > m.last_read
           and (x.mention_all or x.mentions <> '{}') and (x.mentions @> array[m.member_id] or x.mention_all)
           and x.author <> m.member_id and x.deleted_at is null
         limit ${unreadCap}) y) + coalesce(t.n, 0))::int as mentions
    from mine m left join threads t on t.member_id = m.member_id and t.conversation_id = m.conversation_id`;
}

// badges are the counts on the tool's tile: unread direct messages and
// unread mentions, nothing from a conversation set to Nothing.
export async function badges(sql: Sql, memberIds: string[]): Promise<Map<string, number>> {
  const counts = new Map(memberIds.map(id => [id, 0]));
  if (!memberIds.length) return counts;
  for (const s of await summaries(sql, memberIds)) {
    if (resolvedNotify(s.kind, s.notify) === "none") continue;
    counts.set(s.member_id, (counts.get(s.member_id) ?? 0) + (s.kind === "direct" ? s.unread : s.mentions));
  }
  return counts;
}


// threadsUnread counts the threads a member follows with replies they have
// not read.
export async function threadsUnread(sql: Sql, memberId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from thread_follows f join messages m on m.id = f.message_id join conversations c on c.id = m.conversation_id
    where f.member_id = ${memberId} and f.following
      and (c.kind = 'public' or exists (select 1 from conversation_members r where r.conversation_id = c.id and r.member_id = ${memberId}))
      and exists (select 1 from messages r where r.thread_id = f.message_id and r.id > f.last_read and r.author <> ${memberId})`;
  return row?.n ?? 0;
}
