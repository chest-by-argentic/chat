# Working on Chat — a guide for coding agents

`README.md` says what Chat is and how it works; read it first. Chat is a
Chest server tool: `@argentic/chest-sdk` (its `AGENTS.md`) is the
contract it is written against.

- **One source per rule**: bounds and shared rules in `src/shared/rules.ts`,
  every word in `src/shared/i18n/en.ts` (French typed against it), the
  markdown reader in `src/shared/markdown.ts`, routes in
  `src/shared/route.ts`.
- **Security**: every API route reads its inputs through
  `src/server/problem.ts`; every read goes through `access` (or the
  `readable` condition), every write through `writable`; a member's text
  is sealed with its row's context (`src/server/sealing.ts`) and is never
  logged nor sent live. Notices carry a preview (`src/server/preview.ts`)
  except in a confidential channel.
- **Live**: the page takes feed and lifecycle events only without a sender
  (`src/ui/store.ts`, `follow`); members' sends carry `typing` only.
- **No inline style or script**: the page's policy forbids them; use
  classes, or set sizes through the CSSOM in an effect.
- **Migrations** only add: a migration that ran is never changed.
- **Checks before a change is proposed**: `npm test`, `npm run
  test:browser` (Docker for PostgreSQL, Playwright's Chromium) and `npx
  chest check`.
- **The SDK** in `vendor/` is packed from its own repository, never edited
  here.
- English in code, comments and commits; the interface speaks English
  first, French second.
