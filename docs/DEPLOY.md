# Deploy — Cloudflare Workers

This app runs on **Cloudflare Workers**, not just on a laptop. The web app, the REST
API v1 and both Telegram bots all deploy as the same single Worker.

```text
https://ticket.fiqihbadrian.my.id
```

| Item | Value |
| --- | --- |
| Worker | `it-helpdesk` |
| Adapter | `@opennextjs/cloudflare` (OpenNext) |
| Config | `wrangler.jsonc` |
| Custom domain | `ticket.fiqihbadrian.my.id` |
| Hyperdrive | `it-helpdesk-db` — `<hyperdrive-id>` |
| Database region | Tokyo (`ap-northeast-1`) |

### Custom domain

The Worker is reachable both at
`https://it-helpdesk.<subdomain>.workers.dev` and at the custom domain above. The
domain is attached in the Cloudflare dashboard under **Workers → it-helpdesk →
Settings → Domains & Routes → Add → Custom Domain**, not in `wrangler.jsonc`.

Attaching it there means Cloudflare creates the proxied `AAAA` record and issues the
certificate itself, so there is nothing to renew by hand. If you would rather keep it
in config, the equivalent is:

```jsonc
"routes": [{ "pattern": "ticket.example.com", "custom_domain": true }]
```

Either way the app does not need to be told. There is deliberately no
`NEXT_PUBLIC_APP_URL` in the Worker's vars — the channels page reads the host off the
request headers, so the embed snippet shows whichever hostname you are actually
browsing, and the Telegram webhook URL is whatever you registered.

## Why OpenNext, not vinext

Cloudflare now points at **vinext** as the default path for Next.js on Workers. But
vinext is still beta and targets **Next.js 16**, while this project is on Next.js
15.5.25. `@opennextjs/cloudflare` supports Next.js 14/15/16, the App Router, route
handlers, middleware, Server Actions and streaming — all of which are used here. So
OpenNext it is, and there is no need to upgrade Next.js.

One limitation worth knowing: **Node.js Middleware (Next 15.2+) is not supported
yet.** `middleware.ts` here uses ordinary Edge middleware, so it is unaffected.

## Hyperdrive — and why caching has to stay off

`lib/db/pool.ts` uses the `pg` driver (raw TCP to Postgres). Workers cannot open
plain TCP connections, so Hyperdrive bridges it:

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive-id>" }]
```

The configuration was created with `--caching-disabled`, and that is **not** an
aesthetic choice:

> A Hyperdrive cache key is **the SQL text plus its parameters**. It knows nothing
> about `set local role authenticated` or `request.jwt.claims`.

Every bit of authorisation in this project lives in that session state. With caching
on, two different users running `select * from tickets` would hit the same cache
entry — and the second user would read the first user's rows. Hyperdrive's own
documentation names this case: use a cacheless configuration for *"authentication,
sessions, permissions"*.

```bash
npx wrangler hyperdrive create it-helpdesk-db \
  --connection-string="postgresql://postgres.<ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  --caching-disabled
npx wrangler hyperdrive get <hyperdrive-id>   # caching.disabled must be true
```

### It has to go through the pooler, not the `db.` host

The host `db.<ref>.supabase.co` **only has an AAAA record** (IPv6). Hyperdrive does
not reach IPv6, so the connection must go through the Supabase pooler
(`aws-0-ap-northeast-1.pooler.supabase.com`), and the user is shaped
`postgres.<ref>` — not `postgres`.

### `SET LOCAL` is still safe

Hyperdrive runs in **transaction mode**: one connection is held for one transaction,
then returned to the pool and `RESET`. Because `asUser()` uses `set local`, the
caller's identity never sticks to the next connection. This was tested directly
against production, not just read in the docs.

## Node vs Workers — one API, two runtimes

`lib/db/pool.ts` hides the difference:

| | Node (`next dev` / `next start`) | Workers |
| --- | --- | --- |
| Connection | one `pg.Pool` at module scope | one `pg.Client` per call |
| Why | a warm connection survives between requests | Workers forbid I/O across request contexts, so a global pool would hand out a socket belonging to a request that has already finished |
| Database address | `SUPABASE_DB_URL` | `env.HYPERDRIVE.connectionString` |

Shared by both: `asUser()` and `asSystem()`. Calling code never needs to know where
it is running.

`asUser()` opens at most **5 connections at once** (Workers allow 6 per invocation).
If that ceiling is hit, the error names the most common cause: `asUser()` called from
inside `asUser()`.

## Deploy

```bash
npm run cf:deploy
```

`cf:deploy` runs **build then deploy** (`opennextjs-cloudflare build && ... deploy`).
That order is mandatory: OpenNext's `deploy` command does **not** build — it only
uploads whatever is already in `.open-next`. Running `deploy` on its own will
succeed, print a fresh Version ID, and keep serving the old code.

`scripts/cf.mjs` also reads `SUPABASE_DB_URL` from `.env.local` and passes it as
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`, because OpenNext has to
spin up a local miniflare to read the binding before deploying.

That connection string is **not** written into `wrangler.jsonc` — putting it there
would commit the database password to git.

Other commands:

```bash
npm run cf:build     # build only, no deploy
npm run cf:preview   # build + run the Worker locally (localhost:8787)
npm run cf:typegen   # regenerate cloudflare-env.d.ts
```

