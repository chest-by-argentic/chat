import type { Message, SystemKind } from "../shared/types.js";
import type { Sql } from "./db.js";

// addLine writes one of the tool's own lines in a conversation — who
// joined, who renamed it —: words of the tool, never a member's, so in
// clear. It is not a message: it counts as nothing unread.
export async function addLine(sql: Sql, conversation: number, actor: string, kind: SystemKind, meta?: Message["meta"]): Promise<void> {
  await sql`insert into messages (conversation_id, author, kind, meta) values (${conversation}, ${actor}, ${kind}, ${meta ? sql.json(meta) : null})`;
}
