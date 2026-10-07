// The local Chest of the tool's tests: a real PostgreSQL (a disposable
// container), the SDK's fake Chest (members, groups, files, notifications,
// sealing, realtime), triggers that tell it each row committed to the
// tables chest.json names, as the Chest's own do, and a front that plays
// the Chest's:
// it asserts the member of a cookie on every request, relays the page's
// live connection and the file links and uploads to the fake Chest.
//
//   const local = await startChest({ members, groups });
//   await page.goto(local.url + "/__as/" + camille.id);   // signed in as Camille
//   ...
//   await local.close();
//
// Never against a real Chest or server: a container on 127.0.0.1 and
// processes of the test only.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { fakeChest, withMember } from "@argentic/chest-sdk/testing";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(root, "chest.json"), "utf8"));
const image = "postgres:17";

// The harness's triggers: each committed row of a table chest.json names
// — a feed's or a membership table's — told whole (sealed bodies left out —
// a notice carries 8 KB at most) at commit, for the fake Chest to play the
// Chest's own triggers (commit, removed) and to answer joins.
const tables = rules => [...new Set([...rules.feeds.map(f => f.table), ...rules.channels.filter(c => c.join && !Array.isArray(c.join)).map(c => c.join.table)])];
function harnessStatements(rules) {
  return [
    "CREATE SCHEMA IF NOT EXISTS chest_harness",
    `CREATE OR REPLACE FUNCTION chest_harness.notify() RETURNS trigger LANGUAGE plpgsql AS $harness$ BEGIN
      PERFORM pg_notify('chest_harness', jsonb_build_object('t', TG_TABLE_NAME, 'op', lower(TG_OP),
        'new', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) - 'body' END,
        'old', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) - 'body' END)::text);
      RETURN NULL; END $harness$`,
    ...tables(rules).map(t => `CREATE TRIGGER chest_harness AFTER INSERT OR UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION chest_harness.notify()`),
  ];
}

