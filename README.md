# IT Helpdesk

Internal IT support ticketing system. Next.js (App Router) + TypeScript + Tailwind +
Supabase (Postgres, Auth, Storage). Authorisation is enforced by Postgres Row Level
Security, not only by hiding menu items.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 App Router, React 19, TypeScript |
| Styling | Tailwind CSS |
| Database | Supabase Postgres |
| Auth | Supabase Auth (email + password) |
| Files | Supabase Storage, private bucket `ticket-attachments` |

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
```

`.env.local` needs:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # or NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=...        # server-only, never exposed to the browser
SUPABASE_DB_URL=postgresql://...     # optional, only for `npm run db:push`
```

### Apply the database

Either push from the CLI:

```bash
npm run db:push      # migrations + demo data
npm run db:schema    # migrations only
npm run db:bundle    # regenerate supabase/all_in_one_schema.sql from the migrations
```

Or paste `supabase/all_in_one_schema.sql` into the Supabase SQL editor. It already
contains the migrations **and** `seed.sql`, and it is idempotent, so re-running it
is safe. `db:bundle` rebuilds it, so the pasted file can never lag behind the
migrations.

### Run

```bash
npm run dev
```

Demo accounts (password `Password123!`):

| Email | Role |
| --- | --- |
| `admin@helpdesk.test` | Admin |
| `support1@helpdesk.test` | IT Support |
| `support2@helpdesk.test` | IT Support |
| `employee1@helpdesk.test` | Employee |
| `employee2@helpdesk.test` | Employee |

## Layout

```text
app/
  (app)/            authenticated shell: dashboard, tickets, notifications, profile, admin
  actions/          server actions (auth, tickets, notifications, admin, channels)
  api/              Telegram webhooks, REST API v1, widget API v1
  login/            public sign-in
components/
  admin/ auth/ dashboard/ layout/ notifications/ profile/ tickets/ ui/
lib/
  supabase/         browser, server, admin (service-role) and middleware clients
  api/              REST API plumbing (auth, errors, responses, ticket queries)
  telegram/         bot plumbing (client, menus, commands, sessions, webhook)
  widget/           widget plumbing (keys, channels, CORS, rate limits, sessions)
  auth.ts           session + role guards
  constants.ts      status / priority / role / source metadata
  navigation.ts     per-role sidebar definition
  upload.ts         storage upload + signed URLs
  validation.ts     zod schemas
public/
  widget.js         embeddable chat widget (vanilla, shadow DOM, no dependencies)
services/           every database query lives here, not in components
types/              domain types + generated-style database types
supabase/
  migrations/       0001 schema, 0002 triggers, 0003 RLS, 0004 storage, 0005 stats,
                    0006 API keys, 0007 Telegram, 0008 profile visibility,
                    0009 two Telegram bots, 0010 widget channels
  seed.sql          demo departments, categories, users, tickets
```

## Theme

Dark by default, with a light mode the user can switch to from the header (and
from the login page). The choice is stored in `localStorage` — it is a per-device
display preference, not worth a column in `profiles`.

Colours are named by **role**, never by appearance: `surface`, `ink`, `accent`,
and the four status families. Each is a CSS custom property holding RGB channels,
so Tailwind's opacity modifier keeps working (`bg-surface-muted/60`). `:root`
carries the dark values and `html[data-theme="light"]` overrides them, which means
a missing or unrecognised attribute still renders correctly instead of flashing
white.

Status badges go one step further: a state picks a **tone** by name (`open`,
`progress`, `critical`, …) and `app/globals.css` maps that tone to a palette per
theme. So no component carries a `dark:` variant, and a badge cannot drift out of
sync with its siblings. `lib/constants.ts` stores the tone, not the classes.

An inline script in `app/layout.tsx` applies the stored theme before first paint,
so a light-theme user never sees a dark flash.

```bash
# no component should hard-code a palette colour or a dark: variant
grep -rE 'dark:|(bg|text|border|ring|divide)-(red|amber|emerald|blue|slate|zinc|violet|orange|rose)-[0-9]{2,3}' app components
```

## Authorisation

| Role | Tickets | Users | Categories | Activity |
| --- | --- | --- | --- | --- |
| `employee` | select/insert own, comment on own | own profile | read | own tickets |
| `it_support` | select all, update all, comment | own profile + staff list | read | all |
| `admin` | full | full | full | full |

Guarantees:

- Employees cannot read another employee's ticket by editing the URL — `tickets_select`
  restricts rows, and `getTicketDetail` returns `notFound()` when RLS hides the row.
- Comments and attachments are gated by `can_access_ticket()`.
- `ticket_history` is read-only to clients; rows are written by `SECURITY DEFINER`
  triggers so the audit log cannot be forged or erased.
