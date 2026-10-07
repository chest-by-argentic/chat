import { Hono } from "hono/tiny";
import type { Context } from "hono";
import { member, type Member } from "@argentic/chest-sdk/member";
import * as files from "@argentic/chest-sdk/files";
import { chest } from "@argentic/chest-sdk/chest";
import { SealedLocked } from "@argentic/chest-sdk/errors";
import type { NotifySetting, Sidebar, State } from "../shared/types.js";
import { groupId, maxAbout, maxText, maxUpload, memberId } from "../shared/rules.js";
import { db } from "./db.js";
import { Problem, id, invalid, list, matching, oneOf, optionalId, optionalText, record, text } from "./problem.js";
import * as conversations from "./conversations.js";
import * as messages from "./messages.js";
import * as people from "./people.js";
import { parse as parseQuery, search } from "./search.js";
import { threadsUnread } from "./counts.js";

// The tool's API, under /chest/api: JSON in and out, for the member the
// Chest asserts on each request. Writes come from the tool's own pages:
// JSON only (a form of another site cannot send it), and never from
// another site (Sec-Fetch-Site).

type Env = { Variables: { who: Member } };
export const api = new Hono<Env>();

api.use(async (c, next) => {
  const who = member(c.req.raw);
  if (!who) return c.json({ error: "signed_out" }, 401);
  if (c.req.method !== "GET") {
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin") return c.json({ error: "forbidden" }, 403);
    if (c.req.method !== "DELETE" && !(c.req.header("content-type") ?? "").startsWith("application/json")) return c.json({ error: "invalid_body" }, 415);
  }
  c.set("who", who);
  await next();
  if (!c.res.headers.has("cache-control")) c.header("Cache-Control", "no-store");
});

api.onError((error, c) => {
  if (error instanceof Problem) return c.json({ error: error.code }, error.status);
  if (error instanceof SealedLocked) return c.json({ error: "locked" }, 423);
  console.error(`chat: ${c.req.method} ${c.req.routePath} failed: ${error instanceof Error ? error.message : "unknown error"}`);
  return c.json({ error: "failed" }, 500);
});

const body = async (c: Context): Promise<Record<string, unknown>> => {
  try {
    return record(await c.req.json());
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw invalid();
  }
};
const param = (c: Context, name: string) => id(c.req.param(name));
const query = (c: Context, name: string) => optionalId(c.req.query(name));
const flag = (v: unknown) => {
  if (typeof v !== "boolean") throw invalid();
  return v;
};
const memberIds = (v: unknown) => (v === undefined ? [] : list(v, 1000, matching(memberId, "invalid_member")));
const groupIds = (v: unknown) => (v === undefined ? [] : list(v, 100, matching(groupId, "invalid_group")));

// The member's state: the frame of every page.
export async function state(request: Request, who: Member): Promise<State> {
  const sql = db();
  await conversations.firstVisit(who);
  await conversations.reconcile(who.id, await people.groupsOf(who));
  const list = await conversations.list(sql, who);
  let drafts: State["drafts"] = [], locked = false;
  try {
    drafts = await messages.drafts(request, who);
  } catch (error) {
    if (!(error instanceof SealedLocked)) throw error;
    locked = true;
  }
  const ids = new Set([who.id, ...list.flatMap(c => c.people)]);
  return {
    threadsUnread: await threadsUnread(sql, who.id),
    me: { id: who.id, name: who.name, isAdmin: who.isAdmin, language: who.language, timeZone: who.timeZone },
    organization: chest.organization.name,
    conversations: list,
    people: await people.people(ids),
    drafts,
    locked,
    now: new Date().toISOString(),
  };
}

// The sidebar alone: the conversations, their people, the threads unread.
api.get("/sidebar", async c => {
  const who = c.get("who"), sql = db();
  const list = await conversations.list(sql, who);
  const answer: Sidebar = { conversations: list, people: await people.people(list.flatMap(x => x.people)), threadsUnread: await threadsUnread(sql, who.id) };
  return c.json(answer);
});

