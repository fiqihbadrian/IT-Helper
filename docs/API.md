# REST API v1

An API for other systems: scripts, cron jobs, internal integrations, or AI tools. Every
endpoint works on the same data and the same access rules as the web app — it is not a
copy of the logic.

## Authentication

Any user can create an API key under **Profile → API Keys**.

```http
Authorization: Bearer itk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`X-API-Key` is accepted too, for clients that are not comfortable using the
Authorization header.

The key is shown **once**, at creation. The database stores only its SHA-256 hash and
the first 12 characters as a label, so a lost key cannot be recovered — create a new
one and revoke the old one.

### A key inherits its owner's identity

This is the most important part of the design. A key is not a super-account: every
request runs as the key's owner inside a single Postgres transaction, with
`set local role authenticated` and a `sub` claim holding the owner's id. So `auth.uid()`
returns the right person, and **every RLS policy still applies**.

| Key belongs to | Can | Cannot |
| --- | --- | --- |
| `employee` | see and create their own tickets, comment on their own tickets | see other people's tickets, change status, read the directory |
| `it_support` | see all tickets, change status/priority, claim tickets, see all profiles | manage users |
| `admin` | everything, including deleting tickets | — |

The consequence: if an access rule changes in SQL, the API changes with it and no
deploy is needed. There is no separate permission list that can drift from the
database.

## Response format

Success:

```json
{ "ok": true, "data": { } }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "bad_request",
    "message": "Unknown status \"NOPE\".",
    "details": { "allowed": ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"] }
  }
}
```

Error codes: `bad_request` (400), `unauthorized` (401), `forbidden` (403),
`not_found` (404), `internal_error` (500).

`not_found` deliberately means both "does not exist" **and** "not yours". If an
employee guesses ticket numbers, the answer must not leak whose tickets exist.

## Endpoints

### `GET /api/v1`

Self-describing: the endpoint list, the valid enum values, and example payloads. A good
first call for a tool that knows nothing yet.

### `GET /api/v1/me`

The caller's identity, permissions and ticket summary. The first call any integration
should make, so it can fail fast when the key has the wrong role.

```json
{
  "ok": true,
  "data": {
    "id": "44444444-4444-4444-8444-444444444444",
    "email": "employee1@helpdesk.test",
    "full_name": "Budi Santoso",
    "role": "employee",
    "department": "Finance",
    "telegram": { "employee": false, "staff": false },
    "api_key": { "id": "…", "name": "Report bot" },
    "permissions": {
      "create_ticket": true,
      "view_all_tickets": false,
      "change_status": false,
      "manage_users": false
    },
    "stats": { "open": 1, "total": 5, "…": 0 }
  }
}
```

### `GET /api/v1/meta`

Active categories, departments and the stat counters — all in one request, so a client
form does not need three round trips.

### `GET /api/v1/users`

The directory, bounded by RLS: an employee sees themselves and the people involved in
their tickets (an agent's name has to be readable), staff see everyone.

| Query | Meaning |
| --- | --- |
| `role` | `employee`, `it_support`, `admin` |
| `q` | search name or email |
| `active=all` | include deactivated accounts |
| `page`, `limit` | pagination, `limit` capped at 100 |

### `GET /api/v1/tickets`

| Query | Meaning |
| --- | --- |
| `status` | `OPEN`, `ASSIGNED`, `IN_PROGRESS`, `WAITING_USER`, `RESOLVED`, `CLOSED` |
| `priority` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `category_id` | category UUID |
| `q` | search title and description |
| `page`, `limit` | pagination, default 25, capped at 100 |

Enum values are case-insensitive; a wrong one is answered with the list of correct ones.

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "…",
        "ticket_number": "IT-000004",
        "title": "Server is unreachable",
        "status": "OPEN",
        "priority": "CRITICAL",
        "category": "Server",
        "requester": { "id": "…", "full_name": "Budi Santoso", "email": "employee1@helpdesk.test" },
        "assignee": null,
        "created_at": "2026-09-18T12:31:59.000Z",
        "updated_at": "2026-09-18T12:31:59.000Z",
        "resolved_at": null,
        "closed_at": null
      }
    ],
    "pagination": { "page": 1, "limit": 25, "total": 5, "pages": 1 }
  }
}
```

