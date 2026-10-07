import type { Route } from "./types.js";

// The addresses of the tool's pages, read the same by the server (what to
// render) and the page (where to go): /chest/c/12, /chest/c/12/t/340,
// /chest/c/12?m=345, /chest/threads, /chest/search?q=…

const views = ["threads", "mentions", "saved", "drafts", "browse"] as const;

export function routeOf(path: string, query: URLSearchParams): Route | null {
  const parts = path.replace(/\/+$/u, "").split("/").slice(2);
  const n = (s: string | undefined) => (s && /^[1-9][0-9]{0,15}$/u.test(s) ? Number(s) : null);
  if (parts.length === 0) return null;
  if (parts[0] === "c" && (parts.length === 2 || (parts.length === 4 && parts[2] === "t"))) {
    const id = n(parts[1]);
    const thread = parts.length === 4 ? n(parts[3]) : null;
    if (id === null || (parts.length === 4 && thread === null)) return null;
    return { view: "conversation", id, thread, message: n(query.get("m") ?? undefined) };
  }
  if (parts.length === 1 && parts[0] === "search") return { view: "search", q: query.get("q") ?? "" };
  if (parts.length === 1 && (views as readonly string[]).includes(parts[0]!)) return { view: parts[0] as (typeof views)[number] };
  return null;
}

export function pathOf(route: Route): string {
  if (route.view === "conversation") return `/chest/c/${route.id}${route.thread ? `/t/${route.thread}` : ""}${route.message ? `?m=${route.message}` : ""}`;
  if (route.view === "search") return `/chest/search${route.q ? `?q=${encodeURIComponent(route.q)}` : ""}`;
  return `/chest/${route.view}`;
}
