// The local Chest of the tool's tests: a real PostgreSQL (a disposable
// container), the SDK's fake Chest (members, groups, files, notifications,
// sealing, realtime), the Chest's realtime triggers installed on the
// tables chest.json names — the same plpgsql the Chest
// installs —, and a front that plays the Chest's:
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
import * as realtime from "@argentic/chest-sdk/realtime";
import { fakeChest, withMember } from "@argentic/chest-sdk/testing";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(root, "chest.json"), "utf8"));
const image = "postgres:17";

// The Chest's trigger function, as the Chest installs it in a tool's database.
const realtimeFunction = `CREATE OR REPLACE FUNCTION chest_realtime.notify() RETURNS trigger LANGUAGE plpgsql AS $chest$
DECLARE
  rec jsonb; prior jsonb; payload jsonb; suffix text := '';
BEGIN
  IF TG_ARGV[0] = 'm' THEN
    prior := to_jsonb(OLD);
    IF TG_OP = 'UPDATE' THEN
      rec := to_jsonb(NEW);
      IF rec->TG_ARGV[1] IS NOT DISTINCT FROM prior->TG_ARGV[1] AND rec->TG_ARGV[2] IS NOT DISTINCT FROM prior->TG_ARGV[2] THEN RETURN NULL; END IF;
    END IF;
    IF prior->>TG_ARGV[1] IS NOT NULL AND prior->>TG_ARGV[2] IS NOT NULL THEN
      PERFORM pg_notify('chest_realtime', jsonb_build_object('k', 'm', 't', TG_TABLE_NAME, 'key', prior->>TG_ARGV[1], 'm', prior->>TG_ARGV[2])::text);
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN rec := to_jsonb(OLD); ELSE rec := to_jsonb(NEW); END IF;
  IF TG_ARGV[2] <> '' THEN
    suffix := rec->>TG_ARGV[2];
    IF suffix IS NULL THEN RETURN NULL; END IF;
  END IF;
  payload := jsonb_build_object('k', 'f', 'c', TG_ARGV[1] || suffix, 'e', TG_TABLE_NAME || '.' || lower(TG_OP),
    'r', (SELECT coalesce(jsonb_object_agg(col, rec->col), '{}'::jsonb) FROM unnest(TG_ARGV[3:TG_NARGS - 1]) AS col));
  IF octet_length(payload::text) > 7000 THEN
    payload := payload || jsonb_build_object('r', jsonb_build_object(TG_ARGV[3], rec->TG_ARGV[3]), 'p', true);
  END IF;
  PERFORM pg_notify('chest_realtime', payload::text);
  RETURN NULL;
END
$chest$`;

const lit = s => `'${s}'`;
function realtimeStatements(rules) {
  const out = ["CREATE SCHEMA IF NOT EXISTS chest_realtime", realtimeFunction];
  rules.feeds.forEach((f, i) => {
    const at = f.channel.lastIndexOf(":");
    const last = f.channel.slice(at + 1);
    const [prefix, column] = /^\{[a-z_][a-z0-9_]*\}$/u.test(last) ? [f.channel.slice(0, at + 1), last.slice(1, -1)] : [f.channel, ""];
    out.push(`CREATE TRIGGER chest_realtime_f${i} AFTER INSERT OR UPDATE OR DELETE ON ${f.table} FOR EACH ROW EXECUTE FUNCTION chest_realtime.notify('f', ${lit(prefix)}, ${lit(column)}, ${f.columns.map(lit).join(", ")})`);
  });
  const seen = new Set();
  for (const c of rules.channels) {
    if (!c.join || Array.isArray(c.join) || seen.has(c.join.table)) continue;
    seen.add(c.join.table);
    out.push(`CREATE TRIGGER chest_realtime_m${seen.size - 1} AFTER UPDATE OR DELETE ON ${c.join.table} FOR EACH ROW EXECUTE FUNCTION chest_realtime.notify('m', ${lit(c.join.key)}, ${lit(c.join.member)})`);
    // The harness's own: which rows exist, for the fake Chest's join checks
    // (the Chest asks the database; the fake asks a function).
    out.push(`CREATE OR REPLACE FUNCTION chest_realtime.harness_rows() RETURNS trigger LANGUAGE plpgsql AS $local$ BEGIN
      PERFORM pg_notify('harness_rows', jsonb_build_object('op', TG_OP, 'new', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END, 'old', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END)::text);
      RETURN NULL; END $local$`);
    out.push(`CREATE TRIGGER harness_rows AFTER INSERT OR UPDATE OR DELETE ON ${c.join.table} FOR EACH ROW EXECUTE FUNCTION chest_realtime.harness_rows()`);
  }
  return out;
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
  for (const statement of realtimeStatements(manifest.realtime)) await sql.unsafe(statement);
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
  const listener = postgres(db.url, { max: 1, onnotice: () => {} });
  await listener.listen("harness_rows", text => {
    const n = JSON.parse(text);
    if (n.old) rows.delete(`${n.old.conversation_id}:${n.old.member_id}`);
    if (n.new) rows.add(`${n.new.conversation_id}:${n.new.member_id}`);
  });
  // What the Chest's triggers say goes to the fake Chest's hub: a row
  // removed from a membership table, a feed's row on the channel the
  // trigger named (the fake's own commit() would read the channel from the
  // carried columns, which need not hold it).
  await listener.listen("chest_realtime", text => {
    const n = JSON.parse(text);
    if (n.k === "m") fake.realtime.removed(n.t, n.key, n.m);
    else realtime.publish(n.c, n.e, n.r).catch(() => { /* at most once, as the Chest */ });
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