// People and groups.
api.get("/people", async c => {
  const q = c.req.query("q");
  if (q !== undefined) return c.json(await people.search(text(q, 100, 1)));
  const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean);
  if (ids.length > 200) throw invalid();
  return c.json(await people.people(ids.map(matching(memberId, "invalid_member"))));
});
api.get("/groups", async c => c.json((await people.groups()).map(g => ({ id: g.id, name: g.name, size: g.size }))));

// Conversations.
api.get("/conversations", async c => c.json(await conversations.browse(db(), c.get("who"))));
api.post("/conversations", async c => {
  const b = await body(c);
  const kind = oneOf(b["kind"], ["public", "private"] as const);
  const made = await conversations.create(c.get("who"), { kind, name: text(b["name"], 80, 1), about: optionalText(b["about"], maxAbout), members: memberIds(b["members"]), groups: groupIds(b["groups"]) });
  return c.json(await conversations.one(db(), c.get("who"), made), 201);
});
api.post("/direct", async c => {
  const b = await body(c);
  const made = await conversations.direct(c.get("who"), memberIds(b["members"]));
  return c.json(await conversations.one(db(), c.get("who"), made));
});
api.get("/conversations/:id", async c => c.json(await conversations.one(db(), c.get("who"), param(c, "id"))));
api.get("/conversations/:id/details", async c => c.json(await conversations.details(db(), c.req.raw, c.get("who"), param(c, "id"))));
api.patch("/conversations/:id", async c => {
  const b = await body(c);
  await conversations.update(c.get("who"), param(c, "id"), {
    ...(b["name"] !== undefined ? { name: text(b["name"], 80, 1) } : {}),
    ...(b["about"] !== undefined ? { about: text(b["about"], maxAbout) } : {}),
    ...(b["archived"] !== undefined ? { archived: flag(b["archived"]) } : {}),
  });
  return c.json(await conversations.one(db(), c.get("who"), param(c, "id")));
});
api.put("/conversations/:id/settings", async c => {
  const b = await body(c);
  await conversations.settings(c.get("who"), param(c, "id"), {
    ...(b["notify"] !== undefined ? { notify: oneOf(b["notify"], ["default", "all", "mentions", "none"] as const) as NotifySetting } : {}),
    ...(b["starred"] !== undefined ? { starred: flag(b["starred"]) } : {}),
  });
  return c.body(null, 204);
});
api.post("/conversations/:id/join", async c => {
  await conversations.join(c.get("who"), param(c, "id"));
  return c.json(await conversations.one(db(), c.get("who"), param(c, "id")));
});
api.post("/conversations/:id/leave", async c => {
  await conversations.leave(c.get("who"), param(c, "id"));
  return c.body(null, 204);
});
api.post("/conversations/:id/members", async c => {
  const b = await body(c);
  await conversations.add(c.get("who"), param(c, "id"), { members: memberIds(b["members"]), groups: groupIds(b["groups"]) });
  return c.body(null, 204);
});
api.delete("/conversations/:id/members/:member", async c => {
  await conversations.remove(c.get("who"), param(c, "id"), matching(memberId, "invalid_member")(c.req.param("member")));
  return c.body(null, 204);
});
api.delete("/conversations/:id/groups/:group", async c => {
  await conversations.removeGroup(c.get("who"), param(c, "id"), matching(groupId, "invalid_group")(c.req.param("group")));
  return c.body(null, 204);
});
api.put("/conversations/:id/read", async c => {
  const b = await body(c);
  await conversations.markRead(c.get("who"), param(c, "id"), id(b["message"]));
  return c.body(null, 204);
});
api.get("/conversations/:id/pinned", async c => c.json(await messages.pinned(c.req.raw, c.get("who"), param(c, "id"))));

