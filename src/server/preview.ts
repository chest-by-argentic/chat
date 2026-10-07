import { plain } from "../shared/markdown.js";
import { db } from "./db.js";
import { people } from "./people.js";

// A notice's preview of a message: its words as they read — formatting
// gone, mentions and channels named, lines joined —, the first 120
// characters or so, cut between two words.
export const previewLength = 120;

export async function preview(text: string): Promise<string> {
  const tokens = [...text.matchAll(/<(@mbr_[a-z2-7]{26}|#[1-9][0-9]{0,17})>/gu)].map(m => m[1]!);
  const ids = tokens.filter(t => t.startsWith("@")).map(t => t.slice(1));
  const channels = tokens.filter(t => t.startsWith("#")).map(t => Number(t.slice(1)));
  const named = new Map((await people(ids)).map(p => [p.id, p.name]));
  // A channel is named only when it is public: a private one's name stays
  // where it is.
  const rooms = channels.length ? new Map((await db()<{ id: number; name: string }[]>`
    select id, name from conversations where id = any(${channels}::bigint[]) and kind = 'public'`).map(r => [r.id, r.name])) : new Map<number, string>();
  const words = plain(text, { member: id => named.get(id) ?? "", channel: id => rooms.get(id) ?? "…", special: kind => kind });
  return cut(words);
}

// cut keeps a text to the preview's length, between two words.
export function cut(words: string): string {
  if (words.length <= previewLength) return words;
  const head = words.slice(0, previewLength);
  const space = head.lastIndexOf(" ");
  return (space > previewLength / 2 ? head.slice(0, space) : head).replace(/[\s.,;:!?-]+$/u, "") + "…";
}
