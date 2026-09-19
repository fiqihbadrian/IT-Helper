# IT Helpdesk

An IT support ticketing system where **Postgres is the authorisation layer**. The web
app, two Telegram bots, a REST API and an embeddable chat widget all act as a real
signed-in user, so every one of them is governed by the same Row Level Security
policies — there is no second permission model to keep in sync.

Next.js 15 · TypeScript · Tailwind · Supabase (Postgres, Auth, Storage) · Cloudflare Workers

![Dashboard](docs/screenshots/02-dashboard.png)

**Live demo — <https://it-helpdesk.fiqihbadrian.workers.dev>**

| Email | Role |
| --- | --- |
| `admin@helpdesk.test` | admin |
| `support1@helpdesk.test` | IT support |
| `employee1@helpdesk.test` | employee |

Password for all three: `Password123!`

> It is a public demo on a shared database. Please do not put anything real in it —
> the data is wiped whenever it gets noisy.

## Screenshots

| | |
| --- | --- |
| [![Ticket list](docs/screenshots/03-tickets.png)](docs/screenshots/03-tickets.png) | [![Ticket detail](docs/screenshots/09-ticket-detail.png)](docs/screenshots/09-ticket-detail.png) |
| Ticket list with status, priority and source filters | Conversation, controls and audit history on one page |
| [![A ticket that arrived from the widget](docs/screenshots/10-ticket-from-widget.png)](docs/screenshots/10-ticket-from-widget.png) | [![Widget conversation](docs/screenshots/13-widget-conversation.png)](docs/screenshots/13-widget-conversation.png) |
| A ticket raised by an anonymous visitor, attributed to them | The same conversation from the visitor's side, on somebody else's website |
| [![Channels](docs/screenshots/05-admin-channels.png)](docs/screenshots/05-admin-channels.png) | [![Activity log](docs/screenshots/07-activity.png)](docs/screenshots/07-activity.png) |
| Admin → Channels: one channel per website, with the embed snippet | Activity log, written by database triggers |
| [![Notifications](docs/screenshots/04-notifications.png)](docs/screenshots/04-notifications.png) | [![Light theme](docs/screenshots/11-light-theme.png)](docs/screenshots/11-light-theme.png) |
| In-app notifications | Light theme (dark is the default) |

More: [login](docs/screenshots/01-login.png) ·
[users](docs/screenshots/06-admin-users.png) ·
[profile](docs/screenshots/08-profile.png) ·
[widget visitor form](docs/screenshots/12-widget-visitor-form.png)

## The parts worth reading

### Authorisation is one SQL file, not five

`supabase/migrations/0003_rls.sql` is the whole permission model. Everything else
either is a UI convenience or reuses it:

```ts
// lib/db/pool.ts — how the bot, the REST API and the widget all reach the database
await asUser(profileId, (db) => db.query("select * from tickets"));
//   begin;
//   set local role authenticated;
//   set local request.jwt.claims = '{"sub":"<profileId>", ...}';
//   ... your query ...
//   commit;
```

Because `auth.uid()` resolves to the impersonated profile, `tickets_select`,
`can_access_ticket()` and friends apply unchanged. An employee cannot read another
employee's ticket through the bot any more than through the browser — and a change
to a policy changes all four surfaces at once, with no deploy.

The `Menu is presentation, not authorization` rule follows from the same idea: the
Telegram ☰ menus differ per bot, but staff-only commands are re-checked in
`lib/telegram/commands.ts` and the real gate is RLS.

### Two Telegram bots, one codebase, no global

Employees talk to one bot and the bench talks to another, because a requester's
update and a queue update are different messages. Bot identity is threaded through
explicitly as `BotKind` and never parked in a module global — the webhook URL *is*
the identity (`/api/telegram/webhook` vs `/staff`), so nothing in the update payload
has to say which bot it arrived for.

### A visitor is not a user

The obvious way to build an embeddable widget is to create an account per visitor.
That is wrong: visitors have no role and no department, they would appear in
`/admin/users` and in the assignee dropdown next to real colleagues, and unlike an
employee there is nobody to ever deactivate them.

Instead each channel owns one **system profile** (`profiles.is_system`). The
visitor's words are filed as that profile; their real identity lives in
`ticket_contacts`. RLS stays untouched — `tickets_insert`'s `created_by = auth.uid()`
is satisfied by the system profile, so there is no second, weaker authorisation path
to audit.

### Telegram is also a login provider

Linking a chat is enough to sign in without a password. The code alone is not a
credential for somebody else's account: the bot resolves the sender through
`telegram_links` *before* touching the code, so a stolen code only ever signs its
thief in as themselves. It is single-use, expires in 10 minutes, and is bound to an
HttpOnly cookie issued alongside it.

Because the code is never bound to a bot, the page shows one button and does not ask
which bot you linked — the bot that receives it resolves the chat across both.

### Cloudflare Workers, and one deliberate footgun avoided

The whole thing ships as a single Worker. Two details are easy to get wrong and both
are load-bearing:

- **Hyperdrive query caching must stay off.** Its cache key is the SQL text plus
  parameters and knows nothing about `set local role` / `request.jwt.claims`. With
  caching on, two users running the same statement would share a cache entry and
  read each other's rows.
- **`lib/db/pool.ts` has two backends behind one API.** Node keeps a shared
  `pg.Pool`; Workers open one `pg.Client` per call, because Workers forbid I/O across
  request contexts and a global pool would hand out sockets belonging to a finished
  request.

