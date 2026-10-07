import type { Person } from "../shared/types.js";
import { nameOf, useStore, useWords } from "./context.js";

// Small pieces every pane uses: icons, avatars, presence, names.

const paths = {
  hash: "M9 4 7 20M17 4l-2 16M4 9h16M3 15h16",
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
  plus: "M12 5v14M5 12h14",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20",
  threads: "M4 5h12v9H8l-4 3zM20 9v10l-3-2h-7",
  at: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  bookmark: "M6 4h12v16l-6-4-6 4z",
  pencil: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  close: "M6 6l12 12M18 6 6 18",
  back: "M15 5l-7 7 7 7",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6M12 7.5v.5",
  star: "m12 4 2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.2 7 19l1.2-5.6L4 9.6 9.6 9z",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.5M15 9.5v.5",
  reply: "M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1",
  more: "M5 12h.5M12 12h.5M19 12h.5",
  pin: "M9 4h6l-1 6 3 3H7l3-3zM12 13v7",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  unread: "M4 6h16v12H4zM4 6l8 7 8-7",
  clip: "M17 11.5 11 17.5a4 4 0 0 1-5.7-5.7l7-7a2.7 2.7 0 0 1 3.8 3.8l-7 7a1.3 1.3 0 0 1-1.9-1.9l6.3-6.2",
  send: "M4 12 20 4l-4 16-4-7zM12 13l8-9",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4",
  file: "M7 3h7l4 4v14H7zM14 3v4h4",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5",
  down: "M12 5v14M6 13l6 6 6-6",
  check: "m5 12 5 5 9-10",
  keyboard: "M3 6h18v12H3zM7 10h.5M11 10h.5M15 10h.5M7 14h10",
  archive: "M4 5h16v4H4zM5 9v10h14V9M10 13h4",
  edit: "M4 20h4L19 9l-4-4L4 16z",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

// initials of a person, for an avatar without a photo.
const initials = (name: string) => name.split(/\s+/u).filter(Boolean).slice(0, 2).map(s => [...s][0]!.toUpperCase()).join("") || "·";

export function Avatar({ person, size = 32 }: { person: Person | undefined; size?: number }) {
  const w = useWords();
  const name = nameOf(person, w);
  return (
    <span className="avatar" data-size={size} aria-hidden="true">
      {person?.photo ? <img src={person.photo} alt="" width={size} height={size} loading="lazy" /> : <span>{initials(person?.status === "member" || person?.status === "former" || person?.status === "no_access" ? person.name : name)}</span>}
    </span>
  );
}

// Presence: a filled dot for someone active, a hollow one for someone
// away, nothing for someone not here.
export function Presence({ id }: { id: string }) {
  const w = useWords();
  const away = useStore(s => s.away[id]);
  if (away === undefined) return null;
  return <span className={away ? "presence away" : "presence active"} role="img" aria-label={away ? w.away : w.active} title={away ? w.away : w.active} />;
}
