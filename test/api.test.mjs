import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { connect } from "@argentic/chest-sdk/realtime/client";
import { startLab } from "./lab/lab.mjs";
import { camille, groups, hugo, lea, members, robin, sam } from "./lab/people.mjs";
import { visit } from "./lab/seed.mjs";

// The tool against a real PostgreSQL and the SDK's fake Chest, through a
// front that plays the Chest's: what each member may read and write, what
// stays sealed, who is told what, and what the Chest's calls do.

let lab, settled;
before(async () => {
  lab = await startLab({ members, groups });
  ({ settled } = await import("../dist/test/app.js"));
  for (const m of members) await visit(lab, m);
});
after(() => lab?.close());

// call asks the tool's API as a member: the status and the answer.
async function call(member, method, path, body, headers = {}) {
  const response = await fetch(lab.url + "/chest/api" + path, {
    method, redirect: "manual",
    headers: { ...(member ? { cookie: `member=${member.id}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: response.status, json, headers: response.headers };
}
const ok = async (...args) => {
  const r = await call(...args);
  assert.ok(r.status < 300, `${args[1]} ${args[2]}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};
let n = 0;
const channel = (owner, kind, extra = {}) => ok(owner, "POST", "/conversations", { kind, name: `room-${++n}`, members: [], ...extra });
const say = (who, c, text, thread) => ok(who, "POST", `/conversations/${c}/messages`, { text, ...(thread ? { thread } : {}) });

test("the page: the member's frame under the tool's policy; nobody else", async () => {
  const page = await fetch(lab.url + "/chest", { headers: { cookie: `member=${camille.id}` } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-island="Chat"/u);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self' 'nonce-[^']+'; style-src 'self' 'nonce-/u);
  assert.doesNotMatch(page.headers.get("content-security-policy"), /unsafe-inline/u);
  assert.equal((await fetch(lab.url + "/chest")).status, 401);
  assert.equal((await fetch(lab.url + "/chest/nowhere", { headers: { cookie: `member=${camille.id}` } })).status, 404);
  assert.equal((await call(null, "GET", "/sidebar")).status, 401);
});

test("everyone joins #general at their first visit", async () => {
  for (const m of members) {
    const sidebar = await ok(m, "GET", "/sidebar");
    assert.ok(sidebar.conversations.some(c => c.name === "general" && c.joined && c.isDefault), m.name);
  }
  const general = (await ok(camille, "GET", "/sidebar")).conversations.find(c => c.name === "general");
  assert.equal((await call(camille, "POST", `/conversations/${general.id}/leave`, {})).status, 403, "the default channel is never left");
});

test("a message is sealed in the database and opened for those who may read it", async () => {
  const c = await channel(camille, "public");
  const sent = await say(camille, c.id, "The *secret* plan for Q4");
  assert.equal(sent.text, "The *secret* plan for Q4");
  const [row] = await lab.sql`select body from messages where id = ${sent.id}`;
  assert.match(row.body, /^chest:sealed:1::/u);
  assert.doesNotMatch(row.body, /secret/u);
  const opens = lab.chest.opens.length;
  await ok(sam, "POST", `/conversations/${c.id}/join`, {});
  const page = await ok(sam, "GET", `/conversations/${c.id}/messages`);
  assert.equal(page.messages.find(m => m.id === sent.id).text, "The *secret* plan for Q4");
  assert.ok(lab.chest.opens.slice(opens).some(o => o.member === sam.id && o.opened >= 1), "the Chest journals the open for Sam");
  // A sealed body copied into another row opens nowhere.
  const other = await say(camille, c.id, "decoy");
  await lab.sql`update messages set body = ${row.body} where id = ${other.id}`;
  const after = await ok(sam, "GET", `/messages?ids=${other.id}`);
  assert.equal(after[0].text, null);
});

test("a private channel is invisible to whoever is not in it", async () => {
  const c = await channel(camille, "private", { members: [sam.id] });
  const m = await say(camille, c.id, "board only");
  for (const [method, path, body] of [
    ["GET", `/conversations/${c.id}`], ["GET", `/conversations/${c.id}/messages`], ["GET", `/conversations/${c.id}/details`],
    ["GET", `/conversations/${c.id}/pinned`], ["GET", `/threads/${m.id}`], ["POST", `/conversations/${c.id}/messages`, { text: "hi" }],
    ["PUT", `/messages/${m.id}/reactions`, { emoji: "👍", on: true }], ["PUT", `/messages/${m.id}/saved`, { on: true }],
    ["PUT", `/messages/${m.id}/pin`, { on: true }], ["POST", `/conversations/${c.id}/join`, {}], ["POST", `/conversations/${c.id}/members`, { members: [robin.id] }],
    ["PUT", "/drafts", { conversation: c.id, text: "x" }], ["POST", "/uploads", { conversation: c.id, size: 10 }],
  ]) {
    assert.equal((await call(robin, method, path, body)).status, 404, `${method} ${path}`);
  }
  assert.deepEqual(await ok(robin, "GET", `/messages?ids=${m.id}`), []);
  assert.ok(!(await ok(robin, "GET", "/conversations")).some(x => x.id === c.id), "not in Browse");
  const found = await ok(robin, "GET", `/search?q=${encodeURIComponent("board only")}`);
  assert.equal(found.messages.length, 0);
  assert.equal((await ok(sam, "GET", `/search?q=${encodeURIComponent("board only")}`)).messages.length, 1);
});

test("a public channel is read by all, written by its members", async () => {
  const c = await channel(camille, "public");
  await say(camille, c.id, "hello");
  assert.equal((await ok(robin, "GET", `/conversations/${c.id}/messages`)).messages.length >= 1, true);
  assert.equal((await call(robin, "POST", `/conversations/${c.id}/messages`, { text: "me too" })).status, 403);
  await ok(robin, "POST", `/conversations/${c.id}/join`, {});
  await say(robin, c.id, "me too");
  await ok(camille, "PATCH", `/conversations/${c.id}`, { archived: true });
  assert.equal((await call(robin, "POST", `/conversations/${c.id}/messages`, { text: "late" })).status, 409, "archived: read only");
  assert.equal((await call(robin, "PATCH", `/conversations/${c.id}`, { archived: false })).status, 403, "only its creator or an admin");
});

test("direct conversations: one per set of people, closed to the others", async () => {
  const a = await ok(sam, "POST", "/direct", { members: [hugo.id] });
  const b = await ok(hugo, "POST", "/direct", { members: [sam.id] });
  assert.equal(a.id, b.id);
  assert.deepEqual(a.people.sort(), [hugo.id, sam.id].sort());
  await say(sam, a.id, "just us");
  assert.equal((await call(robin, "GET", `/conversations/${a.id}/messages`)).status, 404);
  assert.equal((await call(sam, "PATCH", `/conversations/${a.id}`, { name: "x" })).status, 403);
  const notes = await ok(robin, "POST", "/direct", { members: [] });
  assert.deepEqual(notes.people, [robin.id]);
});

test("mentions notify who is away, by name and place, never with the words", async () => {
  const c = await channel(camille, "public", { members: [sam.id, hugo.id, lea.id] });
  // Léa has Chat open in front of her: she sees it come.
  const page = connect({ url: lab.chest.realtime.url(lea.id) });
  page.channel("everyone").presence.track({ away: false });
  await waitFor(async () => (await presence()).includes(lea.id));
  const before = lab.chest.notifications.length;
  const sent = await say(camille, c.id, `Budget numbers for <@${sam.id}> <@${lea.id}> and <@${robin.id}>`);
  await settled();
  const items = lab.chest.notifications.slice(before);
  const toSam = items.find(i => i.member === sam.id);
  assert.ok(toSam, "Sam, away, is notified");
  assert.equal(toSam.title, `Camille Martin in #${c.name}`);
  assert.equal(toSam.body, "Mentioned you");
  assert.equal(toSam.key, `c:${c.id}`);
  assert.equal(toSam.path, `/chest/c/${c.id}?m=${sent.id}`);
  assert.ok(!JSON.stringify(items).includes("Budget"), "no words in a notice");
  assert.ok(!items.some(i => [i.member].includes(lea.id)), "Léa is looking: no notice");
  assert.ok(!items.some(i => [i.member].includes(robin.id)), "Robin is not in the channel");
  assert.ok(!items.some(i => [i.member].includes(hugo.id)), "Hugo, not mentioned, is on Mentions for channels");
  const hugoItem = lab.chest.notifications.find(i => [i.member].includes(hugo.id) && i.title?.includes("dans"));
  assert.equal(hugoItem, undefined);
  page.close();
});

test("a mention reaches only the conversation's members; @here, those active now", async () => {
  const c = await channel(camille, "private", { members: [sam.id, lea.id] });
  const page = connect({ url: lab.chest.realtime.url(lea.id) });
  page.channel("everyone").presence.track({ away: false });
  const away = connect({ url: lab.chest.realtime.url(sam.id) });
  away.channel("everyone").presence.track({ away: true });
  await waitFor(async () => (await presence()).includes(lea.id));
  const m = await say(camille, c.id, `<!here> and <@${robin.id}>`);
  const [row] = await lab.sql`select mentions, mention_here from messages where id = ${m.id}`;
  assert.deepEqual(row.mentions, [lea.id], "Léa is active; Sam away; Robin outside");
  assert.equal(row.mention_here, true);
  assert.equal((await lab.sql`select 1 from thread_follows where message_id = ${m.id} and member_id = ${robin.id}`).length, 0);
  // An edit may take @here out, not bring anyone in.
  await ok(camille, "PATCH", `/messages/${m.id}`, { text: `hello <@${robin.id}> <!channel>` });
  const [edited] = await lab.sql`select mentions, mention_all, mention_here from messages where id = ${m.id}`;
  assert.deepEqual(edited, { mentions: [], mention_all: false, mention_here: false });
  page.close();
  away.close();
});

test("threads page their replies; reading only goes forward", async () => {
  const c = await channel(camille, "public", { members: [sam.id] });
  const root = await say(camille, c.id, "long thread");
  for (let i = 0; i < 55; i++) await say(sam, c.id, `reply ${i}`, root.id);
  const first = await ok(camille, "GET", `/threads/${root.id}`);
  assert.equal(first.replies.length, 50);
  assert.equal(first.more, true);
  assert.equal(first.replies.at(-1).text, "reply 54");
  const older = await ok(camille, "GET", `/threads/${root.id}?before=${first.replies[0].id}`);
  assert.deepEqual(older.replies.map(r => r.text), ["reply 0", "reply 1", "reply 2", "reply 3", "reply 4"]);
  assert.equal(older.more, false);
  const top = await say(sam, c.id, "top");
  await ok(camille, "PUT", `/conversations/${c.id}/read`, { message: top.id + 1000 });
  const [mine] = await lab.sql`select last_read from conversation_members where conversation_id = ${c.id} and member_id = ${camille.id}`;
  assert.equal(Number(mine.last_read), top.id, "never past the last message");
  await ok(camille, "PUT", `/conversations/${c.id}/read`, { message: root.id });
  const [still] = await lab.sql`select last_read from conversation_members where conversation_id = ${c.id} and member_id = ${camille.id}`;
  assert.equal(Number(still.last_read), top.id, "never back");
});

test("posts at once in one conversation: ids follow the order they are kept", async () => {
  const c = await channel(camille, "public", { members: [sam.id, robin.id] });
  const sent = await Promise.all(Array.from({ length: 12 }, (_, i) => say([camille, sam, robin][i % 3], c.id, `burst ${i}`)));
  const rows = await lab.sql`select id, xmin::text::bigint as tx from messages where conversation_id = ${c.id} and kind = 'message' order by id`;
  assert.equal(rows.length, 12);
  const txs = rows.map(r => Number(r.tx));
  assert.deepEqual(txs, [...txs].sort((x, y) => x - y), "a later id never commits before an earlier one");
  const [conv] = await lab.sql`select last_message_id, last_posted_id from conversations where id = ${c.id}`;
  assert.equal(Number(conv.last_message_id), Math.max(...sent.map(m => m.id)));
  const page = await ok(sam, "GET", `/conversations/${c.id}/messages`);
  assert.equal(page.messages.filter(m => m.kind === "message").length, 12);
});

test("direct messages notify every message, in the member's language, and set the badge", async () => {
  const d = await ok(robin, "POST", "/direct", { members: [hugo.id] });
  const before = lab.chest.notifications.length, badge = lab.chest.badges.get(hugo.id) ?? 0;
  await say(robin, d.id, "Tu as une minute ?");
  await settled();
  const item = lab.chest.notifications.slice(before).find(i => [i.member].includes(hugo.id));
  assert.ok(item, JSON.stringify(lab.chest.notifications.slice(before)));
  assert.equal(item.title, "Robin Lee");
  assert.equal(item.body, "Nouveau message", "Hugo reads French");
  assert.equal(lab.chest.badges.get(hugo.id), badge + 1);
  // Reading it withdraws it and clears the badge.
  const last = (await ok(hugo, "GET", `/conversations/${d.id}/messages`)).messages.at(-1);
  await ok(hugo, "PUT", `/conversations/${d.id}/read`, { message: last.id });
  await settled();
  assert.equal(lab.chest.badges.get(hugo.id), badge);
  assert.ok(!lab.chest.notifications.some(i => i.member === hugo.id && i.key === `c:${d.id}`), "the notice is withdrawn");
  const sidebar = await ok(hugo, "GET", "/sidebar");
  assert.equal(sidebar.conversations.find(c => c.id === d.id).unread, 0);
});

test("unread counts, Mark unread, and a muted conversation", async () => {
  const c = await channel(camille, "public", { members: [robin.id] });
  const first = await say(camille, c.id, "one");
  await say(camille, c.id, `two <@${robin.id}>`);
  let mine = (await ok(robin, "GET", "/sidebar")).conversations.find(x => x.id === c.id);
  assert.equal(mine.unread, 2);
  assert.equal(mine.mentions, 1);
  await ok(robin, "PUT", `/conversations/${c.id}/read`, { message: mine.lastMessageId });
  await ok(robin, "POST", `/messages/${first.id}/unread`, {});
  mine = (await ok(robin, "GET", "/sidebar")).conversations.find(x => x.id === c.id);
  assert.equal(mine.unread, 2, "back before the first");
  await ok(robin, "PUT", `/conversations/${c.id}/settings`, { notify: "none", starred: true });
  const before = lab.chest.notifications.length;
  await say(camille, c.id, `three <@${robin.id}>`);
  await settled();
  assert.ok(!lab.chest.notifications.slice(before).some(i => [i.member].includes(robin.id)), "muted: nothing");
  mine = (await ok(robin, "GET", "/sidebar")).conversations.find(x => x.id === c.id);
  assert.equal(mine.starred, true);
  assert.equal(mine.notify, "none");
});

test("threads: replies count, followers, Threads view, thread read", async () => {
  const c = await channel(camille, "public", { members: [sam.id, robin.id] });
  const root = await say(camille, c.id, "question?");
  await say(sam, c.id, "answer 1", root.id);
  const before = lab.chest.notifications.length;
  await say(robin, c.id, "answer 2", root.id);
  await settled();
  const thread = await ok(camille, "GET", `/threads/${root.id}`);
  assert.equal(thread.root.replyCount, 2);
  assert.deepEqual(thread.replies.map(r => r.text), ["answer 1", "answer 2"]);
  assert.deepEqual(thread.root.repliers, [robin.id, sam.id]);
  assert.equal(thread.following, true, "the root's author follows");
  const told = lab.chest.notifications.slice(before);
  for (const who of [camille, sam]) assert.ok(told.some(i => [i.member].includes(who.id) && i.key === `t:${root.id}`), who.name);
  assert.ok(!told.some(i => [i.member].includes(robin.id)), "not the author");
  const view = await ok(camille, "GET", "/threads");
  const mine = view.find(t => t.root.id === root.id);
  assert.equal(mine.unread, 2);
  assert.equal((await ok(camille, "GET", "/sidebar")).threadsUnread >= 1, true);
  await ok(camille, "PUT", `/threads/${root.id}/read`, { message: thread.replies.at(-1).id });
  assert.equal((await ok(camille, "GET", "/threads")).find(t => t.root.id === root.id).unread, 0);
  assert.equal((await call(camille, "POST", `/conversations/${c.id}/messages`, { text: "x", thread: thread.replies[0].id })).status, 400, "no reply to a reply");
});

test("edit and delete: the author, or an admin; a root with replies stays as deleted", async () => {
  const c = await channel(sam, "public", { members: [robin.id, camille.id] });
  const m = await say(sam, c.id, "typo");
  assert.equal((await call(robin, "PATCH", `/messages/${m.id}`, { text: "hack" })).status, 403);
  const edited = await ok(sam, "PATCH", `/messages/${m.id}`, { text: "fixed" });
  assert.equal(edited.text, "fixed");
  assert.ok(edited.editedAt);
  assert.equal((await call(robin, "DELETE", `/messages/${m.id}`)).status, 403);
  const root = await say(robin, c.id, "root");
  await say(sam, c.id, "reply", root.id);
  await ok(robin, "DELETE", `/messages/${root.id}`);
  const [kept] = await lab.sql`select body, deleted_at from messages where id = ${root.id}`;
  assert.equal(kept.body, "");
  assert.ok(kept.deleted_at);
  await ok(camille, "DELETE", `/messages/${m.id}`);
  assert.equal((await lab.sql`select 1 from messages where id = ${m.id}`).length, 0, "an admin deletes anyone's");
  // The last reply of a deleted root takes the root with it.
  const reply = (await ok(sam, "GET", `/threads/${root.id}`)).replies[0];
  await ok(sam, "DELETE", `/messages/${reply.id}`);
  assert.equal((await lab.sql`select 1 from messages where id = ${root.id}`).length, 0);
});

test("reactions: one emoji at a time, any member of the conversation", async () => {
  const c = await channel(camille, "public", { members: [sam.id] });
  const m = await say(camille, c.id, "react");
  await ok(sam, "PUT", `/messages/${m.id}/reactions`, { emoji: "👍🏽", on: true });
  await ok(sam, "PUT", `/messages/${m.id}/reactions`, { emoji: "👍🏽", on: true });
  assert.equal((await call(sam, "PUT", `/messages/${m.id}/reactions`, { emoji: "<b>", on: true })).status, 400);
  assert.equal((await call(sam, "PUT", `/messages/${m.id}/reactions`, { emoji: "👍👍", on: true })).status, 400);
  const [shown] = await ok(camille, "GET", `/messages?ids=${m.id}`);
  assert.deepEqual(shown.reactions, [{ emoji: "👍🏽", members: [sam.id] }]);
});

test("a feed carries ids and times to the channel's members, never the words", async () => {
  const c = await channel(camille, "private", { members: [sam.id] });
  const page = connect({ url: lab.chest.realtime.url(sam.id) });
  const heard = [];
  const room = page.channel(`c:${c.id}`);
  room.on("messages.insert", p => heard.push(p));
  await new Promise(resolve => room.on("joined", resolve));
  const outsider = connect({ url: lab.chest.realtime.url(robin.id) });
  const refused = await new Promise(resolve => outsider.channel(`c:${c.id}`).on("refused", resolve));
  assert.equal(refused, "forbidden", "Robin may not join");
  await say(camille, c.id, "live words");
  await waitFor(() => heard.length > 0);
  assert.deepEqual(Object.keys(heard[0]).sort(), ["author", "conversation_id", "created_at", "deleted_at", "edited_at", "id", "kind", "last_reply_at", "pinned_at", "reply_count", "thread_id"]);
  assert.ok(!JSON.stringify(heard).includes("live words"));
  // Taken out of the channel, Sam is taken out of its live channel at once.
  const kicked = new Promise(resolve => room.on("kicked", resolve));
  await ok(camille, "DELETE", `/conversations/${c.id}/members/${sam.id}`);
  await kicked;
  page.close();
  outsider.close();
});

test("groups give channels: joining, leaving the group follow at once", async () => {
  const design = groups[0];
  const c = await channel(robin, "private", { groups: [design.id] });
  const people = (await ok(robin, "GET", `/conversations/${c.id}/details`)).members;
  assert.deepEqual(people.sort(), [robin.id, camille.id, lea.id].sort());
  // Léa leaves the group: the Chest says so, she leaves the channel.
  lab.chest.members.find(m => m.id === lea.id).groups = [];
  design.members = design.members.filter(m => m !== lea.id);
  assert.equal(await lab.chest.emit({ type: "member.updated", data: { id: lea.id, changed: ["groups"] } }, lab.url), 204);
  assert.equal((await call(lea, "GET", `/conversations/${c.id}/messages`)).status, 404);
  // Someone added in person stays.
  await ok(robin, "POST", `/conversations/${c.id}/members`, { members: [lea.id] });
  assert.equal(await lab.chest.emit({ type: "member.updated", data: { id: lea.id, changed: ["groups"] } }, lab.url), 204);
  assert.equal((await call(lea, "GET", `/conversations/${c.id}/messages`)).status, 200);
});

test("files: uploaded to the Chest by the member, attached once, shown to readers only", async () => {
  const c = await channel(camille, "private", { members: [sam.id] });
  const up = await ok(camille, "POST", "/uploads", { conversation: c.id, size: 5 });
  assert.match(up.url, /^\/_chest\/files\/upload\//u, "a path of the page's own host");
  const put = await fetch(lab.url + up.url, { method: "PUT", body: "hello", headers: { "content-type": "text/plain", cookie: `member=${camille.id}` } });
  assert.equal(put.status, 201);
  const { name } = await put.json();
  assert.ok(name.startsWith(`u/${camille.id}/`));
  assert.equal((await call(sam, "POST", `/conversations/${c.id}/messages`, { text: "mine", files: [{ object: name, name: "notes.txt" }] })).status, 400, "another member's upload");
  const sent = await say(camille, c.id, "", undefined).catch(() => null);
  assert.equal(sent, null, "nothing to send");
  const withFile = await ok(camille, "POST", `/conversations/${c.id}/messages`, { text: "", files: [{ object: name, name: "Plan secret.txt" }] });
  assert.equal(withFile.files[0].name, "Plan secret.txt");
  const [row] = await lab.sql`select name from attachments where object = ${name}`;
  assert.match(row.name, /^chest:sealed:1:/u, "the file's name is sealed");
  assert.equal((await call(camille, "POST", `/conversations/${c.id}/messages`, { text: "again", files: [{ object: name, name: "x" }] })).status, 400, "attached once");
  const link = await call(sam, "GET", `/files/${withFile.files[0].id}`);
  assert.equal(link.status, 302);
  assert.match(link.headers.get("location"), /^\/_chest\/files\//u);
  assert.equal((await call(robin, "GET", `/files/${withFile.files[0].id}`)).status, 404);
});

test("search: every word, any accent, filters, and where it stopped", async () => {
  const c = await channel(hugo, "public", { members: [sam.id] });
  await say(hugo, c.id, "Le café de la réunion est prêt");
  await say(sam, c.id, "Cafe again, different words");
  const all = await ok(sam, "GET", `/search?q=${encodeURIComponent("cafe")}`);
  assert.ok(all.messages.length >= 2);
  const both = await ok(sam, "GET", `/search?q=${encodeURIComponent("CAFÉ réunion")}`);
  assert.deepEqual(both.messages.map(m => m.text), ["Le café de la réunion est prêt"]);
  const fromSam = await ok(hugo, "GET", `/search?q=${encodeURIComponent(`cafe from:@sam in:#${c.name}`)}`);
  assert.deepEqual(fromSam.messages.map(m => m.author), [sam.id]);
  assert.equal(fromSam.cursor, null, "looked through everything");
  assert.equal((await call(sam, "GET", "/search?q=")).status, 400);
});

test("writes come from the tool's own pages only", async () => {
  const c = await channel(camille, "public");
  assert.equal((await call(camille, "POST", `/conversations/${c.id}/messages`, { text: "x" }, { "sec-fetch-site": "cross-site" })).status, 403);
  const form = await fetch(lab.url + `/chest/api/conversations/${c.id}/messages`, { method: "POST", headers: { cookie: `member=${camille.id}`, "content-type": "text/plain" }, body: '{"text":"x"}' });
  assert.equal(form.status, 415);
  assert.equal((await call(camille, "POST", "/conversations", { kind: "public", name: "Bad Name!" })).status, 400);
  assert.equal((await call(camille, "POST", "/conversations", { kind: "public", name: c.name })).status, 409);
  assert.equal((await call(camille, "POST", `/conversations/${c.id}/messages`, { text: "x".repeat(40001) })).status, 413);
});

test("erasure: the person's words, files and places go; the Chest is told", async () => {
  const c = await channel(camille, "public", { members: [hugo.id] });
  const root = await say(hugo, c.id, "to be erased");
  await say(camille, c.id, "kept reply", root.id);
  const alone = await say(hugo, c.id, "alone");
  await ok(hugo, "PUT", `/messages/${root.id}/reactions`, { emoji: "🎉", on: true });
  const up = await ok(hugo, "POST", "/uploads", { conversation: c.id, size: 4 });
  assert.equal((await fetch(lab.url + up.url, { method: "PUT", body: "lost", headers: { "content-type": "text/plain", cookie: `member=${hugo.id}` } })).status, 201);
  const erasure = "era_" + "a".repeat(26);
  const status = await lab.chest.emit({ type: "member.erased", data: { id: hugo.id, erasure, deadline: new Date(Date.now() + 864e5).toISOString() } }, lab.url);
  assert.equal(status, 204);
  assert.equal((await lab.sql`select 1 from messages where id = ${alone.id}`).length, 0);
  const [kept] = await lab.sql`select body, deleted_at from messages where id = ${root.id}`;
  assert.equal(kept.body, "");
  assert.equal((await lab.sql`select 1 from reactions where member_id = ${hugo.id}`).length, 0);
  assert.equal((await lab.sql`select 1 from conversation_members where member_id = ${hugo.id}`).length, 0);
  const [after] = await lab.sql`select last_message_id from conversations where id = ${c.id}`;
  assert.equal(Number(after.last_message_id), root.id, "the conversation's last message is what remains");
  assert.ok(lab.chest.acknowledged.includes(erasure));
  assert.ok(![...lab.chest.files.keys()].some(name => name.startsWith(`u/${hugo.id}/`)), "their uploads, sent or not, are gone");
});

async function presence() {
  const realtime = await import("@argentic/chest-sdk/realtime");
  return (await realtime.presence("everyone")).members.filter(m => m.state.away === false).map(m => m.id);
}
async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise(r => setTimeout(r, 20));
  }
}
