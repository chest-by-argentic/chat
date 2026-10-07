import type { Message, SystemKind } from "../shared/types.js";
import type { Sql } from "./db.js";

// addLine writes one of the tool's own lines in a conversation — who
// joined, who renamed it —: words of the tool, never a member's, so in
// clear. It is not a message: it counts as nothing unread.
export async function addLine(sql: Sql, conversation: number, actor: string, kind: SystemKind, meta?: Message["meta"]): Promise<void> {
  // In the conversation's order of ids, as messages are (post).
  await sql`select 1 from conversations where id = ${conversation} for update`;
  const [{ id }] = await sql<{ id: number }[]>`insert into messages (conversation_id, author, kind, meta) values (${conversation}, ${actor}, ${kind}, ${meta ? sql.json(meta) : null}) returning id` as unknown as [{ id: number }];
  await sql`update conversations set last_posted_id = greatest(last_posted_id, ${id}) where id = ${conversation}`;
}
