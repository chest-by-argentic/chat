import { serve } from "@hono/node-server";
import { app, closeDb, settled } from "./app.js";

// The Chest sets PORT; it relays its requests there. On SIGTERM (the Chest
// stops or puts the tool to sleep) the server stops taking requests,
// finishes what follows the last ones, and closes the database.
const server = serve({ fetch: app.fetch, port: Number(process.env["PORT"] ?? 3000), hostname: "127.0.0.1" });
process.on("SIGTERM", () => server.close(async () => {
  await settled();
  await closeDb();
}));