### Theme without a single `dark:` variant

Colours are named by role (`surface`, `ink`, `accent`, four status families) as CSS
custom properties holding RGB channels, so Tailwind's opacity modifier keeps working.
`:root` holds the dark values and `html[data-theme="light"]` overrides them. A status
picks a *tone* by name (`open`, `progress`, `critical`, …) which `app/globals.css`
maps to a palette per theme, so no component can drift out of sync. An inline script
applies the stored theme before first paint.

## Features

- **Tickets** — six statuses, four priorities, eight seeded categories, `IT-000001`
  human-readable numbers, assignee, department, attachments to a private bucket.
- **Conversation timeline** — comments and audit history merged into one thread, with
  a history written by database triggers rather than by application code.
- **Search, filter, sort** — status, priority, category, assignee, source, free text.
- **Three dashboards** — an employee sees their own tickets, the bench sees the queue,
  admins see everything plus the counters.
- **Notifications** — in-app, plus Telegram delivery, addressed at creation time and
  queued per channel in `notification_deliveries`.
- **Admin** — users, departments, categories, channels, activity log.
- **REST API v1** — self-describing at `GET /api/v1`, keyed by `itk_…` keys that act
  as their owner.
- **Embeddable widget** — one `<script>` tag, no dependencies, shadow DOM, CORS and
  per-IP rate limits.
- **Dark and light** — dark by default, per device, no flash on load.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 App Router, React 19, TypeScript |
| Styling | Tailwind CSS, CSS custom properties |
| Database | Supabase Postgres, RLS, `SECURITY DEFINER` triggers |
| Auth | Supabase Auth (email + password, and via Telegram) |
| Files | Supabase Storage, private bucket, signed URLs |
| Bots | Telegram Bot API, webhooks |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare`, Hyperdrive |

## Quickstart

```bash
npm install
cp .env.local.example .env.local     # then fill in the values
npm run db:push                      # migrations + demo data
npm run dev
```

`.env.local` needs a Supabase project URL, its publishable key, and the service-role
key (server-only). `SUPABASE_DB_URL` is only used by the CLI scripts. No Supabase CLI
and no Docker are required — migrations are plain SQL pushed by `scripts/db-push.mjs`,
or you can paste `supabase/all_in_one_schema.sql` into the Supabase SQL editor. That
file is generated from the migrations by `npm run db:bundle`, so it cannot lag behind
them.

Checks:

```bash
npm run typecheck    # tsc --noEmit
npm run verify       # 103 checks against the database: RLS, impersonation, API keys,
                     # Telegram linking, widget channels, sign-in codes
```

Telegram and the widget are optional. Both bots, the REST API and the widget have
their own setup notes under [`docs/`](docs).

## Project layout

```text
app/
  (app)/            authenticated shell: dashboard, tickets, notifications, profile, admin
  actions/          server actions (auth, tickets, notifications, admin, channels)
  api/              Telegram webhooks, REST API v1, widget API v1
components/         admin/ auth/ dashboard/ layout/ notifications/ profile/ tickets/ ui/
lib/
  supabase/         browser, server, admin (service-role) and middleware clients
  api/              REST API plumbing (auth, errors, responses, ticket queries)
  telegram/         bot plumbing (client, menus, commands, sessions, webhook, login)
  widget/           widget plumbing (keys, channels, CORS, rate limits, sessions)
  auth.ts           session + role guards
  db/pool.ts        asUser() / asSystem(), one API over Node and Workers
services/           every database query lives here, not in components
types/              domain types + generated-style database types
supabase/
  migrations/       0001 schema, 0002 triggers, 0003 RLS, 0004 storage, 0005 stats,
                    0006 API keys, 0007 Telegram, 0008 profile visibility,
                    0009 two Telegram bots, 0010 widget channels, 0011 Telegram sign-in
  seed.sql          demo departments, categories, users, tickets
public/widget.js    embeddable chat widget (vanilla, shadow DOM, no dependencies)
```

## Docs

- [docs/DEPLOY.md](docs/DEPLOY.md) — Cloudflare Workers, Hyperdrive, secrets
- [docs/TELEGRAM.md](docs/TELEGRAM.md) — both bots, linking, command menus
- [docs/API.md](docs/API.md) — REST API v1 reference
- [docs/WIDGET.md](docs/WIDGET.md) — channels, embed snippet, widget HTTP API

*(These are written in Indonesian. The README and all code comments are in English.)*

## Roadmap

- **Phase 3** — Asset management. `devices` is created and locked to admins; the point
  is to link a ticket to *the thing that is broken*.
- **Phase 4** — Remote support. `remote_sessions` links `ticket → device → operator`.
- A worklist view built on ticket age, so the dashboard answers "what is about to
  breach" instead of only "how many are open".

Every phase so far reused the same ticket, history and notification tables without
widening them: the widget added one column and two side tables, and the bots and the
REST API added none.

## Limitations

- Widget v1 is text-only; visitors cannot attach files.
- The widget binds one session token to exactly one ticket. "Show me all my tickets"
  for a logged-in user of a host app is a different security model and is not
  implemented.
- Telegram sign-in requires the chat to be linked already, and accounts are created by
  an admin — there is no self-registration.
- `npm run lint` is not wired up; `tsc` and `npm run verify` are the checks that run.

## License

[MIT](LICENSE)
