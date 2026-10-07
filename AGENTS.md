# Working on Chat

Read `README.md` (how it is made) and the product spec it links
(`01_produit/02_specs/store-chat.md` in the company folder): a change of
behaviour is decided there first.

- **One source per rule**: bounds and shared rules in `src/shared/rules.ts`,
  words in `src/shared/i18n/en.ts` (French follows, typed), the markdown
  reader in `src/shared/markdown.ts`, routes in `src/shared/route.ts`.
- **Security**: every API route reads its inputs with `src/server/problem.ts`;
  every read goes through `access` (or the `readable` condition), every
  write through `writable`; a member's text is sealed with its row's
  context (`src/server/sealing.ts`) and never logged, notified or sent
  live.
- **Live**: feed and lifecycle events are taken only without a sender
  (`src/ui/store.ts`, `follow`); members' sends carry `typing` only.
- **No inline style**: the page's policy forbids it; use classes, or set a
  size through the CSSOM in an effect.
- **Checks before a commit**: `npm test`, then `npm run test:browser`
  (Docker for PostgreSQL, Playwright's Chromium), and `npx chest check`
  from a clone of the SDK.
- **The SDK** is `vendor/chest-sdk-0.5.0.tgz`, never edited here; a new one
  is packed from the SDK's repository.
- English in code, comments, commits; the product speaks English first,
  French second.
