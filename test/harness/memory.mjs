// The server's memory, as the Chest would see it: the resident size of the
// built server (npm run build) at rest — started, nobody asking —, during
// a burst of members' pages and messages, and once quiet again. The same
// script measures another tool built the same way (the Perseus starter):
//
//   node test/harness/memory.mjs [tool directory] [requests]
//
// Prints one line per moment, in MiB.
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { fakeChest, withMember } from "@argentic/chest-sdk/testing";
import { database } from "./chest.mjs";
import { members, groups } from "./people.mjs";

const dir = resolve(process.argv[2] ?? ".");
const requests = Number(process.argv[3] ?? 300);
const port = 3900 + Math.floor(Math.random() * 90);
const db = await database();
const chest = await fakeChest({ members, groups, capabilities: ["database", "files", "members", "members.groups", "notifications", "realtime", "sealed"], chest: { organization: "Acme SAS" } });
const server = spawn(process.execPath, ["dist/server/main.js"], { cwd: dir, env: { ...process.env, PORT: String(port), DATABASE_URL: db.url }, stdio: "ignore" });
const rss = () => Number(execFileSync("ps", ["-o", "rss=", "-p", String(server.pid)], { encoding: "utf8" }).trim()) / 1024;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ask = (member, path, init = {}) => fetch(withMember(new Request(`http://127.0.0.1:${port}${path}`, init), member));

try {
  for (let i = 0; ; i++) {
    try { await fetch(`http://127.0.0.1:${port}/assets/client.css`); break; } catch { if (i > 100) throw new Error("the server did not start"); await sleep(100); }
  }
  await sleep(3000);
  const rest = rss();
  let peak = rest;
  const chat = (await ask(members[0], "/chest")).headers.get("content-type")?.includes("html") && (await ask(members[0], "/chest/api/sidebar")).ok;
  for (let i = 0; i < requests; i++) {
    const m = members[i % members.length];
    const page = await ask(m, "/chest");
    await page.arrayBuffer();
    if (chat && i % 3 === 0) {
      const sidebar = await (await ask(m, "/chest/api/sidebar")).json();
      const general = sidebar.conversations.find(c => c.name === "general");
      await (await ask(m, `/chest/api/conversations/${general.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Message ${i} with some words to seal and open again` }) })).arrayBuffer();
    }
    if (i % 25 === 0) peak = Math.max(peak, rss());
  }
  peak = Math.max(peak, rss());
  await sleep(10000);
  const after = rss();
  console.log(`${dir.split("/").pop()}: at rest ${rest.toFixed(1)} MiB · peak during ${requests} pages ${peak.toFixed(1)} MiB · quiet 10 s after ${after.toFixed(1)} MiB`);
} finally {
  server.kill("SIGTERM");
  await chest.close();
  await db.sql.end({ timeout: 1 });
  db.stop();
}
