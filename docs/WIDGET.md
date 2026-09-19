# Web Widget (Phase 5)

A chat widget that can be pasted onto any website with one `<script>` line. Visitor
conversations become ordinary tickets in the same queue — not a separate system, not a
separate table, not a separate queue.

```
visitor on a third-party site
      │  POST /api/widget/v1/session
      ▼
  channels  ──►  tickets (source='widget', channel_id=…)
                   │
                   ├── ticket_contacts   visitor identity (name, email, IP)
                   ├── ticket_comments   the conversation itself
                   ├── ticket_history    audit trail
                   └── notifications     to the IT team, audience='staff'
```

---

## 1. Concepts

| Term | Meaning |
| --- | --- |
| **Channel** | One website that is allowed to embed the widget. Has a public key, a list of allowed origins, and ticket defaults. |
| **Public key** | `wk_…`. Sent to the browser and **genuinely public**. It names a channel; it does not grant access. |
| **Session token** | Issued once when a conversation starts. Stored in the visitor's `localStorage`; only its hash is on the server. |
| **Visitor** | Someone on a third-party website. **Never** becomes an account. |
| **System profile** | One machine profile per channel. Widget tickets are filed in its name. |

### The central decision: a visitor is not a user

The obvious way to build this is to create an account per visitor. That is wrong.
Visitors are not employees: they have no role and no department, they have no business
in `/admin/users`, and they must not appear in the "assign to" dropdown next to real
colleagues. Their numbers would also never go down, because — unlike an employee —
there is nobody who can deactivate them.

So each channel owns **one system profile** (`profiles.is_system = true`), and the
visitor's words are written in that profile's name. The visitor's real identity lives in
`ticket_contacts`, one row per external ticket.

The payoff:

- **RLS is not changed at all.** Widget requests go through the same `asUser()` as the
  Telegram bot and the REST API, so `tickets_insert` with `created_by = auth.uid()` is
  still satisfied and every policy works as written. There is no "anonymous" hole to
  audit.
- **Staff and visitors are still distinguishable without a new role.** A ticket with a
  `ticket_contacts` row is external, and `tickets.source` says where it came from.

The system profile has `is_active = true` (RLS requires it) and `is_system = true` — that
last column is what hides it from the user list, from the assignee dropdown, and from the
notification table.

---

## 2. Setup

### 2.1 Create a channel

Sign in as an admin → **Admin → Channels → New channel**.

| Field | Meaning |
| --- | --- |
| Name | Channel name; appears in the ticket title and on the timeline. |
| Accent colour | Colour of the launcher and the visitor's message bubbles. |
| Allowed origins | One origin per line, e.g. `https://example.com`. The scheme is optional — `https://` is added for you. |
| Greeting | The opening line inside the panel. |
| Default priority | Priority for new tickets from this channel. |
| Default category | Category for new tickets. |
| Department | Department for new tickets. |

Saving a channel does three things in one step:

1. creates an `auth.users` row with the email `<slug>@widget.local` and a random
   password that is never displayed,
2. creates a `profiles` row with `is_system = true`, `role = 'employee'`,
3. creates a `channels` row with its `wk_…` public key.

That account exists purely because `profiles.id` has a foreign key to `auth.users`. It
cannot be used to sign in.

### 2.2 Paste the snippet

The channel page shows a snippet ready to copy:

```html
<script src="https://<your-host>/widget.js" data-key="wk_…" async></script>
```

Put it just before `</body>`. The host in the snippet is taken from the origin you are
browsing, so the snippet is correct locally and in production without editing.

Optional attributes:

| Attribute | Default | Purpose |
| --- | --- | --- |
| `data-key` | — | **Required.** The channel's public key. |
| `data-base` | `widget.js`'s origin | API base URL. Useful when `widget.js` is served from another CDN. |

---

## 3. Conversation flow