// database starts a disposable PostgreSQL, plays the migrations as the Chest
// does, and installs the realtime triggers: its address and how to stop it.
export async function database() {
  const password = randomBytes(12).toString("hex");
  const name = `chat-local-${randomBytes(4).toString("hex")}`;
  execFileSync("docker", ["run", "--rm", "-d", "--name", name, "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=t_chat", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=t_chat", image, "-c", "fsync=off"], { stdio: "ignore" });
  const port = execFileSync("docker", ["port", name, "5432/tcp"], { encoding: "utf8" }).trim().split(":").pop();
  const url = `postgres://t_chat:${password}@127.0.0.1:${port}/t_chat?sslmode=disable`;
  const stop = () => {
    process.off("exit", stop);
    try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch { /* gone already */ }
  };
  // A test that dies leaves no container behind.
  process.on("exit", stop);
  let sql;
  for (let i = 0; ; i++) {
    try {
      sql = postgres(url, { max: 1, onnotice: () => {} });
      await sql`select 1`;
      break;
    } catch (error) {
      await sql?.end({ timeout: 1 });
      if (i > 100) { stop(); throw error; }
      await new Promise(r => setTimeout(r, 200));
    }
  }
  const dir = join(root, "migrations");
  for (const file of readdirSync(dir).filter(f => /^\d{4}_.+\.sql$/u.test(f)).sort()) {
    await sql.begin(tx => tx.unsafe(readFileSync(join(dir, file), "utf8")));
  }
  for (const statement of harnessStatements(manifest.realtime)) await sql.unsafe(statement);
  return { url, sql, stop };
}

// startChest starts the database, the fake Chest and the tool behind a
// front; it sets the environment the tool reads, as the Chest does.
export async function startChest({ members, groups = [], chest = {} } = {}) {
  const db = await database();
  process.env["DATABASE_URL"] = db.url;
  const rows = new Set((await db.sql`select conversation_id, member_id from conversation_members`).map(r => `${r.conversation_id}:${r.member_id}`));
  const fake = await fakeChest({
    members, groups,
    capabilities: manifest.capabilities,
    receives: manifest.receives,
    realtime: { channels: manifest.realtime.channels, feeds: manifest.realtime.feeds, membership: (table, key, member) => rows.has(`${key}:${member}`) },
    chest: { organization: "Acme SAS", timeZone: "Europe/Paris", language: "en", ...chest },
  });
  // Rows committed: a membership row gone (or moved) takes its member out,
  // a feed's row goes to the fake Chest as the Chest's triggers tell it.
  const membership = manifest.realtime.channels.find(c => c.join && !Array.isArray(c.join))?.join;
  const feeds = new Set(manifest.realtime.feeds.map(f => f.table));
  const listener = postgres(db.url, { max: 1, onnotice: () => {} });
  await listener.listen("chest_harness", text => {
    const n = JSON.parse(text);
    if (membership && n.t === membership.table) {
      const key = r => `${r[membership.key]}:${r[membership.member]}`;
      if (n.old && (!n.new || key(n.old) !== key(n.new))) {
        rows.delete(key(n.old));
        fake.realtime.removed(n.t, String(n.old[membership.key]), n.old[membership.member]);
      }
      if (n.new) rows.add(key(n.new));
    }
    if (feeds.has(n.t)) fake.realtime.commit(n.t, n.op, n.new ?? n.old);
  });

  const { app, settled, closeDb } = await import(join(root, "dist", "test", "app.js"));
  const memberOf = req => {
    const id = /(?:^|;\s*)member=(mbr_[a-z2-7]{26})/u.exec(req.headers.cookie ?? "")?.[1];
    return fake.members.find(m => m.id === id) ?? null;
  };
  const chestOrigin = new URL(fake.api);
  const front = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local.test");
      const as = /^\/__as\/(mbr_[a-z2-7]{26})$/u.exec(url.pathname);
      if (as) {
        res.writeHead(302, { "Set-Cookie": `member=${as[1]}; Path=/; HttpOnly; SameSite=Lax`, Location: "/chest" + (url.searchParams.get("to") ?? "") });
        return res.end();
      }
      const who = memberOf(req);
      if (url.pathname.startsWith("/_chest/")) {
        if (url.pathname === "/_chest/realtime") url.searchParams.set("member", who?.id ?? "");
        const relay = httpRequest({ host: chestOrigin.hostname, port: chestOrigin.port, method: req.method, path: url.pathname + url.search, headers: { ...req.headers, host: chestOrigin.host } }, answer => {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        });
        relay.on("error", () => { res.writeHead(502); res.end(); });
        return req.pipe(relay);
      }
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await new Promise(resolve => {
        const chunks = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
      });
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      let request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body });
      if (who) request = withMember(request, who);
      const answer = await app.fetch(request);
      const out = {};
      answer.headers.forEach((v, k) => { out[k] = v; });
      res.writeHead(answer.status, out);
      res.end(Buffer.from(await answer.arrayBuffer()));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  // The page's live connection goes to the fake Chest's hub, as the member.
  front.on("upgrade", (req, socket, head) => {
    const who = memberOf(req);
    const url = new URL(req.url, "http://local.test");
    if (url.pathname !== "/_chest/realtime" || !who) return socket.destroy();
    const upstream = netConnect(Number(chestOrigin.port), chestOrigin.hostname, () => {
      const lines = [`GET /_chest/realtime?member=${who.id} HTTP/1.1`, `Host: ${chestOrigin.host}`];
      for (const [k, v] of Object.entries(req.headers)) if (k !== "host") lines.push(`${k}: ${v}`);
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  await new Promise(resolve => front.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${front.address().port}`;
  return {
    url, chest: fake, sql: db.sql,
    async close() {
      front.closeAllConnections();
      await new Promise(resolve => front.close(resolve));
      await settled();
      await closeDb();
      await listener.end({ timeout: 1 });
      await db.sql.end({ timeout: 1 });
      await fake.close();
      db.stop();
    },
  };
}