- Role, `is_active` and `department_id` changes are blocked by the
  `guard_profile_privileges` trigger unless the caller is an admin.
- Users are deactivated, never deleted, so tickets keep their references.
- The service-role key is only read inside `lib/supabase/admin.ts` (`server-only`).

## Ticket side effects

Everything happens in the database so the Telegram bot and API share the same
records:

- `tickets` insert/update triggers write `ticket_history` rows and `notifications`.
- `ticket_comments` insert triggers notify the counterparty (staff reply → requester,
  requester reply → assignee or the whole bench).
- `resolved_at` / `closed_at` are maintained by a trigger.
- `notifications` insert queues a `notification_deliveries` row per channel.

## Telegram bots (Phase 2)

The bots are a second way to **open and follow tickets**, not a separate system:
they write to the same tables and are subject to the same RLS policies.

There are two of them, and the split is the point. Employees talk to
**@bian_it_bot**; IT staff talk to **@bian_itbot**. A ticket update for a
requester and a ticket update for the bench are different notifications, so
sending both to one bot would put the bench queue in an employee's chat.

```bash
# .env.local
BOT_TELE_KARYAWAN=123456:ABC...    # employee bot, @bian_it_bot
BOT_TELE_ADMIN=789012:DEF...       # staff bot, @bian_itbot
TELEGRAM_WEBHOOK_SECRET=<random>   # shared by both
DISPATCH_SECRET=<random>
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=bian_it_bot
NEXT_PUBLIC_TELEGRAM_STAFF_BOT_USERNAME=bian_itbot
```

`TELEGRAM_EMPLOYEE_BOT_TOKEN` / `TELEGRAM_STAFF_BOT_TOKEN` are accepted as the
longer, more explicit names; the `TELEGRAM_*` pair wins when both are set.

```bash
npm run telegram:setup        <base-url>  # register the employee webhook
npm run telegram:setup:staff  <base-url>  # register the staff webhook
npm run telegram:info         # what Telegram holds for the employee bot
npm run telegram:info:staff   # what Telegram holds for the staff bot
npm run telegram:poll         # local dev, no tunnel (employee bot)
npm run telegram:poll:staff   # local dev, no tunnel (staff bot)
```

The webhook URL *is* the bot identity: `/api/telegram/webhook` is the employee
bot and `/api/telegram/webhook/staff` is the staff bot. Nothing in the update
payload says which bot it arrived for, and nothing needs to.

Users link from **Profile → Telegram** — one card per bot, a 15-minute
single-use code sent to the bot as `/start CODE` — then `/new` walks them through
category → title → description → priority. Screenshots are re-uploaded into the
same private Supabase bucket, and every ticket change is pushed back as a
notification.

The ☰ menu is per bot: 7 commands for employees, 13 for the staff bot, which adds
`/queue`, `/open`, `/unassigned`, `/find`, `/claim` and `/close`. There are no
per-chat overrides and no role branching inside a bot, so there is nothing to
drift. `lib/telegram/menu.ts` owns the lists and each bot installs its own:

```bash
node scripts/telegram-setup.mjs --menus --bot staff   # what Telegram holds
```

A menu is presentation, not a permission system. Staff-only commands are checked
again in `commands.ts`, and RLS has the final word. The real gate is linking: an
employee cannot even mint a staff-bot code — `create_telegram_link_code` raises
`only IT staff can link the staff bot`. A demoted staff member who still holds a
staff-bot link is unlinked on their next command. Replies can be sent as a
command (`/reply IT-000004 pesan`) so a plain message is never mistaken for a
reply.

Why the bots cannot over-reach: every ticket query runs through `asUser(userId)`
in `lib/db/pool.ts`, which opens a transaction with
`set local role authenticated` and a `request.jwt.claims` payload for the linked
profile. `auth.uid()` resolves to that user, so the policies in `0003_rls.sql`
apply unchanged — an employee cannot read another employee's ticket through the
bot any more than through the browser.

See [docs/TELEGRAM.md](docs/TELEGRAM.md).

## REST API (Phase 2)

Every user can mint an API key in **Profile → API Keys** and call the system from
scripts, cron jobs, n8n, or an AI tool.

```bash
curl -s -H "Authorization: Bearer itk_..." https://your-app/api/v1/me
```

A key is not a super-account: it acts as its owner. Each request runs inside a
transaction with `set local role authenticated` and a `request.jwt.claims`
payload, so `auth.uid()` resolves to the key's owner and **every RLS policy still
applies**. An employee key can read its own tickets and nothing else; a typo in
the SQL rules changes the API behaviour without a deploy, because there is no
second permission list to drift.

`GET /api/v1` describes the whole surface, including enum values and example
payloads, so a tool can discover it without reading the source. Responses carry
`requester.email` because that is the identity external systems map onto.