1. The widget makes **no network request at all** until the visitor clicks the launcher.
   A page nobody uses costs nothing.
2. First click → `GET /config` → name, greeting, colour.
3. The visitor fills in name + email and types a message → `POST /session`:
   - one ticket with `source='widget'`, `channel_id=<channel>`, `created_by=<system profile>`
   - one `ticket_contacts` row (name, email, IP, user agent, page URL)
   - one opening comment
   - one `widget_sessions` row with the token's hash
   - one token returned **exactly once**
4. The widget stores the token in `localStorage` under `itw.token.<public key>`, then
   polls `GET /messages` every 4 seconds.
5. An IT reply appears as an ordinary comment on the same ticket. There is no special
   path: staff answer from the web ticket page like any other ticket.
6. The visitor replies → `POST /messages` → a new comment plus an `audience='staff'`
   notification to the whole bench.

If staff close the ticket (`CLOSED`) or mark it `RESOLVED`, the widget shows a notice and
disables the composer.

---

## 4. HTTP API

Base: `<host>/api/widget/v1`. Every response is `{ ok, data }` or
`{ ok, error: { code, message, details? } }`.

Headers:

| Header | When | Contents |
| --- | --- | --- |
| `X-Widget-Key` | Every request | The channel's public key |
| `X-Widget-Token` | `/messages` | The session token |
| `Origin` | Set by the browser | Checked against `allowed_origins` |

### `GET /config`

```bash
curl -H "Origin: https://example.com" \
     -H "X-Widget-Key: wk_…" \
     https://<host>/api/widget/v1/config
```

```json
{ "ok": true, "data": { "name": "Demo Site", "greeting": "Hi! How can we help?", "accentColor": "#0ea5e9" } }
```

### `POST /session`

```bash
curl -X POST https://<host>/api/widget/v1/session \
  -H "Origin: https://example.com" \
  -H "X-Widget-Key: wk_…" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dewi Lestari",
    "email": "dewi@example.com",
    "message": "The printer on floor 3 will not print.",
    "visitorRef": "v-abc123",
    "pageUrl": "https://example.com/contact"
  }'
```

`201` with `{ token, conversation, messages }`. `token` is never shown again.

### `GET /messages`

```bash
curl "https://<host>/api/widget/v1/messages?since=2026-09-19T00:00:00Z" \
  -H "Origin: https://example.com" \
  -H "X-Widget-Key: wk_…" \
  -H "X-Widget-Token: <token>"
```

`since` is optional (ISO 8601). The ticket is **never** taken from the request — always
from the `widget_sessions` row.

### `POST /messages`

```bash
curl -X POST https://<host>/api/widget/v1/messages \
  -H "Origin: https://example.com" \
  -H "X-Widget-Key: wk_…" \
  -H "X-Widget-Token: <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Any update?"}'
```

### Errors

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Body is not JSON, name/email/message invalid, `since` malformed |
| 401 | `unauthorized` | `X-Widget-Key` missing or unknown, or the token is missing or expired |
| 403 | `forbidden` | Origin not allowed, channel switched off, or the token belongs to another channel |
| 429 | `rate_limited` | Too many messages or conversations |
| 500 | `internal_error` | Unexpected failure |

---

## 5. Security

**The public key is public.** Anyone who opens View Source can read it. So
`allowed_origins` is not a wall — it is a speed bump that keeps honest people honest.
What actually protects the widget:

| Mechanism | Detail |
| --- | --- |
| **Session binding** | One `widget_sessions` row is bound to **exactly one** `ticket_id`. `GET /messages` reads that column and never a request parameter. There is no ticket to name, so there is nothing to guess. |
| **Origin check** | An empty `allowed_origins` = **deny everything** (fail closed). `"*"` = allow anything. |
| **Per-IP rate limit** | At most 15 new conversations per hour per IP, counted from `ticket_contacts.visitor_ip`. |
| **Per-ticket rate limit** | At most 20 messages per minute per ticket, counted from `ticket_comments`. |
| **Message length cap** | 4000 characters. |
| **One-way token** | Stored as sha256; a database dump contains nothing that can be replayed. |
| **Expiry** | Tokens last 30 days. |