## Secrets vs vars

**Vars** (`wrangler.jsonc`, public, committed):

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_TICKET_BUCKET
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
NEXT_PUBLIC_TELEGRAM_STAFF_BOT_USERNAME
```

**Secrets** (Cloudflare dashboard, never in the repo):

```text
SUPABASE_SERVICE_ROLE_KEY
BOT_TELE_KARYAWAN        # employee bot
BOT_TELE_ADMIN           # IT staff bot
TELEGRAM_WEBHOOK_SECRET  # one secret for both bots
DISPATCH_SECRET
```

Set them all at once from `.env.local`:

```bash
node -e '
const fs=require("fs");
const env=Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
  .map(l=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map(m=>[m[1],m[2]]));
fs.writeFileSync("/tmp/it-secrets.json", JSON.stringify({
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  BOT_TELE_KARYAWAN: env.BOT_TELE_KARYAWAN ?? env.TELEGRAM_EMPLOYEE_BOT_TOKEN,
  BOT_TELE_ADMIN: env.BOT_TELE_ADMIN ?? env.TELEGRAM_STAFF_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
  DISPATCH_SECRET: env.DISPATCH_SECRET,
}));
'
npx wrangler secret bulk /tmp/it-secrets.json && rm -f /tmp/it-secrets.json
npx wrangler secret list
```

One `TELEGRAM_WEBHOOK_SECRET` for both bots: what tells them apart is the webhook
URL, not the secret.

`NEXT_PUBLIC_*` lives in `wrangler.jsonc` deliberately: those values do reach the
browser, and OpenNext reads them from `process.env` at **runtime**, not only at build
time.

`wrangler.jsonc` sets `"keep_vars": true` so a later deploy does not wipe variables
added from the dashboard.

## Telegram bots after deploy

A Telegram webhook is **per bot token, one URL**. Cloudflare knows nothing about
Telegram, so after deploying both URLs must be registered once:

```bash
npm run telegram:setup        https://<worker>.<subdomain>.workers.dev
npm run telegram:setup:staff  https://<worker>.<subdomain>.workers.dev

npm run telegram:info
npm run telegram:info:staff
```

Register once and you are done. The Worker never sleeps, so the bots are up 24/7 —
unlike local development, which needs `npm run dev` **and** `npm run telegram:poll`
running side by side.

Register them against the custom domain, not the `workers.dev` hostname, so the
webhook URLs survive a rename of the Worker. Both work; only one should be in use, and
re-registering replaces the previous URL.

Three easy mistakes:

1. **Never** run `npm run telegram:poll` in production. That script calls
   `deleteWebhook` first, which deletes the production webhook and takes the bot
   offline. The script now refuses to start unless `NEXT_PUBLIC_APP_URL` is
   localhost.
2. If `TELEGRAM_WEBHOOK_SECRET` was not set when the webhook was registered, the
   setup script generates a random one. The Worker then rejects everything with
   **401**, because the secrets differ. Set the secret on the Worker first, then
   register the webhook.
3. A `pending_update_count` that refuses to fall, with
   `last_error_message: 500 Internal Server Error`, almost always means the
   **deployed Worker is older than the database schema** — old code asking for a
   column a newer migration dropped. Redeploy; pending updates drain by themselves.
   `last_error_date` stays populated after recovery, which is just stale metadata.

## Auto-deploy from GitHub

The GitHub repo is connected to Cloudflare, so **Workers Builds** can be used: push
to `main` → build → deploy, with no manual `npm run cf:deploy`.

Two things have to be in place first:

- **Build variables and secrets** must be filled in. The Next.js build needs
  `NEXT_PUBLIC_*` (to inline) and `SUPABASE_SERVICE_ROLE_KEY`.
- The Worker name in the dashboard must match `name` in `wrangler.jsonc`
  (`it-helpdesk`), or the build fails.

## Proactive notifications (not done)

Telegram notifications are currently *lazy*: they are only delivered when a user
messages the bot, because `flushNotifications` runs on the inbound path. To make
them genuinely proactive, add a Cron Trigger that calls:

```text
POST /api/telegram/dispatch
x-dispatch-secret: $DISPATCH_SECRET
```

A Cron Trigger needs a `scheduled()` handler on the Worker entrypoint, and
`.open-next/worker.js` is a generated file. So this needs a custom worker entry — not
built yet.

## Traps that have already bitten

**`timeout` does not exist on macOS.** Use `(cmd & echo $! > /tmp/x.pid)`, then
`kill $(cat /tmp/x.pid)`.

**Never `pkill -f "next-server"` blindly.** A machine usually has another project
running on its own port, and a blanket `pkill` takes it down too. Kill by an explicit
PID or port.

**`opennextjs-cloudflare deploy` fails without a local Hyperdrive connection
string**, with `UserError: When developing locally, you should use a local Postgres
connection string`. That is why deploys go through `npm run cf:deploy` rather than
the raw command.

**Ticket numbers may have gaps.** `npm run verify` creates tickets inside a
transaction that is rolled back, but `nextval` is still consumed. So `IT-000045` can
appear after `IT-000038` — normal, not a bug.

**`deploy` without `build` serves old code.** `opennextjs-cloudflare deploy` builds
nothing. If `.open-next` is not newer than `.next`, what gets deployed is the
previous version — and there is no warning at all. That is why `cf:deploy` always
builds first.
