// The dev server of the preview (npm run dev): vite rebuilds the browser's
// files and the server's on every change, and node runs the server again
// when its build changes. One command, no shell.
import { spawn } from "node:child_process";
import { build } from "vite";

const watching = (ssr) => new Promise((resolve, reject) => {
  build({ mode: "development", build: { ssr, watch: {} }, logLevel: "warn" }).then((watcher) => {
    watcher.on("event", (event) => {
      if (event.code === "END") resolve();
      if (event.code === "ERROR") { console.error(event.error?.message ?? event.error); resolve(); }
    });
  }, reject);
});

await watching(false);
await watching(true);
const server = spawn(process.execPath, ["--watch-path=dist/server", "dist/server/main.js"], { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { server.kill(signal); process.exit(0); });
server.on("exit", (code) => process.exit(code ?? 1));
