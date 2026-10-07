import type { Member } from "@argentic/chest-sdk/member";
import type { Conversation, Details, Kind, NotifySetting } from "../shared/types.js";
import { maxAbout, maxDirect, channelName } from "../shared/rules.js";
import { db, type Sql } from "./db.js";
import { Problem, forbidden, invalid, notFound } from "./problem.js";
import { context, open, seal } from "./sealing.js";
import { current, groupMembers, groups as allGroups } from "./people.js";
import { addLine } from "./lines.js";
import * as live from "./live.js";
import { summaries } from "./counts.js";
import { afterRead } from "./notify.js";
import { later } from "./later.js";

// Conversations — channels, public or private, and direct conversations —,
// who is in them, and what each member may do there.

type ConversationRow = {
  id: number;
  kind: Kind;
  name: string | null;
  about: string | null;
  direct_key: string | null;
  created_by: string | null;
  created_at: Date;
  archived_at: Date | null;
  is_default: boolean;
  last_message_id: number;
  last_message_at: Date | null;
};

type MembershipRow = { added: boolean; last_read: number; notify: NotifySetting; starred: boolean };

// What a member may do in a conversation.
export type Access = {
  conversation: ConversationRow;
  membership: MembershipRow | null;
  // read its messages: a public channel, or one they are in
  read: boolean;
  // write, react, pin, add people: they are in it and it is not archived
  write: boolean;
  // rename, archive, remove others: a channel they created, or an admin
  manage: boolean;
};

export async function access(sql: Sql, who: Member, id: number): Promise<Access> {
  const [row] = await sql<(ConversationRow & { m_added: boolean | null; m_last_read: number | null; m_notify: NotifySetting | null; m_starred: boolean | null })[]>`
    select c.*, m.added as m_added, m.last_read as m_last_read, m.notify as m_notify, m.starred as m_starred
    from conversations c left join conversation_members m on m.conversation_id = c.id and m.member_id = ${who.id}
    where c.id = ${id}`;
  if (!row) throw notFound();
  const { m_added, m_last_read, m_notify, m_starred, ...conversation } = row;
  const membership = m_added === null ? null : { added: m_added, last_read: m_last_read!, notify: m_notify!, starred: m_starred! };
  const read = conversation.kind === "public" || membership !== null;
  if (!read) throw notFound();
  return {
    conversation,
    membership,
    read,
    write: membership !== null && conversation.archived_at === null,
    manage: conversation.kind !== "direct" && (conversation.created_by === who.id || who.isAdmin),
  };
}

// writable is access that must allow writing.
export async function writable(sql: Sql, who: Member, id: number): Promise<Access> {
  const a = await access(sql, who, id);
  if (!a.write) throw a.conversation.archived_at ? new Problem(409, "archived") : forbidden();
  return a;
}

// list is the member's sidebar: the conversations they are in, not
// archived, with their counts.
export async function list(sql: Sql, who: Member): Promise<Conversation[]> {
  const rows = await sql<(ConversationRow & MembershipRow & { people: string[] | null })[]>`
    select c.*, cm.added, cm.last_read, cm.notify, cm.starred,
      case when c.kind = 'direct' then (select array_agg(p.member_id order by p.member_id) from conversation_members p where p.conversation_id = c.id) end as people
    from conversation_members cm join conversations c on c.id = cm.conversation_id
    where cm.member_id = ${who.id} and c.archived_at is null`;
  const counts = new Map((await summaries(sql, [who.id])).map(s => [s.conversation_id, s]));
  return rows.map(r => conversation(r, { ...r }, r.people ?? [], counts.get(r.id)));
}

function conversation(c: ConversationRow, m: MembershipRow | null, people: string[], counts?: { unread: number; mentions: number }): Conversation {
  return {
    id: c.id, kind: c.kind, name: c.name, people,
    archived: c.archived_at !== null, joined: m !== null, starred: m?.starred ?? false, notify: m?.notify ?? "default",
    unread: counts?.unread ?? 0, mentions: counts?.mentions ?? 0, lastRead: m?.last_read ?? 0,
    lastMessageId: c.last_message_id, lastMessageAt: c.last_message_at?.toISOString() ?? null,
    isDefault: c.is_default, createdBy: c.created_by,
  };
}

