import { randomBytes } from "node:crypto";
import { Hono } from "hono/tiny";
import { serveStatic } from "@hono/node-server/serve-static";
import { member } from "@argentic/chest-sdk/member";
import { SealedLocked } from "@argentic/chest-sdk/errors";
import type { Initial, Route } from "../shared/types.js";
import { routeOf } from "../shared/route.js";
import { languageOf, words } from "../shared/i18n/index.js";
import { db } from "./db.js";
import { api, state } from "./api.js";
import * as conversations from "./conversations.js";
import * as messages from "./messages.js";
import { memberEvent, scheduleRun } from "./chest-calls.js";
import { Problem } from "./problem.js";
import { document } from "./document.js";
import { people } from "./people.js";

export { settled } from "./later.js";
export { closeDb } from "./db.js";

type Env = { Variables: { nonce: string } };

// The tool's server: its members' part under /chest (the Chest signs the
// member in and asserts who they are on every request), its API under
// /chest/api, the browser's files under /assets/, and what the Chest calls
// by itself (/chest-events, /chest-schedules). No public part.
export const app = new Hono<Env>();

// Every answer carries the tool's own policy, a fresh nonce per answer: the
// page's scripts and styles are the tool's own files; images come from the
// tool's host (the Chest's signed file links and members' photos are on
// it); the page connects to its host only (the API, the Chest's realtime).
app.use(async (c, next) => {
  const nonce = randomBytes(16).toString("base64");
  c.set("nonce", nonce);
  await next();
  c.header("Content-Security-Policy", `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data: blob:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
});

app.use("/assets/*", serveStatic({ root: "./dist/client" }));
app.route("/chest/api", api);

app.post("/chest-events", async c => c.body(null, await memberEvent(c.req.raw) as 204));
app.post("/chest-schedules", async c => c.body(null, await scheduleRun(c.req.raw) as 204));

// The pages: every address of the tool renders the whole frame, the route
// it names open in it.
app.get("/chest/*", async c => page(c.req.raw, c.get("nonce")));
app.get("/chest", async c => page(c.req.raw, c.get("nonce")));

async function page(request: Request, nonce: string): Promise<Response> {
  const who = member(request);
  if (!who) return new Response("Open Chat from your Chest.", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const url = new URL(request.url);
  let route: Route | null = url.pathname === "/chest" ? null : routeOf(url.pathname, url.searchParams);
  if (url.pathname !== "/chest" && !route) return new Response("Not found", { status: 404 });
  const initial: Initial = { state: await state(request, who), route: route ?? { view: "conversation", id: 0, thread: null, message: null }, conversation: null, page: null, thread: null, missing: false, home: !route };
  if (!route) {
    // /chest: the conversation the member had open, or the first default one.
    const [last] = await db()<{ id: number }[]>`
      select c.id from conversations c join conversation_members m on m.conversation_id = c.id and m.member_id = ${who.id}
      left join people p on p.member_id = ${who.id}
      where c.archived_at is null order by (c.id = p.last_conversation) desc nulls last, c.is_default desc, c.id limit 1`;
    route = initial.route = last ? { view: "conversation", id: last.id, thread: null, message: null } : { view: "browse" };
  }
  if (route.view === "conversation") {
    try {
      initial.conversation = await conversations.one(db(), who, route.id);
      if (!initial.state.locked) {
        initial.page = await messages.page(request, who, route.id, route.message ? { around: route.message } : {});
        if (route.thread) initial.thread = await messages.thread(request, who, route.thread);
      }
      await db()`update people set last_conversation = ${route.id} where member_id = ${who.id}`;
      // The names the first page shows come with it.
      const shown = [...(initial.page?.messages ?? []), ...(initial.thread ? [initial.thread.root, ...initial.thread.replies] : [])];
      const ids = new Set(shown.flatMap(m => [m.author, ...m.repliers, ...(m.meta?.members ?? []), ...m.reactions.flatMap(r => r.members)]));
      const named = new Set(initial.state.people.map(p => p.id));
      initial.state.people.push(...await people([...ids].filter(id => !named.has(id))));
    } catch (error) {
      if (error instanceof SealedLocked) initial.state.locked = true;
      else if (error instanceof Problem && error.status === 404) initial.missing = true;
      else throw error;
    }
  }
  const w = words(who.language);
  return new Response(document({ title: w.title, language: languageOf(who.language), nonce }, initial), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
