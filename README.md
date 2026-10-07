# Chat

The team's messaging tool of the Argentic store: channels (public,
private, given to groups), direct messages, threads, mentions, reactions,
files, pins, saved items, drafts on every device, search, live on every
page — and every member's words sealed by the Chest.

What it is and why is decided in the product spec,
[`01_produit/02_specs/store-chat.md`](../../../01_produit/02_specs/store-chat.md)
(company folder). This page says how the code does it.

## How it is made

The Chest's starter stack (Perseus): TypeScript, a Hono server that renders
React on the server, one island hydrated in the browser, Vite for both
builds; tool contract 0.5, the SDK as the packed tarball in `vendor/`.

| Path | What it is |
|---|---|
| `chest.json` | The manifest: capabilities (`database`, `files`, `members`, `members.groups`, `notifications`, `realtime`, `sealed`), files quota, `receives: member.*`, the nightly `tidy`, the realtime channels and feeds |
| `migrations/0001_chat.sql` | The data model (below) |
| `src/server/app.tsx` | Pages (`/chest/*`, rendered whole with the route open), the policy (a nonce per answer), `/chest-events`, `/chest-schedules`, `/assets/` |
| `src/server/api.ts` | The JSON API under `/chest/api`: inputs read at the boundary, writes only from the tool's own pages |
| `src/server/conversations.ts` | Conversations, who is in them and what each may do (`access`), groups as audiences (`reconcile`), reads |
| `src/server/messages.ts` | Messages, threads, reactions, pins, saved, drafts, files |
| `src/server/counts.ts` | Unread and mention counts, badges |
| `src/server/notify.ts` | After a post: live hints, notices for those away, badges |
| `src/server/search.ts` | Search on sealed messages (open and scan) |
| `src/server/sealing.ts` | Sealing contexts; opening in chunks under the Chest's call bound |
| `src/server/live.ts` | Direct realtime events; who is active |
| `src/server/chest-calls.ts` | Member events (groups changed, erasure) and the nightly tidy |
| `src/shared/` | What both sides use: the markdown reader, rules and bounds, routes, times, types, the words (`i18n/en.ts` the source, `fr.ts`), emoji |
| `src/ui/` | The page: `store.ts` (state, actions, live events), `Chat.tsx` and its panes |
| `src/client/` | The browser's entry (hydration) and the stylesheet |
| `test/` | Unit tests (`units.test.mjs`), the API against PostgreSQL and the fake Chest (`api.test.mjs`), the browser test (`browser/`), the local Chest of the tests (`lab/`) |
| `vendor/chest-sdk-0.5.0.tgz` | The SDK (never edited here). Today packed from Chest-SDK `main` (sealed values) merged locally with the realtime branch (PR #30, not merged yet); once realtime is on `main`, the Chest repository's `npm run sync:sdk` repacks it from there |

## Data

Member and group ids only (`mbr_…`, `grp_…`), names asked of the Chest
when shown. Every text a member writes is sealed, bound to its row:

| Table | Holds | Sealed (context) |
|---|---|---|
| `conversations` | kind, name (channels), the default channel, archive, last message | `about` (`about:<id>`) |
| `conversation_members` | the realtime membership table of `c:{id}`; per member: added in person or by a group, last read, notification level, star | — |
| `conversation_groups`, `conversation_leaves` | groups given a channel; who left one a group gives them | — |
| `messages` | author, kind (a message, or a line of the tool), thread, mentions (members of the conversation only), `@channel` / `@here`, times, pin, reply count and repliers | `body` (`m:<id>`: the id is taken and the body sealed first; the write then checks, under the conversation's lock, that no later id was written, else takes a new one — ids follow commit order) |
| `reactions`, `saved`, `thread_follows` | as named | — |
| `attachments` | the Chest's object (`u/<member>/<random>`), type, size, image size | `name` (`f:<object>`) |
| `drafts` | per member, conversation and thread | `body` (`d:<member>:<conversation>:<thread>`) |
| `people`, `handled` | first visit and last conversation; deliveries handled | — |

## Live

- `everyone` (presence): each page tracks `{away}` from its visibility;
  the server reads it to notify only those not looking.
- `c:{id}`, joined only for the conversation shown; membership table
  `conversation_members`. Feeds of `messages` and `reactions` carry ids,
  authors and times, never a body; the page fetches what it is told of
  (`GET /chest/api/messages?ids=`), opened for its member. Members' sends
  carry only `typing`: the page takes feed events only from the Chest
  (no sender), since a member could send an event of any name.
- Direct events (`realtime.send`): `activity` to the conversation's
  members, `thread` to a thread's followers, `read` to the reader's other
  pages, `conversations` when someone's list changes. A page that missed
  some (a reconnect without replay) loads again what it shows.

## Commands

- `npm run build` — types, the browser's files, the server.
- `npm test` — types, builds, then unit and API tests against a disposable
  PostgreSQL (Docker, `postgres:17`) and the SDK's fake Chest.
- `npm run test:browser` — after `npm test`: two members live in Chromium,
  desktop and phone, light and dark, English and French, axe on every
  screen. `CHAT_SCREENS=<dir>` keeps the screenshots.
- `npm run preview` — the tool on the local Chest of the tests with a team
  and their conversations; sign in as someone with `/__as/<member id>`.
- `npm run memory` — the server's memory at rest, during a burst of pages
  and messages, and after; `node test/lab/memory.mjs <another tool>`
  measures another tool the same way.
- `npm run dev` — the Perseus workbench's preview (Vite rebuilds, the
  server restarts).
- `npx chest check` — from a clone of the SDK (`check/`): the Chest's
  verdict on the repository.

## Memory

Measured on a Mac (Node 22, `npm run memory`, resident size three seconds
after start): **Chat 76.8–81.8 MiB at rest (median 79.0 over six runs),
the Perseus starter 76.2–80.1 MiB (median 77.5)**: about 1.5 MiB more at
the median, within the 2–5 MiB spread between two runs of the same
server. The tool's own code, the PostgreSQL client and the SDK's modules
add about 4 MiB once loaded; `hono/tiny` and a minified server take back
about 2.5 of them. After a burst of
pages macOS keeps the high-water mark (130 MiB after 30 pages, the starter
82): the heap itself falls back to 14 MiB after a collection; the first
time formatted in a member's zone maps about 8 MiB of the runtime's time
zone data. Linux, where the Chest runs, gives freed pages back; a
measurement there is to do on the lab VM.

## Rules of this code

- No inline style or script: the policy has a nonce for the tool's own
  files only; sizes are CSS, or CSSOM set by a script.
- Every word in `src/shared/i18n/en.ts`, French typed against it.
- Member text is rendered from the parsed tree (`src/shared/markdown.ts`),
  never as HTML; links are `http`, `https` and `mailto` only.
- Server checks for every read and write: `access` and `writable`, the
  `readable` condition in lists, the uploads' own folder.