// one is a conversation as a member sees it, in the sidebar or not (a
// public channel they preview, an archived one they open).
export async function one(sql: Sql, who: Member, id: number): Promise<Conversation> {
  const a = await access(sql, who, id);
  const people = a.conversation.kind === "direct" ? (await sql<{ member_id: string }[]>`select member_id from conversation_members where conversation_id = ${id} order by member_id`).map(r => r.member_id) : [];
  const [counts] = a.membership ? await summaries(sql, [who.id], id) : [];
  return conversation(a.conversation, a.membership, people, counts);
}

// browse lists the public channels, with how many are in each.
export async function browse(sql: Sql, who: Member): Promise<(Conversation & { memberCount: number })[]> {
  const rows = await sql<(ConversationRow & { joined: boolean; count: number })[]>`
    select c.*, exists (select 1 from conversation_members m where m.conversation_id = c.id and m.member_id = ${who.id}) as joined,
      (select count(*) from conversation_members m where m.conversation_id = c.id)::int as count
    from conversations c where c.kind = 'public' order by c.archived_at is not null, c.name`;
  return rows.map(r => ({ ...conversation(r, r.joined ? { added: true, last_read: 0, notify: "default", starred: false } : null, []), memberCount: r.count }));
}

// details are what the Details panel shows.
export async function details(sql: Sql, request: Request, who: Member, id: number): Promise<Details> {
  const a = await access(sql, who, id);
  const members = (await sql<{ member_id: string }[]>`select member_id from conversation_members where conversation_id = ${id} order by joined_at, member_id`).map(r => r.member_id);
  const given = (await sql<{ group_id: string }[]>`select group_id from conversation_groups where conversation_id = ${id}`).map(r => r.group_id);
  const names = given.length ? new Map((await allGroups()).map(g => [g.id, g.name])) : new Map<string, string>();
  const [about] = a.conversation.about ? await open(request, [{ sealed: a.conversation.about, context: context.about(id) }]) : [null];
  return {
    id, about: about ?? null, members, memberCount: members.length,
    groups: given.filter(g => names.has(g)).map(g => ({ id: g, name: names.get(g)! })),
    canManage: a.manage,
  };
}

// create makes a channel, its creator in it with the people and groups
// they chose.
export async function create(who: Member, input: { kind: "public" | "private"; name: string; about?: string; members: string[]; groups: string[] }): Promise<number> {
  if (!channelName.test(input.name)) throw invalid("invalid_name");
  if (input.about !== undefined && input.about.length > maxAbout) throw invalid();
  const people = (await current(input.members)).map(m => m.id).filter(id => id !== who.id);
  const visible = new Map((await allGroups()).map(g => [g.id, g.name]));
  const groups = input.groups.filter(g => visible.has(g));
  const fromGroups = new Set((await Promise.all(groups.map(groupMembers))).flat());
  const made = await db().begin(async sql => {
    const [row] = await sql<{ id: number }[]>`
      insert into conversations (kind, name, created_by) values (${input.kind}, ${input.name}, ${who.id})
      on conflict (name) where name is not null do nothing returning id`;
    if (!row) throw new Problem(409, "name_taken");
    const id = row.id;
    if (input.about) {
      const [sealed] = await seal([{ value: input.about, context: context.about(id) }]);
      await sql`update conversations set about = ${sealed!} where id = ${id}`;
    }
    const rows = [{ member: who.id, added: true }, ...people.map(p => ({ member: p, added: true })), ...[...fromGroups].filter(p => p !== who.id && !people.includes(p)).map(p => ({ member: p, added: false }))];
    await sql`insert into conversation_members ${sql(rows.map(r => ({ conversation_id: id, member_id: r.member, added: r.added })))}`;
    if (groups.length) await sql`insert into conversation_groups ${sql(groups.map(g => ({ conversation_id: id, group_id: g })))}`;
    await addLine(sql, id, who.id, "created");
    if (people.length || groups.length) await addLine(sql, id, who.id, "added", { members: people, ...(groups.length ? { groups: groups.map(g => visible.get(g)!) } : {}) });
    return { id, people: rows.map(r => r.member) };
  });
  live.later.conversations(made.people);
  return made.id;
}

