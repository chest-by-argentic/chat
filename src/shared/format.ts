import type { Words } from "./i18n/index.js";

// Times and days as a member reads them, in their zone and language. Only
// numbers come from Intl (the same in Node and every browser); the words
// come from the catalogue: a page rendered on the server hydrates without a
// difference.

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsOf(at: Date, timeZone: string): Parts {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short" });
    formatters.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(at)) p[part.type] = part.value;
  return {
    year: Number(p["year"]), month: Number(p["month"]), day: Number(p["day"]),
    hour: Number(p["hour"]) % 24, minute: Number(p["minute"]),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p["weekday"] ?? ""),
  };
}

// dayKey is the member's day of an instant, "2026-10-07": what groups
// messages under one divider.
export function dayKey(at: string, timeZone: string): string {
  const p = partsOf(new Date(at), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// time is "14:05" (French) or "2:05 PM" (English).
export function time(at: string, timeZone: string, words: Words): string {
  const p = partsOf(new Date(at), timeZone);
  const mm = String(p.minute).padStart(2, "0");
  if (words.clock === "24") return `${p.hour}:${mm}`;
  const h = p.hour % 12 || 12;
  return `${h}:${mm} ${p.hour < 12 ? "AM" : "PM"}`;
}

// day is "Today", "Yesterday", "Monday 5 October" (the year when not this
// one), relative to now.
export function day(at: string, timeZone: string, words: Words, now = new Date()): string {
  const p = partsOf(new Date(at), timeZone), today = partsOf(now, timeZone);
  const serial = (x: Parts) => Date.UTC(x.year, x.month - 1, x.day) / 86400000;
  const diff = serial(today) - serial(p);
  if (diff === 0) return words.today;
  if (diff === 1) return words.yesterday;
  return words.date(words.weekdays[p.weekday]!, p.day, words.months[p.month - 1]!, p.year === today.year ? null : p.year);
}

// stamp is a message's full time, for its tooltip: "Monday 5 October at
// 14:05".
export function stamp(at: string, timeZone: string, words: Words, now = new Date()): string {
  return words.at(day(at, timeZone, words, now), time(at, timeZone, words));
}

// size is a file's size: "212 kB", "1.4 MB".
export function size(bytes: number, words: Words): string {
  const units = ["B", "kB", "MB", "GB"];
  let n = bytes, u = 0;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  const text = u === 0 || n >= 10 ? String(Math.round(n)) : n.toFixed(1);
  return `${words.decimal === "," ? text.replace(".", ",") : text} ${units[u]}`;
}
