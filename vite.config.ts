import { readFileSync } from "node:fs";
import { defineConfig, type BuildEnvironmentOptions, type Plugin } from "vite";

// Two builds of one source: the browser's (src/client/main.tsx — the
// island and the styles) into dist/client/assets under fixed names, with
// the tool's icon (chest/icon.svg, the one the Chest shows) as the page's;
// and the server's (vite build --ssr) into dist/server, its packages left
// in node_modules.
const icon: Plugin = {
  name: "icon",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "assets/icon.svg", source: readFileSync("chest/icon.svg") });
  },
};
const browser: BuildEnvironmentOptions = {
  outDir: "dist/client",
  emptyOutDir: true,
  rolldownOptions: {
    input: { client: "src/client/main.tsx" },
    output: { entryFileNames: "assets/[name].js", chunkFileNames: "assets/[name].js", assetFileNames: (asset) => (asset.names[0]?.endsWith(".css") ? "assets/client.css" : "assets/[name][extname]") },
  },
};
// The tests' build (--mode test) adds the shared parts the unit tests call.
// Minified: the server holds less source in memory.
const server = (test: boolean): BuildEnvironmentOptions => ({
  outDir: "dist/server",
  emptyOutDir: true,
  ssr: true,
  minify: !test,
  rolldownOptions: { input: { main: "src/server/main.tsx", app: "src/server/app.tsx", ...(test ? { units: "test/units.ts" } : {}) }, output: { entryFileNames: "[name].js" } },
});

export default defineConfig(({ isSsrBuild, mode }) => ({ oxc: { jsx: { runtime: "automatic" } }, build: isSsrBuild ? server(mode === "test") : browser, plugins: isSsrBuild ? [] : [icon] }));