// direct finds or makes the direct conversation of a set of people (the
// member and 0 to 8 others: alone, it is their notes).
export async function direct(who: Member, others: string[]): Promise<number> {
  const people = [...new Set([who.id, ...(await current(others)).map(m => m.id)])].sort();
  if (others.some(o => !people.includes(o))) throw invalid("invalid_member");
  if (people.length > maxDirect) throw invalid("too_many");
  const key = people.join(",");
  const [found] = await db()<{ id: number }[]>`select id from conversations where direct_key = ${key}`;
  if (found) return found.id;
  const id = await db().begin(async sql => {
    const [made] = await sql<{ id: number }[]>`
      insert into conversations (kind, direct_key, created_by) values ('direct', ${key}, ${who.id})
      on conflict (direct_key) where direct_key is not null do update set direct_key = excluded.direct_key returning id`;
    await sql`insert into conversation_members ${sql(people.map(p => ({ conversation_id: made!.id, member_id: p, added: true })))} on conflict do nothing`;
    return made!.id;
  });
  live.later.conversations(people);
  return id;
}

// forget takes away the threads members followed in a conversation they
// left, unless anyone may read it (a public channel): what happens there is
// no longer theirs to hear of.
async function forget(sql: Sql, conversation: ConversationRow, memberIds: string[]): Promise<void> {
  if (conversation.kind === "public" || !memberIds.length) return;
  await sql`delete from thread_follows f using messages m where f.message_id = m.id and m.conversation_id = ${conversation.id} and f.member_id = any(${memberIds}::text[])`;
}

// join puts a member in a public channel.
export async function join(who: Member, id: number): Promise<void> {
  await db().begin(async sql => {
    const a = await access(sql, who, id);
    if (a.conversation.kind !== "public") throw forbidden();
    if (a.conversation.archived_at) throw new Problem(409, "archived");
    if (a.membership) return;
    await sql`insert into conversation_members (conversation_id, member_id) values (${id}, ${who.id}) on conflict do nothing`;
    await sql`delete from conversation_leaves where conversation_id = ${id} and member_id = ${who.id}`;
    await addLine(sql, id, who.id, "joined");
  });
  live.later.conversations([who.id]);
}

// leave takes a member out of a channel (never the default one, never a
// direct conversation): if a group gave it to them, the group no longer
// does.
export async function leave(who: Member, id: number): Promise<void> {
  await db().begin(async sql => {
    const a = await access(sql, who, id);
    if (a.conversation.kind === "direct" || a.conversation.is_default) throw forbidden();
    if (!a.membership) return;
    await sql`delete from conversation_members where conversation_id = ${id} and member_id = ${who.id}`;
    await sql`insert into conversation_leaves (conversation_id, member_id)
      select ${id}, ${who.id} where exists (select 1 from conversation_groups where conversation_id = ${id}) on conflict do nothing`;
    await forget(sql, a.conversation, [who.id]);
    if (a.conversation.archived_at === null) await addLine(sql, id, who.id, "left");
  });
  live.later.conversations([who.id]);
}