```
GET    /api/v1                      self-describing index
GET    /api/v1/me                   identity, permissions, stats
GET    /api/v1/meta                 categories, departments, counters
GET    /api/v1/users                directory, scoped by RLS
GET    /api/v1/tickets              list + filter + paginate
POST   /api/v1/tickets              create
GET    /api/v1/tickets/{number}     detail
PATCH  /api/v1/tickets/{number}     status, priority, assignee
GET    /api/v1/tickets/{number}/comments
POST   /api/v1/tickets/{number}/comments
```

See [docs/API.md](docs/API.md).

## Deploy (Cloudflare Workers)

Web app, REST API and the Telegram bot all ship as one Worker.

```text
https://it-helpdesk.fiqihbadrian.workers.dev
```

```bash
npm run cf:deploy    # build + deploy
npm run cf:preview   # run the Worker locally on :8787
npm run cf:build     # build only
```

Two things make this work and both are easy to get wrong:

**The database goes through Hyperdrive, and its query cache is off.** Workers cannot
open a plain TCP connection, so `pg` talks to the `HYPERDRIVE` binding instead of
`SUPABASE_DB_URL`. Caching is disabled on purpose: Hyperdrive's cache key is the SQL
text plus parameters and knows nothing about `set local role` / `request.jwt.claims`.
With caching on, two users running the same statement would share a cache entry and
read each other's rows. Supabase's direct `db.<ref>` host is IPv6-only and out of
reach from Hyperdrive, so the connection string uses the Tokyo pooler.

**`lib/db/pool.ts` has two backends behind one API.** On Node it keeps a shared
`pg.Pool`; on Workers it opens one `pg.Client` per call, because Workers forbid I/O
across request contexts and a global pool would hand out sockets from a finished
request. Callers only ever see `asUser()` / `asSystem()`.

Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `BOT_TELE_KARYAWAN`, `BOT_TELE_ADMIN`,
`TELEGRAM_WEBHOOK_SECRET`, `DISPATCH_SECRET`) live in the Cloudflare dashboard;
`NEXT_PUBLIC_*` values live in `wrangler.jsonc` because they are public anyway.
After a deploy the Telegram webhook must be re-registered once — it is per bot
token and Cloudflare knows nothing about Telegram.

See [docs/DEPLOY.md](docs/DEPLOY.md).

## Web widget (Phase 5)

Any website can embed the chat widget with one line, and the conversations it
starts land in the same ticket queue as everything else.

```html
<script src="https://it-helpdesk.fiqihbadrian.workers.dev/widget.js"
        data-key="wk_..." async></script>
```

**A visitor is not a user.** The obvious design — an account per visitor — is
wrong: visitors have no role, no department, no business in `/admin/users` and no
business in the assignee dropdown next to real colleagues, and unlike an employee
there is nobody to ever deactivate them. Instead each channel owns one *system
profile* (`profiles.is_system`), the visitor's words are filed as that profile,
and their real identity lives in `ticket_contacts`.

That keeps RLS untouched. A widget request runs through the same `asUser()`
impersonation as the bot and the API, so `tickets_insert`'s
`created_by = auth.uid()` is satisfied by the system profile and every policy
keeps working verbatim — there is no second, weaker authorisation path to audit.
`is_system` is what hides those profiles from the user list, the assignee picker
and the notification table.

The public key is public by definition, so `allowed_origins` is a speed bump, not
a wall. What actually protects a conversation:

- a `widget_sessions` row binds one token to **exactly one** `ticket_id`, and
  `GET /messages` reads that column rather than the request — there is no ticket
  id to guess;
- `allowed_origins` empty means **deny** (fail closed); `"*"` means allow any;
- per-IP and per-ticket rate limits counted **in the database**, because Worker
  isolate memory is short-lived and a cold start would reset an in-memory counter;
- the token is stored as a sha256 hash, so a database dump holds nothing replayable.

An empty `allowed_origins` array is the default on purpose: a half-configured
channel refuses traffic instead of leaking it.

```bash
curl -s -H "Origin: https://example.com" -H "X-Widget-Key: wk_..." \
  https://your-app/api/widget/v1/config
```

```
GET    /api/widget/v1/config     channel name, greeting, accent colour
POST   /api/widget/v1/session    start a conversation, returns the token once
GET    /api/widget/v1/messages   read (?since=<ISO>)
POST   /api/widget/v1/messages   reply
```

Widget v1 is text-only — no visitor attachments. See [docs/WIDGET.md](docs/WIDGET.md).

## Future phases

- **Phase 3** Asset management. `devices` table is created and locked to admins.
- **Phase 4** Remote support. `remote_sessions` links `ticket → device → operator`.

Every phase so far has reused the same ticket model, history and notification
tables without widening them: the widget added a source column and two side
tables, and the bot and the API added none.
