import { renderToString } from "react-dom/server";
import type { Initial } from "../shared/types.js";
import { Island } from "../ui/islands.js";

// A whole page rendered on the server: the browser's stylesheet and script
// (built by vite into dist/client/assets), and Chat itself, which the
// script hydrates with what it was rendered with.
export function document(head: { title: string; language: string; nonce: string }, initial: Initial): string {
  return "<!doctype html>" + renderToString(
    <html lang={head.language}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="color-scheme" content="light dark" />
        <title>{head.title}</title>
        <link rel="icon" href="/assets/icon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/assets/client.css" />
        <script type="module" src="/assets/client.js" nonce={head.nonce} />
      </head>
      <body>
        <Island name="Chat" props={{ initial }} />
      </body>
    </html>,
  );
}