// Messages.
api.get("/conversations/:id/messages", async c => {
  const before = query(c, "before"), after = query(c, "after"), around = query(c, "around");
  return c.json(await messages.page(c.req.raw, c.get("who"), param(c, "id"), { ...(before ? { before } : {}), ...(after ? { after } : {}), ...(around ? { around } : {}) }));
});
api.post("/conversations/:id/messages", async c => {
  const b = await body(c);
  const attached = b["files"] === undefined ? [] : list(b["files"], 10, f => {
    const r = record(f);
    return { object: text(r["object"], 200, 1), name: text(r["name"], 255, 1) };
  });
  return c.json(await messages.post(c.req.raw, c.get("who"), param(c, "id"), { text: text(b["text"] ?? "", maxText + 1000), thread: optionalId(b["thread"]), files: attached }), 201);
});
api.get("/messages", async c => {
  const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean).map(id);
  if (!ids.length || ids.length > 200) throw invalid();
  return c.json(await messages.byIds(c.req.raw, c.get("who"), ids));
});
api.patch("/messages/:id", async c => {
  const b = await body(c);
  return c.json(await messages.edit(c.req.raw, c.get("who"), param(c, "id"), text(b["text"], maxText + 1000)));
});
api.delete("/messages/:id", async c => {
  await messages.remove(c.get("who"), param(c, "id"));
  return c.body(null, 204);
});
api.put("/messages/:id/reactions", async c => {
  const b = await body(c);
  await messages.react(c.get("who"), param(c, "id"), text(b["emoji"], 32, 1), flag(b["on"]));
  return c.body(null, 204);
});
api.put("/messages/:id/pin", async c => {
  await messages.pin(c.get("who"), param(c, "id"), flag((await body(c))["on"]));
  return c.body(null, 204);
});
api.put("/messages/:id/saved", async c => {
  await messages.save(c.get("who"), param(c, "id"), flag((await body(c))["on"]));
  return c.body(null, 204);
});
api.post("/messages/:id/unread", async c => c.json(await messages.markUnread(c.get("who"), param(c, "id"))));

// Threads.
api.get("/threads/:id", async c => c.json(await messages.thread(c.req.raw, c.get("who"), param(c, "id"), query(c, "before") ?? undefined)));
api.put("/threads/:id/read", async c => {
  await messages.readThread(c.get("who"), param(c, "id"), id((await body(c))["message"]));
  return c.body(null, 204);
});
api.put("/threads/:id/follow", async c => {
  await messages.follow(c.get("who"), param(c, "id"), flag((await body(c))["on"]));
  return c.body(null, 204);
});

// The member's views.
api.get("/threads", async c => c.json(await messages.followed(c.req.raw, c.get("who"), query(c, "before") ?? undefined)));
api.get("/mentions", async c => c.json(await messages.mentioning(c.req.raw, c.get("who"), query(c, "before") ?? undefined)));
api.get("/saved", async c => c.json(await messages.savedBy(c.req.raw, c.get("who"), query(c, "before") ?? undefined)));
api.get("/drafts", async c => c.json(await messages.drafts(c.req.raw, c.get("who"))));
api.put("/drafts", async c => {
  const b = await body(c);
  await messages.keepDraft(c.get("who"), id(b["conversation"]), optionalId(b["thread"]), text(b["text"], maxText + 1000));
  return c.body(null, 204);
});

// Search.
api.get("/search", async c => {
  const q = text(c.req.query("q") ?? "", 500);
  return c.json(await search(c.req.raw, c.get("who"), parseQuery(q), query(c, "cursor")));
});

// Files: an upload the member's browser sends to the Chest itself, into
// their own folder; a link to a file of a message they may read.
api.post("/uploads", async c => {
  const b = await body(c);
  await conversations.writable(db(), c.get("who"), id(b["conversation"]));
  const size = b["size"];
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw invalid();
  if (size > maxUpload) throw new Problem(413, "too_large");
  await messages.roomForUpload(c.get("who"));
  const up = await files.uploadUrl(messages.uploadFolder(c.get("who").id), { maxSize: Math.max(size, 1) });
  // The Chest's address is the page's own host: the page sends to the path.
  return c.json({ url: new URL(up.url).pathname, expiresIn: up.expiresIn });
});

api.get("/files/:id", async c => {
  const size = c.req.query("size");
  const url = await messages.fileLink(c.get("who"), param(c, "id"), {
    ...(size === "256" ? { thumbnail: 256 } : size === "1024" ? { thumbnail: 1024 } : {}),
    ...(c.req.query("download") !== undefined ? { download: true } : {}),
  });
  // Kept a minute: images are not asked again on every render, and a
  // member taken out of a conversation is not given new links for long.
  c.header("Cache-Control", "private, max-age=60");
  return c.redirect(new URL(url).pathname, 302);
});
