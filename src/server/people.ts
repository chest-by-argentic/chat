import * as members from "@argentic/chest-sdk/members";
import type { Member } from "@argentic/chest-sdk/member";
import type { Person } from "../shared/types.js";
import { memberId } from "../shared/rules.js";

// People are named by the Chest when shown, never copied into the tool's
// data: ids in, names out (the SDK keeps lookups a minute).

export function person(m: Member): Person {
  return { id: m.id, name: m.name, photo: m.photo, status: "member" };
}

// people names these ids: members who have the tool, those it had (with
// their status), and the ids it never had.
export async function people(ids: Iterable<string>): Promise<Person[]> {
  const wanted = [...new Set([...ids].filter(id => memberId.test(id)))];
  if (wanted.length === 0) return [];
  const found = await members.lookup(wanted);
  return [
    ...found.members.map(person),
    ...found.former.map(f => ({ id: f.id, name: f.name ?? "", photo: null, status: f.status })),
    ...found.unknown.map(id => ({ id, name: "", photo: null, status: "unknown" as const })),
  ];
}

// current keeps the ids of members who have the tool now: those a
// conversation may be given.
export async function current(ids: Iterable<string>): Promise<Member[]> {
  const wanted = [...new Set([...ids].filter(id => memberId.test(id)))];
  return wanted.length ? (await members.lookup(wanted)).members : [];
}

// groupMembers lists the members of a group who have the tool, page after
// page.
export async function groupMembers(group: string): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const page = await members.list({ group, limit: 500, ...(after ? { after } : {}) });
    ids.push(...page.members.map(m => m.id));
    after = page.next ?? undefined;
  } while (after);
  return ids;
}

// groups lists every group the tool sees, page after page.
export async function groups(): Promise<members.Group[]> {
  const all: members.Group[] = [];
  let after: string | undefined;
  do {
    const page = await members.groups.list({ limit: 500, ...(after ? { after } : {}) });
    all.push(...page.groups);
    after = page.next ?? undefined;
  } while (after);
  return all;
}

// search finds members by the start of their names.
export async function search(q: string): Promise<Person[]> {
  return (await members.list({ q, limit: 20 })).members.map(person);
}

// groupsOf is a member's groups: from their request, or asked of the Chest
// when too many travelled with it (groups overage).
export async function groupsOf(m: Member): Promise<string[]> {
  if (m.groups !== null) return m.groups;
  return (await members.get(m.id))?.groups ?? [];
}