`total` is the count **within the caller's reach**, not the number of tickets in the
system. An employee sees the total of their own tickets; staff see the queue total.

The requester's email is always included — that is the identity an outside system needs
to map a ticket back to a person, with no second lookup.

### `POST /api/v1/tickets`

```json
{
  "title": "Printer on floor 3 is offline",
  "description": "Has shown offline since this morning; restarted it, still the same.",
  "priority": "HIGH",
  "category_id": "b709434d-…",
  "requester_email": "employee1@helpdesk.test"
}
```

`title` is at least 4 characters, `description` at least 10. `priority` defaults to
`MEDIUM`.

`requester_email` may be supplied as a statement of identity; if it does not match the
key's owner, the request is rejected with `403`. RLS forces `created_by = auth.uid()`, so
a ticket in someone else's name is impossible anyway — the field exists so the mistake
gets a name instead of failing silently.

Side effects happen automatically: the `IT-0000xx` number is allocated, a
`ticket_history` row is written, and notifications go out — all through the same
triggers as a ticket created in the web app.

### `GET /api/v1/tickets/{number}`

The ticket number, not a UUID: `IT-000004`. The UUID is still in the payload, for use as
a foreign key in other systems.

### `PATCH /api/v1/tickets/{number}`

```json
{ "status": "IN_PROGRESS", "assign_to_me": true }
```

Fields: `status`, `priority`, `category_id`, `assign_to_me`. Only staff may change
these; an employee who tries gets a `404`, because the row is not updatable by them —
not because the handler contains a special check.

### `GET|POST /api/v1/tickets/{number}/comments`

```json
{ "message": "Checked it — the HDMI cable was loose." }
```

A comment from the API fires the same notifications as a comment from the web app,
because the side effects live in the trigger.

## Examples

```bash
KEY=itk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# who am I
curl -s -H "Authorization: Bearer $KEY" https://helpdesk.example.com/api/v1/me

# my open tickets
curl -s -H "Authorization: Bearer $KEY" \
  "https://helpdesk.example.com/api/v1/tickets?status=OPEN&limit=10"

# create a ticket
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Printer on floor 3 is offline","description":"Offline since this morning.","priority":"HIGH"}' \
  https://helpdesk.example.com/api/v1/tickets

# reply
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"message":"Tried again, still the same."}' \
  https://helpdesk.example.com/api/v1/tickets/IT-000004/comments
```

## Wiring up an AI tool

The pattern that works: one key per integration, with an obvious name.

1. Create a key under **Profile → API Keys**, named something like `n8n workflow` or
   `claude desktop`.
2. Store it as a secret on the tool's side.
3. Have the tool call `GET /api/v1` first — the endpoint descriptions and example
   payloads are right there, so there is no need to paste documentation into a prompt.
4. Call `GET /api/v1/me` to learn its role, then use the endpoints its permissions allow.

An employee key is enough to open and reply to your own tickets, so a personal bot does
not need to be given staff rights.

## Breaking change

**`telegram_linked` → `telegram: { employee, staff }`.** The system has had two Telegram
bots since `0009_two_bots.sql` — one for employees, one for the IT team — and a single
boolean cannot express "linked to which one". The old field was removed rather than kept
as an alias, so an integration that has not caught up fails fast and loudly instead of
quietly reading the wrong thing.

## Revoking

Revoke a key at any time under **Profile → API Keys**, or from the server:

```sql
select public.revoke_api_key('<uuid>');
```

A revoked key stops working immediately — `verify_api_key()` returns nothing, so the
next request is answered with `401`. The `last_used_at` column is updated on every use,
so keys that are never used can be identified.

## Files

```
lib/api/errors.ts                  error types + codes
lib/api/auth.ts                    key verification, impersonation, roles
lib/api/handler.ts                 route wrapper + transaction
lib/api/response.ts                response format, pagination
lib/api/body.ts                    body and enum parsing
lib/api/tickets.ts                 ticket queries as a user
app/api/v1/route.ts                self-documentation
app/api/v1/me/route.ts             caller identity
app/api/v1/meta/route.ts           categories, departments, stats
app/api/v1/users/route.ts          directory
app/api/v1/tickets/route.ts        list + create
app/api/v1/tickets/[number]/…      detail, update, comments
supabase/migrations/0006_api_keys.sql  key table + issue/verify/revoke functions
```
