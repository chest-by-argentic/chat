import { createContext, useContext, useSyncExternalStore } from "react";
import type { Store, ViewState } from "./store.js";
import type { Words } from "../shared/i18n/index.js";
import type { Conversation, Person } from "../shared/types.js";

// What every component reads: the page's store and the member's words.
export const StoreContext = createContext<Store | null>(null);
export const WordsContext = createContext<Words | null>(null);

const useStoreObject = (): Store => {
  const store = useContext(StoreContext);
  if (!store) throw new Error("no store");
  return store;
};

// useStore reads a slice of the state; the component renders again when it
// changes.
export function useStore<T>(select: (s: ViewState) => T): T {
  const store = useStoreObject();
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

export const useActions = () => useStoreObject().actions;
export const useSnapshot = () => useStoreObject().get;

export function useWords(): Words {
  const words = useContext(WordsContext);
  if (!words) throw new Error("no words");
  return words;
}

// nameOf says a person as the page shows them: their name, marked when the
// tool no longer has them.
export function nameOf(p: Person | undefined, w: Words): string {
  if (!p || p.status === "unknown") return w.unknownPerson;
  if (p.status === "erased" || !p.name) return w.formerMember;
  if (p.status === "former") return `${p.name} ${w.formerSuffix}`;
  if (p.status === "no_access") return `${p.name} ${w.noAccessSuffix}`;
  return p.name;
}

// titleOf names a conversation: #name, or its people but the member.
export function titleOf(c: Pick<Conversation, "kind" | "name" | "people">, people: Record<string, Person>, me: string, w: Words): string {
  if (c.kind !== "direct") return c.name ?? "";
  const others = c.people.filter(p => p !== me);
  if (!others.length) return `${nameOf(people[me], w)} ${w.youSuffix}`;
  return others.map(id => nameOf(people[id], w)).join(", ");
}