// add puts people and groups in a channel: any member of it may.
export async function add(who: Member, id: number, input: { members: string[]; groups: string[] }): Promise<void> {
  const people = (await current(input.members)).map(m => m.id);
  const visible = new Map((await allGroups()).map(g => [g.id, g.name]));
  const groups = input.groups.filter(g => visible.has(g));
  const fromGroups = [...new Set((await Promise.all(groups.map(groupMembers))).flat())];
  const touched = await db().begin(async sql => {
    const a = await writable(sql, who, id);
    if (a.conversation.kind === "direct") throw forbidden();
    const added = people.length ? (await sql<{ member_id: string }[]>`
      insert into conversation_members ${sql(people.map(p => ({ conversation_id: id, member_id: p, added: true })))}
      on conflict (conversation_id, member_id) do update set added = true where not conversation_members.added
      returning member_id`).map(r => r.member_id) : [];
    if (people.length) await sql`delete from conversation_leaves where conversation_id = ${id} and member_id = any(${people})`;
    if (groups.length) await sql`insert into conversation_groups ${sql(groups.map(g => ({ conversation_id: id, group_id: g })))} on conflict do nothing`;
    const viaGroups = fromGroups.length ? (await sql<{ member_id: string }[]>`
      insert into conversation_members (conversation_id, member_id, added)
      select ${id}, p, false from unnest(${fromGroups}::text[]) p
      where not exists (select 1 from conversation_leaves l where l.conversation_id = ${id} and l.member_id = p)
      on conflict do nothing returning member_id`).map(r => r.member_id) : [];
    const shown = added.filter(p => p !== who.id);
    if (shown.length || groups.length) await addLine(sql, id, who.id, "added", { members: shown, ...(groups.length ? { groups: groups.map(g => visible.get(g)!) } : {}) });
    return [...added, ...viaGroups];
  });
  live.later.conversations(touched);
}

// remove takes someone out of a channel: whoever manages it. A member a
// group gives the channel to stays out while that group does.
export async function remove(who: Member, id: number, person: string): Promise<void> {
  if (person === who.id) return leave(who, id);
  await db().begin(async sql => {
    const a = await access(sql, who, id);
    if (!a.manage || a.conversation.is_default) throw forbidden();
    const gone = await sql`delete from conversation_members where conversation_id = ${id} and member_id = ${person} returning member_id`;
    if (!gone.length) return;
    await sql`insert into conversation_leaves (conversation_id, member_id)
      select ${id}, ${person} where exists (select 1 from conversation_groups where conversation_id = ${id}) on conflict do nothing`;
    await forget(sql, a.conversation, [person]);
    await addLine(sql, id, who.id, "removed", { members: [person] });
  });
  live.later.conversations([person]);
}

// removeGroup takes a group away from a channel: its members whom nothing
// else keeps there leave it.
export async function removeGroup(who: Member, id: number, group: string): Promise<void> {
  const a = await access(db(), who, id);
  if (!a.manage) throw forbidden();
  const kept = (await db()<{ member_id: string }[]>`select member_id from conversation_members where conversation_id = ${id} and not added`).map(r => r.member_id);
  const others = (await db()<{ group_id: string }[]>`select group_id from conversation_groups where conversation_id = ${id} and group_id <> ${group}`).map(r => r.group_id);
  const stay = new Set((await current(kept)).filter(m => (m.groups ?? []).some(g => others.includes(g))).map(m => m.id));
  const gone = kept.filter(p => !stay.has(p));
  await db().begin(async sql => {
    await sql`delete from conversation_groups where conversation_id = ${id} and group_id = ${group}`;
    if (gone.length) await sql`delete from conversation_members where conversation_id = ${id} and not added and member_id = any(${gone})`;
    await forget(sql, a.conversation, gone);
  });
  live.later.conversations(gone);
}

// update renames, describes, archives or unarchives a channel. Any member
// of it describes it; renaming and archiving are its manager's.
export async function update(who: Member, id: number, input: { name?: string; about?: string; archived?: boolean }): Promise<void> {
  const people = await db().begin(async sql => {
    const a = await access(sql, who, id);
    const c = a.conversation;
    if (c.kind === "direct") throw forbidden();
    if (input.name !== undefined && input.name !== c.name) {
      if (!a.manage || c.archived_at) throw forbidden();
      if (!channelName.test(input.name)) throw invalid("invalid_name");
      try {
        await sql.savepoint(sp => sp`update conversations set name = ${input.name!} where id = ${id}`);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new Problem(409, "name_taken");
        throw error;
      }
      await addLine(sql, id, who.id, "renamed", { from: c.name!, to: input.name });
    }
    if (input.about !== undefined) {
      if (!a.write) throw forbidden();
      if (input.about.length > maxAbout) throw invalid();
      const [sealed] = input.about ? await seal([{ value: input.about, context: context.about(id) }]) : [null];
      await sql`update conversations set about = ${sealed ?? null} where id = ${id}`;
      await addLine(sql, id, who.id, "about");
    }
    if (input.archived !== undefined && input.archived !== (c.archived_at !== null)) {
      if (!a.manage || c.is_default) throw forbidden();
      if (input.archived) await addLine(sql, id, who.id, "archived");
      await sql`update conversations set archived_at = ${input.archived ? sql`now()` : null} where id = ${id}`;
      if (!input.archived) await addLine(sql, id, who.id, "unarchived");
    }
    return (await sql<{ member_id: string }[]>`select member_id from conversation_members where conversation_id = ${id}`).map(r => r.member_id);
  });
  live.later.conversations(people);
}

