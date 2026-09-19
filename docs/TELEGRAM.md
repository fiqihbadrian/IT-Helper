# Telegram Bots

There are **two** bots, and the split is deliberate:

| Bot | For | Commands | Webhook |
| --- | --- | --- | --- |
| **employee bot** | employees | 8 | `/api/telegram/webhook` |
| **IT staff bot** | the IT team | 14 | `/api/telegram/webhook/staff` |

A ticket update for the requester and a ticket update for the IT bench are two
different notifications. Sending both to one bot would push the incoming queue into an
employee's chat. So the split is not about menu presentation — it is about **which
notifications it makes sense for whom to see**.

The bots are an **alternative channel for opening and following tickets**, using exactly
the same data, tables and access rules as the web app. There is no second ticketing
system: the bots talk to the same database.

## How it works

```
Telegram ──webhook──▶ /api/telegram/webhook[/staff] ──▶ lib/telegram/commands.ts
                                                                │
                                                   asUser(userId)  ← impersonation
                                                                ▼
                                                 Postgres + RLS (0003_rls.sql)
```

The webhook URL **is** the bot's identity. Nothing in the update payload says which bot
received it, and nothing needs to: the only difference is the address Telegram delivered
to.

The important point: the bots have **no** privileged access to ticket data. Every ticket
operation runs through `asUser(userId)`, which opens a transaction with
`set local role authenticated` and `request.jwt.claims` holding the Telegram account
owner's id. So every RLS policy still applies:

- An employee can only see their own tickets.
- Only `it_support` and `admin` can change status or claim a ticket.
- Trying through the bot cannot get around the same rules that apply on the web.

Add a new policy in SQL and the bots obey it automatically, with no code change.

## Setup

### 1. Create two bots