Rate limits are counted **in the database**, not in Worker memory. Cloudflare isolate
memory is per-isolate and short-lived — an in-memory counter can be bypassed just by
triggering a cold start. Row counts cannot.

`clientIp()` prefers `cf-connecting-ip` (set by Cloudflare, not forgeable) and falls back
to `x-forwarded-for` only during development.

### If a key leaks

Do not delete the channel — **switch it off**. A deactivated channel rejects every request
immediately, while all its tickets and history stay intact for audit. Deleting a channel
that already has tickets is blocked by a foreign key, and that is deliberate.

---

## 6. Limitations of this version

- **Text only.** Visitors cannot send attachments. A widget ticket can still be given
  files by staff from the ticket page.
- **No Turnstile yet.** If a channel starts being abused, the next step is adding
  Turnstile verification to `POST /session`.
- **No realtime notifications.** The widget polls every 4 seconds; there is no WebSocket.
  Enough for helpdesk conversations, and far cheaper.
- **One conversation per visitor per channel.** The token in `localStorage` binds one
  active conversation; clearing storage means starting a new one.

---

## 7. Related files

| File | Contents |
| --- | --- |
| `supabase/migrations/0010_channels.sql` | `channels`, `ticket_contacts`, `widget_sessions` tables, `notify()`, `ticket_actor_name()`, RLS |
| `lib/widget/keys.ts` | Public key + session token generation, hashing, header reading |
| `lib/widget/channels.ts` | Resolving a channel from its key, origin checking |
| `lib/widget/cors.ts` | CORS, route wrapper, preflight |
| `lib/widget/rate.ts` | Message and conversation rate limits, IP detection |
| `lib/widget/sessions.ts` | Find / touch / create a session |
| `lib/widget/conversations.ts` | Create the ticket, append a message, read the conversation |
| `app/api/widget/v1/**` | HTTP routes |
| `public/widget.js` | The browser-side widget (vanilla, shadow DOM, no dependencies) |
| `services/channels.ts` | Channel list + ticket counts |
| `app/actions/channels.ts` | Server actions for create / update / toggle / delete |
| `components/admin/ChannelManager.tsx` | Admin UI |

---

## 8. Quick test

```bash
# 1. config
curl -s -H "Origin: https://example.com" -H "X-Widget-Key: wk_…" \
  http://localhost:3000/api/widget/v1/config

# 2. start a conversation
TOKEN=$(curl -s -X POST http://localhost:3000/api/widget/v1/session \
  -H "Origin: https://example.com" -H "X-Widget-Key: wk_…" \
  -H "Content-Type: application/json" \
  -d '{"name":"Dewi","email":"dewi@example.com","message":"Hello"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")

# 3. read it back
curl -s -H "Origin: https://example.com" -H "X-Widget-Key: wk_…" \
  -H "X-Widget-Token: $TOKEN" http://localhost:3000/api/widget/v1/messages
```

Also check **Admin → Channels** for the per-channel ticket counts, and **Tickets → All**,
where the new ticket appears with a `via widget` badge and the visitor's name.

`npm run verify` closes with 18 widget checks at the database level (no running server
needed): the machine profile can be created, `source` and `channel_id` must agree,
`notify()` skips machine profiles, the visitor's name surfaces through
`ticket_actor_name()`, RLS on `ticket_contacts` and `widget_sessions`, and a channel with
tickets cannot be deleted.

What automated tests do **not** cover: the four server actions in
`app/actions/channels.ts`. They are all thin — `assertAdmin()`, zod validation, then a
query — and were verified by hand once (create, update, switch off, delete, plus the
refusal to delete once a ticket exists).
