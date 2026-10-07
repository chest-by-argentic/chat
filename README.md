# Chat

Team messaging for a Chest by Argentic: channels,
direct messages and threads, live on every open page, with every message
sealed by the Chest.

- **Channels** — public ones anyone on the team can find and join, private
  ones by invitation, and channels given to a group of the Chest (its
  members come and go with the group). A default `#general` everyone joins.
- **Direct messages** for one to nine people (alone, it is your notes).
- **Threads**, **mentions** (`@someone`, `@channel`, `@here`),
  **reactions**, **pins**, **saved** messages, **drafts** that follow you
  from one device to another, **Mark unread**.
- **Files and images**, sent by the browser straight to the Chest, shown
  as thumbnails.
- **Search** across everything you may read, with filters (`in:#channel`,
  `from:@name`, `has:file`, `is:thread`, `before:`, `after:`).
- **Live**: new messages, edits, reactions, who is typing, who is active —
  through the Chest's realtime service, so the tool itself can sleep while
  nobody writes.
- **Notifications** in the Chest's bell, by push and by mail, as each
  member chooses there: per conversation *All new messages*, *Mentions* or
  *Nothing*; only when you are not looking at Chat; withdrawn once read.
  **Badges** count unread direct messages and mentions.
- **Keyboard** (`⌘/Ctrl K` to jump anywhere, `⌘/Ctrl /` for the list),
  **phone** layout, **light and dark**, **English and French**,
  accessible (WCAG 2.1 AA checked with axe).

## What is sealed

The Chest seals with the tool's key, and opens only for a member who may
read it, every text a member writes: **messages, file names, drafts and
channel descriptions**. The Chest's database console, its agents, backups
and Perseus see `Sealed`; the Chest's admins see no message they could not
read in Chat itself.

Not sealed, because lists, access and notifications need them: channel
names, who is in which conversation, who wrote when, mentions and
reactions. **Files' bytes** are not sealed yet (the Chest does not seal
files): the Chest's storage view shows them to its owner and admins.

**Notifications show the first words of a message** (about 120
characters, plain text). Those words leave the seal: the Chest keeps them
in its notifications and may mail them; push is encrypted end to end. A
channel marked **Confidential** (in its details, by its creator or the
Chest's admins) keeps its notifications to who wrote and where.

## Install it on a Chest

Chat needs a Chest that serves tool contract **0.5** (realtime and sealed
values). In the Chest, **Tools → Add a tool**, from the catalogue or from
this repository; the owner or an admin approves what it asks:

| Permission | Why |
|---|---|
| `database` | Conversations, messages (sealed), reads, reactions |
| `sealed` | Every member's words sealed; each new version waits for the owner's or an admin's approval |
| `files` (10 GiB, 100 MiB a file) | Attachments, sent by the browser to the Chest |
| `members`, `members.groups` | Names and photos; groups as channel audiences |
| `notifications` | The bell, push and mail notices, badges |
| `realtime` | Live pages; the tool sleeps meanwhile |
| `receives: member.*` | A member's groups changed; erasure of a person's data |
| schedule `tidy`, nightly | Removes files uploaded and never sent |

No network access, no public part.

## Develop

Node 22 or later. The stack: TypeScript, a [Hono](https://hono.dev)
server rendering React on the server, one island hydrated in the browser,
[Vite](https://vite.dev) for both builds, PostgreSQL through
[postgres](https://github.com/porsager/postgres), and
[`@argentic/chest-sdk`](https://github.com/chest-by-argentic/Chest-SDK)
as the packed tarball in `vendor/`.

```sh
npm ci
npm run build          # types, the browser's files, the server
npm run preview        # Chat on a local Chest with a team and their conversations
```

`npm run preview` needs Docker (a disposable PostgreSQL); it prints an
address and one link per member of its team: open one to use Chat as that
person, another in a second browser to talk to yourself.

| Path | What it is |
|---|---|
| `chest.json` | The manifest: permissions, files, events, the nightly schedule, realtime channels and feeds |
| `migrations/` | The database, played by the Chest in order |
| `src/server/` | Pages and the JSON API under `/chest`, sealing, live events, notifications, search, the Chest's events and schedule |
| `src/shared/` | What the server and the page share: the markdown reader, rules, routes, times, types, the words (`i18n/en.ts`, `fr.ts`), emoji |
| `src/ui/` | The page: `store.ts` (state, actions, live events) and its panes |
| `src/client/` | The browser's entry and the stylesheet |
| `test/` | Unit, API and browser tests; `harness/` is the local Chest they run against |
| `vendor/` | The SDK, packed; never edited here |

### How it works

- **Data.** Member and group ids only (`mbr_…`, `grp_…`); names are asked
  of the Chest when shown. A sealed value is bound to its row (a message
  to `m:<id>`, a file name to `f:<object>`, a draft to
  `d:<member>:<conversation>:<thread>`): copied elsewhere, it opens
  nowhere. A message's id is taken and its body sealed before its
  transaction, which checks under the conversation's lock that no later id
  was written (else it takes a new one): ids follow commit order.
- **Live.** Each page tracks its presence on `everyone` (active, or away
  when hidden) and joins `c:<id>` for the conversation it shows; the Chest
  lets in only members listed in `conversation_members`. Feeds of
  `messages` and `reactions` carry ids and times, never words: the page
  asks the tool for what changed, opened for its member. Members' own sends
  carry only `typing`. Everything else (unread counts, threads, reads on
  another device, conversations added) comes as direct events to the
  members concerned.
- **Search.** Sealed text has no index. A search narrows in clear (what
  you may read, filters), then opens messages newest first and keeps those
  holding every word; it stops at 20 results or after 5,000 messages, 16 MB
  or 2 seconds, and says how far back it looked.
- **Notifications** go to members whose setting asks for them and who are
  not active in Chat; the notice's title says who and where, its body the
  message's first words, or nothing of them in a confidential channel.

## Test

```sh
npm test               # types, unit tests, API tests (Docker: PostgreSQL)
npm run test:browser   # after npm test: two members live in Chromium, phone, dark, French, axe
npx chest check        # the Chest's own verdict (@argentic/chest-check, from a clone of Chest-SDK)
```

The API and browser tests run against a local Chest made of a disposable
PostgreSQL, the SDK's fake Chest (members, files, sealing, realtime) and
the realtime triggers the Chest installs. `CHAT_SCREENS=<folder>` keeps
the browser test's screenshots. `npm run memory` measures the built
server's memory at rest and under a burst of pages; on a Mac it sits at
about 79 MiB at rest, as the Chest's starter tool does.

## Licence

The licence is to be chosen by the owner. Until one is set, no licence is
granted.