1. Chat with [@BotFather](https://t.me/BotFather) → `/newbot` → follow the prompts.
   Repeat once for the second bot.
2. Copy both tokens into `.env.local`:

```bash
BOT_TELE_KARYAWAN=123456:ABC...    # employee bot
BOT_TELE_ADMIN=789012:DEF...       # IT staff bot
```

The longer names `TELEGRAM_EMPLOYEE_BOT_TOKEN` and `TELEGRAM_STAFF_BOT_TOKEN` are also
recognised, and win when both are set. The list of variable names lives in
`lib/telegram/bots.ts` so the scripts and the app can never disagree about which bot is
which.

3. Optional, so the profile page can show a direct link:

```bash
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=<employee_bot>
NEXT_PUBLIC_TELEGRAM_STAFF_BOT_USERNAME=<staff_bot>
```

### 2. Secrets

```bash
# Telegram uses this to prove a request really came from Telegram
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

```bash
TELEGRAM_WEBHOOK_SECRET=...   # used by BOTH bots
DISPATCH_SECRET=...           # used by cron to call the dispatcher
```

One secret for two bots: what tells them apart is the URL, not the secret.

### 3. Register the webhooks

Telegram only accepts a **public HTTPS URL**.

```bash
# production
npm run telegram:setup        https://helpdesk.example.com   # employee bot
npm run telegram:setup:staff  https://helpdesk.example.com   # IT staff bot

# check status
npm run telegram:info
npm run telegram:info:staff

# delete
npm run telegram:delete
npm run telegram:delete:staff
```

Re-registering does **not** discard pending updates by default — those are what real
people typed while the webhook was down, which is exactly when you least want to lose
them. Use `--drop-pending` when the backlog is definitely junk.

### 4. Local development (no tunnel)

Telegram cannot deliver a webhook to `localhost`, so use polling. It pulls updates with
`getUpdates` and forwards them to the same webhook route — the logic is not duplicated.

```bash
npm run dev                    # terminal 1
npm run telegram:poll          # terminal 2 — employee bot
npm run telegram:poll:staff    # or the IT staff bot
```

The polling script refuses to start unless `NEXT_PUBLIC_APP_URL` is localhost. The
reason: polling begins with `deleteWebhook`, which would take a production bot offline
with no warning.

## Linking an account

An email is not a secret, so a bot must not simply believe someone who claims to be
`budi@company.com`. Linking uses a one-time code generated from an authenticated web
session:

1. Open **Profile → Telegram**. There is one card per bot.
2. A 6-character code appears, valid for 15 minutes.
3. Send it to the right bot: `/start K4M7QP`.

The code is stored in `telegram_link_codes` alongside a `bot` column, and marked
`used_at` once spent. A code minted for one bot does not work on the other.

What binds is the **(profile, bot) pair**: `telegram_links` has primary key
`(profile_id, bot)`. The key is not `chat_id` alone, because a private chat uses the
Telegram user id — the same person has the **exact same** `chat_id` on both bots.

The IT team may link both. Employees may only link the employee bot: calling
`create_telegram_link_code` with `p_bot = 'staff'` is rejected outright
(`only IT staff can link the staff bot`). The limit is in the database, not the UI.

If someone's role is downgraded out of the IT team, their staff-bot link is dropped
automatically the next time they send a command — the bot re-checks the role, unlinks,
and says so. RLS would already refuse the writes; this is so they are not left half
served.

To unlink: `/unlink` in the bot, or the button on the profile page.

## Commands

Each bot has **one** `default` menu list. There are no per-chat overrides and no role
branching inside a bot, so nothing can drift.

| Command | Bot | Purpose |
| --- | --- | --- |
| `/start` | both | Greeting / linking with a code |
| `/new` | both | Create a ticket, step by step: category → title → description → priority |
| `/tickets` | both | Your 10 most recently updated tickets |
| `/ticket IT-000004` | both | One ticket's detail + its last 4 messages |
| `/reply IT-000004 message` | both | Reply to a ticket straight from chat |
| `/status` | both | Account summary (the staff bot adds queue counts) |
| `/login` | both | Claim a pending web sign-in |
| `/unlink` | both | Unlink the Telegram account |
| `/help` | both | Command list, per bot |
| `/queue` | staff | Every ticket, newest first |
| `/open` | staff | Tickets not `RESOLVED`/`CLOSED` |
| `/unassigned` | staff | Tickets with no assignee |
| `/find printer` | staff | Search by ticket number or title |
| `/claim IT-000004` | staff | Assign the ticket to yourself |
| `/close IT-000004` | staff | Close the ticket |

The employee bot shows **8** commands; the IT staff bot shows **14**. To check what is
actually installed on Telegram:

```bash
node scripts/telegram-setup.mjs --menus --bot employee
node scripts/telegram-setup.mjs --menus --bot staff
```

The command lists are **not** registered from a script. There is one source,
`lib/telegram/menu.ts`, and each bot installs its own list on its first incoming update.

> **The menu is not an authorisation system.** Presentation only. Staff-only commands are
> still re-checked in `commands.ts` (`STAFF_ONLY`), and RLS remains the final arbiter — an
> employee typing `/queue` is refused before touching the database. On the employee bot
> that command is answered with `That command lives in the IT team bot.`

`/start` is deliberately absent from the menu: it still works, but it belongs in the
greeting message, not in a list that can be tapped at any time.

The consequence: after someone's role is changed on the web, their Telegram menu stays
stale until they send `/start` or `/help` once. Nothing tells the bot a role changed, so
those two commands are what force it to look again.

### Replying by command, not by "the next message"

The **Reply** button still opens a "the next message is sent as a reply" mode, because
that is convenient for long replies. But `/reply IT-000004 message` exists so an ordinary
message is never misinterpreted as a reply. If you type `/reply` while reply mode is
open, that mode is closed — otherwise the next message would also go out as a reply.

### Screenshots

A photo that arrives:

- while `/new` is in progress → stored and attached automatically once the ticket is
  created;
- in reply mode → attached to that ticket immediately;
- with a caption → the caption becomes the description (if ≥ 10 characters) or the reply.

The file is downloaded from Telegram and re-uploaded to the same Supabase bucket
(`ticket-attachments`, path `<ticket_id>/<uuid>-<name>`), so the ticket keeps a permanent
copy still protected by Storage RLS — not a `file_id` that only the bot can open.

## Notifications

`notifications` remains the single source of truth, written by the triggers in
`0002_triggers.sql` — no application code creates notifications.

What `0007_telegram.sql` adds:

- `notification_deliveries` — one row per (notification, channel) to track delivery, so
  nothing is ever sent twice and failures can be retried.
- The `notifications_queue_delivery` trigger — when a notification is created, the `web`
  channel is marked `SENT` straight away.

What `0009_two_bots.sql` adds: the `notifications.audience` column, and its routing.

### Audience is decided when the notification is created

Not guessed at delivery time. An admin can be both a requester and a member of the IT
bench, so "who is this person" cannot answer "what is this notification about". Only
`audience` can, and it is written by the trigger that creates the notification:

| Event | Recipient | `audience` |
| --- | --- | --- |
| new ticket | the whole IT team | `staff` |
| status changed | the requester | `requester` |
| priority changed | the requester | `requester` |
| HIGH/CRITICAL escalation | the whole IT team | `staff` |
| ticket claimed | the assignee | `staff` |
| ticket claimed | the requester | `requester` |
| an employee replies | the assignee / the whole IT team | `staff` |
| the IT team replies | the requester | `requester` |

Routing is strict, with **no fallback**: `requester` goes only to the employee bot,
`staff` only to the staff bot. A fallback to "whichever bot happens to be linked" would
silently undo the whole point of splitting the bots. The consequence: an IT team member
who links only one bot will miss one kind of notification on Telegram — but still sees it
on the web.

The `telegram` channel means the employee bot (that name predates the split); the
`telegram_staff` channel is new in `0009`.

Delivery is performed by the dispatcher:

```bash
curl -X POST https://helpdesk.example.com/api/telegram/dispatch \
  -H "x-dispatch-secret: $DISPATCH_SECRET"
```

Run it from cron, once a minute:

```
* * * * * curl -s -X POST https://helpdesk.example.com/api/telegram/dispatch \
  -H "x-dispatch-secret: $DISPATCH_SECRET" > /dev/null
```

On Cloudflare, use a Cron Trigger against the same Worker.

Separately, whenever a user sends any message to a bot, their queue is drained too
(`flushNotifications`), so notifications still arrive without cron.

## Security

| Aspect | Handling |
| --- | --- |
| Forged updates | The `X-Telegram-Bot-Api-Secret-Token` header must match; otherwise → 401 |
| Duplicate updates | `telegram_updates` primary key `(bot, update_id)`; Telegram retries are ignored |
| Updates crossed between bots | `update_id` is a sequence **per bot** — both bots can legitimately send `123456`, and the `(bot, update_id)` PK is what keeps both safe |
| Sessions crossed between bots | `telegram_sessions` PK `(bot, chat_id)`; a draft in one bot is not continued by the other |
| Claiming somebody else's account | Requires a code from a signed-in web session, not merely an email |
| An employee using the staff bot | A staff-bot code cannot be created at all; RLS refuses the rest |
| Data access | `asUser()` → real RLS; the bots have no privileged path to tickets |
| Uploads | MIME and size validated the same way as web uploads |

The webhook routes always answer `200` (except on a wrong secret). Answering `5xx` would
make Telegram keep redelivering the same update.

## Files

```
supabase/migrations/0007_telegram.sql   tables + triggers + linking functions
supabase/migrations/0009_two_bots.sql   telegram_links, audience, routing
lib/telegram/bots.ts                    bot identity: name, channel, env var names
lib/db/pool.ts                          asUser() — impersonation for RLS
lib/telegram/client.ts                  Bot API calls (per bot)
lib/telegram/menu.ts                    per-bot command lists
lib/telegram/commands.ts                commands, buttons, the create-ticket flow
lib/telegram/session.ts                 linking, conversation state, idempotency
lib/telegram/tickets.ts                 ticket operations as a user
lib/telegram/files.ts                   download from Telegram → Supabase Storage
lib/telegram/attachments.ts             attach a photo to a ticket
lib/telegram/webhook.ts                 the body shared by both webhook routes
app/api/telegram/webhook/route.ts       employee bot
app/api/telegram/webhook/staff/route.ts IT staff bot
app/api/telegram/dispatch/route.ts      notification dispatcher
components/profile/TelegramPanel.tsx    linking UI (one card per bot)
scripts/telegram-setup.mjs              register/delete webhooks, --bot employee|staff
scripts/telegram-poll.mjs               polling mode for local dev, per bot
```

## Troubleshooting

**The bot does not respond**
`npm run telegram:info` — check that the webhook URL is right and that
`pending_update_count` is not climbing. Check the Worker log (`npx wrangler tail`) for
`[telegram:*]`.

**`pending_update_count` keeps rising and `last_error_message` is 500**
Usually the deployed Worker is older than the database schema. The symptom: old code
asking for a column a newer migration dropped. Redeploy (`npm run cf:deploy`) and pending
updates drain by themselves. `last_error_date` stays populated after recovery — it is
stale metadata, not current status.

**`chat not found`**
The chat id is invalid, or the user has never pressed Start in the bot. The user has to
start the conversation first.

**`409 Conflict: can't use getUpdates method while webhook is active`**
Delete the webhook first: `npm run telegram:delete`, or stop `telegram:poll`.

**The linking code is not valid**
Codes last 15 minutes and are single-use. Minting a new code invalidates the previous one
for the same bot. An employee-bot code does not work on the staff bot.

**Notifications are not delivered**
Check that the recipient has linked the right bot — the employee bot for `requester`
notifications, the staff bot for `staff`. If not, that row is simply never queued; only
`web` is `SENT`. Failed rows are kept in `notification_deliveries` with `status = 'FAILED'`
and their `last_error`.

## Traps that have already bitten

**Never fold an INSERT and a SELECT into one data-modifying CTE.**

`lib/telegram/tickets.ts` used to contain:

```sql
with inserted as (
  insert into public.tickets (...) values (...) returning id
)
select ... from public.tickets t where t.id = (select id from inserted)
```

It looks tidy, but it **always returns 0 rows**. Sub-statements inside a `WITH` share the
snapshot taken when the statement began, so the outer SELECT cannot see the row the CTE
itself just INSERTed. The result was that `createTicket()` returned `undefined` and the bot
said "Failed to create the ticket" — even though the INSERT had committed and the ticket
genuinely existed. The INSERT and the read-back are now two separate statements.

**Never call `asUser()` inside `asUser()`.**

`asUser()` takes a connection from the pool and opens a transaction. Calling it again from
inside the callback takes a **second** connection, which cannot see rows not yet committed
in the first transaction. So a helper that needs to read back what it just wrote takes a
`Queryable` (`db`), not a `userId`.

Both are guarded by `npm run verify` (the *Read-your-own-write inside a transaction*
section).

**Never use a module global for bot identity.**

Two bots live in the same Worker. Keeping the bot currently being handled in a module
variable would leak between concurrent requests — one staff-bot request could make an
employee-bot request send a message as the wrong bot. So identity is passed explicitly as
a parameter (`BotKind`, `BotContext`) through all of `client.ts`, `commands.ts` and
`session.ts`.

**Never use `create or replace` to change a function's signature.**

`create or replace function public.unlink_telegram(p_bot text, p_chat_id bigint)` does not
replace `unlink_telegram(bigint)` — Postgres stores it as a **second overload**, and
existing callers keep finding the old one. Every function whose arguments changed in
`0009` is preceded by `drop function if exists` with the full signature.

**Migrations must be *replayable*, not merely idempotent.**

`node scripts/db-push.mjs --schema` runs **every** file on every invocation, so a file that
mentions a column a later file drops will fail on the second run. For example,
`0007_telegram.sql` used to keep links in `profiles.telegram_user_id` — `0009` drops that
column, so the function bodies moved into `0009` and `0007` keeps only its tables. The
backfill in `0009` is itself wrapped in `do $$ ... $$` that checks
`information_schema.columns` first.

**A Worker behind the schema answers 500 to Telegram.**

This has happened: `0009` had been applied to the database, but the deployed Worker was
still the single-bot code asking for `profiles.telegram_user_id`. The symptom is not a
clear log error but a `pending_update_count` that will not fall, with
`last_error_message: 500 Internal Server Error`. Redeploying fixed it, and the pending
updates were processed immediately.

## Signing in to the web app with Telegram

If the Telegram account is already linked, the password never has to be remembered.

1. Open `/auth/telegram` (or the **Sign in with Telegram** button on the login page).
2. The page shows an 8-character code and **one** button to the bot.
3. That button opens Telegram with the code already filled in — press **Start**.
4. The browser tab continues on its own and signs in as the account linked to that chat.

From the bot's side, the button sends `/start login_CODE`; typing `/login CODE` by hand
works too. The code lasts **10 minutes** and is single-use.

**One button, not two.** The code is not bound to any bot — `redeem_web_login_code` only
ever receives a `profile_id` — so the page does not need to ask which bot you linked, and
you do not need to remember. The page points at the employee bot because that is the one
every role may link; the staff bot only accepts staff. If a chat turns out to be linked to
the staff bot alone, the employee bot can still claim it: `profileForChatAcrossBots()`
(`lib/telegram/session.ts`) looks for the link on both bots, trying the receiving bot
first.

The audience rule still belongs to the bot that **owns** the link, not the one that merely
received the message. Otherwise a staff member sending a code to the employee bot would
look like a non-staff member to the staff bot, and their chat would be unlinked for no
reason.

**Why this is safe.** The code is not a credential for somebody else's account. The bot
resolves the sender through `telegram_links` first, so a code can only ever bind the
sender's own account. Anyone who copies a code off somebody else's screen can at most make
that browser sign in as themselves. On top of that, the browser holds an
`it-helpdesk-login` cookie issued alongside the code — without that cookie the code cannot
be exchanged. The server then re-checks that the profile is still active and is not a
machine account, and only then mints a real Supabase session.

Codes live in `web_login_codes`: no policies, no grants to `anon` or `authenticated`, and
the claim/spend functions are callable only by `service_role`.

Employees who have never linked Telegram keep using email + password. That flow is
unchanged.

If the chat is genuinely not linked to any account, the code can never be claimed and the
page just waits for the clock. That is why the login page states the requirement under the
button: link first via **Profile → Telegram** while signed in, and only then is this code
worth anything. The bot also says so plainly when a code arrives from an unlinked chat.