// settings are a member's own: their notifications and star.
export async function settings(who: Member, id: number, input: { notify?: NotifySetting; starred?: boolean }): Promise<void> {
  const changed = await db()`
    update conversation_members set
      notify = coalesce(${input.notify ?? null}, notify),
      starred = coalesce(${input.starred ?? null}, starred)
    where conversation_id = ${id} and member_id = ${who.id} returning 1`;
  if (!changed.length) throw notFound();
  live.later.conversations([who.id]);
}

// firstVisit records a member the first time they come, and puts them in
// the default channels.
export async function firstVisit(who: Member): Promise<void> {
  await db().begin(async sql => {
    const [fresh] = await sql`insert into people (member_id) values (${who.id}) on conflict do nothing returning 1`;
    if (!fresh) return;
    const joined = await sql<{ conversation_id: number }[]>`
      insert into conversation_members (conversation_id, member_id)
      select id, ${who.id} from conversations where is_default and archived_at is null
      on conflict do nothing returning conversation_id`;
    for (const j of joined) await addLine(sql, j.conversation_id, who.id, "joined");
  });
}

// reconcile puts a member in the channels their groups give, and takes them
// out of those no group gives any more (unless added in person): at each
// page they open, and when the Chest says their groups changed.
export async function reconcile(memberId: string, memberGroups: string[]): Promise<void> {
  const changed = await db().begin(async sql => {
    const [any] = await sql`select 1 from conversation_groups limit 1`;
    if (!any) return false;
    const inserted = await sql`
      insert into conversation_members (conversation_id, member_id, added)
      select distinct g.conversation_id, ${memberId}, false from conversation_groups g join conversations c on c.id = g.conversation_id
      where g.group_id = any(${memberGroups}) and c.archived_at is null
        and not exists (select 1 from conversation_leaves l where l.conversation_id = g.conversation_id and l.member_id = ${memberId})
      on conflict do nothing returning 1`;
    const removed = await sql<{ conversation_id: number }[]>`
      delete from conversation_members cm where cm.member_id = ${memberId} and not cm.added
        and not exists (select 1 from conversation_groups g where g.conversation_id = cm.conversation_id and g.group_id = any(${memberGroups}))
      returning conversation_id`;
    for (const r of removed) {
      const [c] = await sql<ConversationRow[]>`select * from conversations where id = ${r.conversation_id}`;
      if (c) await forget(sql, c, [memberId]);
    }
    return inserted.length + removed.length > 0;
  });
  if (changed) live.later.conversations([memberId]);
}

// read moves a member's last read message of a conversation: forward as
// they read, back when they mark a message unread.
export async function markRead(who: Member, id: number, upTo: number): Promise<void> {
  // Forward only, never past the last message: two pages reading at once,
  // or a late request, never move it back (Mark unread has its own way).
  const done = await db()`update conversation_members m set last_read = greatest(m.last_read, least(${upTo}, c.last_message_id))
    from conversations c where c.id = m.conversation_id and m.conversation_id = ${id} and m.member_id = ${who.id} returning 1`;
  if (!done.length) throw notFound();
  live.later.read(who.id, { c: id, m: upTo, t: null });
  later("after a read", () => afterRead(who.id, `c:${id}`));
}

// members are the ids in a conversation.
export async function membersOf(sql: Sql, id: number): Promise<{ member_id: string; notify: NotifySetting }[]> {
  return sql<{ member_id: string; notify: NotifySetting }[]>`select member_id, notify from conversation_members where conversation_id = ${id}`;
}
