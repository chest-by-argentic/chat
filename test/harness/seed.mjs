// A Chat as a team uses it, written through the tool's own API as each
// member: channels, a private one, a thread, reactions, a direct
// conversation. For the browser test's screens and the preview.
import { camille, groups, hugo, lea, robin, sam } from "./people.mjs";

// as calls the tool's API on the local's front as a member.
export function as(local, member) {
  return async (method, path, body = method === "POST" ? {} : undefined) => {
    const response = await fetch(local.url + "/chest/api" + path, {
      method,
      headers: { cookie: `member=${member.id}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
    return text ? JSON.parse(text) : undefined;
  };
}

// visit opens the tool's page as a member, as their browser would.
export async function visit(local, member, path = "/chest") {
  const response = await fetch(local.url + path, { headers: { cookie: `member=${member.id}` } });
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.text();
}

export async function seed(local) {
  const c = as(local, camille), s = as(local, sam), r = as(local, robin), l = as(local, lea), h = as(local, hugo);
  // Everyone opens Chat once: the default channel takes them in.
  for (const m of [camille, sam, robin, lea, hugo]) await visit(local, m);
  const general = (await c("GET", "/sidebar")).conversations.find(x => x.name === "general");
  const say = (call, conversation, text, thread) => call("POST", `/conversations/${conversation}/messages`, { text, ...(thread ? { thread } : {}) });

  const design = await c("POST", "/conversations", { kind: "public", name: "design", about: "Brand, product screens and the *new* Chest identity.", members: [sam.id, robin.id], groups: [groups[0].id] });
  const board = await c("POST", "/conversations", { kind: "private", name: "board", about: "Decisions before they are announced.", members: [sam.id] });
  await s("POST", "/conversations", { kind: "public", name: "sales", members: [], groups: [groups[1].id] });
  await r("POST", `/conversations/${design.id}/join`);

  await say(c, general.id, "Welcome to Chat, everyone 👋 Messages here are sealed: only people who can read a conversation ever see its words.");
  await say(s, general.id, "Great. Lunch at the usual place on Friday?");
  await say(h, general.id, "Partant 🍕");
  const kickoff = await say(c, design.id, "The new tiles are in. Three questions before Thursday's review:\n- the icon grid (24 or 32?)\n- dark mode contrast\n- the `pill` for counts");
  await say(r, design.id, "Grid at 24, it matches the sidebar rows.", kickoff.id);
  await say(l, design.id, `Contrast checked with <@${camille.id}>: every pair passes 4.5:1 ✅`, kickoff.id);
  await say(c, design.id, "Perfect. I'll update the guidelines tonight.", kickoff.id);
  await c("PUT", `/messages/${kickoff.id}/reactions`, { emoji: "👍", on: true });
  await s("PUT", `/messages/${kickoff.id}/reactions`, { emoji: "👍", on: true });
  await r("PUT", `/messages/${kickoff.id}/reactions`, { emoji: "🎉", on: true });
  await say(s, design.id, `> the \`pill\` for counts\nBlack on white, square, *no* colour. <@${camille.id}> can you share the PDF?`);
  await say(r, design.id, "Here is the review agenda: https://example.com/review — ten minutes each.");
  await say(c, board.id, "Q4 budget draft is ready for review.");
  const dm = await s("POST", "/direct", { members: [camille.id] });
  await say(s, dm.id, "Do you have five minutes after the review?");
  await say(c, dm.id, "Yes, 16:00 works.");
  await say(s, dm.id, "Thanks! Sending the numbers now 📊");
  return { general, design, board, dm, kickoff };
}
