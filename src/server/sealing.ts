import { openMany, sealMany } from "@argentic/chest-sdk/sealed";

// Every text a member writes is sealed by the Chest under the tool's key,
// bound to the row it belongs to (its context): a sealed body copied into
// another row opens nowhere. Only a member's request opens, through its
// ticket; the Chest journals each open.

export const context = {
  message: (id: number) => `m:${id}`,
  file: (object: string) => `f:${object}`,
  draft: (member: string, conversation: number, thread: number) => `d:${member}:${conversation}:${thread}`,
  about: (conversation: number) => `about:${conversation}`,
};

type ToSeal = { value: string; context: string };
type ToOpen = { sealed: string; context: string };

// A call to the Chest carries 4 MiB at most: values are opened in chunks
// that fit, one call each.
const callBudget = 3 << 20;

// seal seals values in one call, in their order.
export async function seal(items: ToSeal[]): Promise<string[]> {
  if (items.length === 0) return [];
  const out: string[] = [];
  for (const chunk of chunks(items, i => i.value.length * 3)) out.push(...await sealMany(chunk));
  return out;
}

// open opens values for the member of the request, in their order: the
// text, "" for an empty value (a deleted message), null for one the
// member may not open or that does not open in its context. SealedLocked and
// the Chest's other refusals are thrown: the page says them.
export async function open(request: Request, items: ToOpen[]): Promise<(string | null)[]> {
  const out: (string | null)[] = items.map(i => (i.sealed === "" ? "" : null));
  const wanted = items.map((item, index) => ({ item, index })).filter(w => w.item.sealed !== "");
  for (const chunk of chunks(wanted, w => w.item.sealed.length + w.item.context.length + 64)) {
    const values = await openMany(request, chunk.map(w => w.item));
    chunk.forEach((w, i) => { out[w.index] = values[i] ?? null; });
  }
  return out;
}

function chunks<T>(items: T[], weight: (item: T) => number): T[][] {
  const out: T[][] = [];
  let current: T[] = [], size = 0;
  for (const item of items) {
    const w = weight(item);
    if (current.length && size + w > callBudget) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += w;
  }
  if (current.length) out.push(current);
  return out;
}
