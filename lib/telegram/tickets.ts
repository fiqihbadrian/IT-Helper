import "server-only";

import { asSystem, asUser, type Queryable } from "@/lib/db/pool";
import type { TicketPriority, TicketStatus } from "@/types";

/**
 * Ticket operations performed *as the Telegram user*. The bot never uses its own
 * privileges for these: it impersonates the linked profile, so RLS decides what
 * is visible. An employee cannot reach another employee's ticket through the bot
 * any more than through the web app.
 */

export interface BotTicketRow {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
  category: string | null;
  assignee: string | null;
  requester: string | null;
}

const SELECT_TICKET = `
  select
    t.id,
    t.ticket_number,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.created_at,
    t.updated_at,
    (select c.name from public.categories c where c.id = t.category_id) as category,
    (select p.full_name from public.profiles p where p.id = t.assigned_to) as assignee,
    (select p.full_name from public.profiles p where p.id = t.created_by) as requester
  from public.tickets t
`;

/**
 * Read one ticket on an already-authenticated connection.
 *
 * Takes a `db` rather than a `userId` so callers that are mid-transaction —
 * `createTicket` right after its INSERT — can reuse the same connection.
 * Calling `asUser` again from inside `asUser` would check out a *second* pooled
 * connection, which cannot see the uncommitted row and would silently return
 * nothing.
 */
async function selectTicket(db: Queryable, where: string, params: unknown[]) {
  const { rows } = await db.query<BotTicketRow>(`${SELECT_TICKET} where ${where}`, params);
  return rows[0] ?? null;
}

export async function listCategories() {
  return asSystem(async (db) => {
    const { rows } = await db.query<{ id: string; name: string }>(
      `select id, name from public.categories where is_active = true order by name`,
    );
    return rows;
  });
}

export async function createTicket(
  userId: string,
  input: {
    title: string;
    description: string;
    categoryId: string | null;
    priority: TicketPriority;
  },
) {
  return asUser(userId, async (db) => {
    // Insert and read back in two statements on purpose. Folding them into one
    // data-modifying CTE looks tidier but silently returns zero rows: the
    // sub-statements of a WITH share the snapshot taken when the statement
    // began, so the outer SELECT cannot see the row the CTE just inserted.
    const { rows } = await db.query<{ id: string }>(
      `insert into public.tickets (title, description, category_id, priority, created_by)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [input.title, input.description, input.categoryId, input.priority, userId],
    );

    return selectTicket(db, "t.id = $1", [rows[0].id]);
  });
}

export async function listMyTickets(userId: string, limit = 10) {
  return asUser(userId, async (db) => {
    const { rows } = await db.query<BotTicketRow>(
      `${SELECT_TICKET} order by t.updated_at desc limit $1`,
      [limit],
    );
    return rows;
  });
}

export async function findTicketById(userId: string, ticketId: string) {
  return asUser(userId, (db) => selectTicket(db, "t.id = $1", [ticketId]));
}

export async function findTicketByNumber(userId: string, number: string) {
  return asUser(userId, (db) =>
    selectTicket(db, "upper(t.ticket_number) = upper($1) limit 1", [number]),
  );
}

/* -------------------------------------------------------------------------- */
/* Staff queue                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a staff member can ask to see. None of these filters grant anything:
 * the `tickets_select` policy already decides that only staff can read tickets
 * they did not raise, so an employee running `/queue` simply gets their own
 * rows back.
 */
export type StaffQueue = "all" | "open" | "unassigned" | "mine";

const QUEUE_FILTER: Record<StaffQueue, string> = {
  all: "true",
  open: "t.status not in ('RESOLVED', 'CLOSED')",
  unassigned: "t.assigned_to is null and t.status not in ('RESOLVED', 'CLOSED')",
  mine: "t.assigned_to = $2",
};

export async function listQueue(userId: string, queue: StaffQueue, limit = 10) {
  return asUser(userId, async (db) => {
    const filter = QUEUE_FILTER[queue];
    const params: unknown[] = queue === "mine" ? [limit, userId] : [limit];

    const { rows } = await db.query<BotTicketRow>(
      `${SELECT_TICKET} where ${filter} order by t.updated_at desc limit $1`,
      params,
    );
    return rows;
  });
}

/** Matches on ticket number or title; RLS still decides what is reachable. */
export async function searchTickets(userId: string, query: string, limit = 10) {
  return asUser(userId, async (db) => {
    const { rows } = await db.query<BotTicketRow>(
      `${SELECT_TICKET}
        where t.ticket_number ilike $2 or t.title ilike $2
        order by t.updated_at desc
        limit $1`,
      [limit, `%${query}%`],
    );
    return rows;
  });
}

/* -------------------------------------------------------------------------- */
/* Actions addressed by ticket number                                          */
/* -------------------------------------------------------------------------- */

/**
 * Each of these does its lookup and its write in a *single* transaction, so the
 * row it just changed is the row it reads back. Splitting them into
 * `findTicketByNumber` + a separate mutation would nest `asUser` inside
 * `asUser` and the read-back would see nothing.
 */
export async function commentByNumber(userId: string, number: string, message: string) {
  return asUser(userId, async (db) => {
    const ticket = await selectTicket(db, "upper(t.ticket_number) = upper($1) limit 1", [number]);
    if (!ticket) return null;

    await db.query(
      `insert into public.ticket_comments (ticket_id, user_id, message) values ($1, $2, $3)`,
      [ticket.id, userId, message],
    );

    return ticket;
  });
}

/** Staff-only in practice: `tickets_update` requires `is_staff()`. */
export async function claimByNumber(userId: string, number: string) {
  return asUser(userId, async (db) => {
    const ticket = await selectTicket(db, "upper(t.ticket_number) = upper($1) limit 1", [number]);
    if (!ticket) return null;

    const { rows } = await db.query<{ id: string }>(
      `update public.tickets set assigned_to = $2 where id = $1 returning id`,
      [ticket.id, userId],
    );
    if (!rows[0]) return null;

    return selectTicket(db, "t.id = $1", [ticket.id]);
  });
}

/** Staff-only in practice: `tickets_update` requires `is_staff()`. */
export async function setStatusByNumber(
  userId: string,
  number: string,
  status: TicketStatus,
) {
  return asUser(userId, async (db) => {
    const ticket = await selectTicket(db, "upper(t.ticket_number) = upper($1) limit 1", [number]);
    if (!ticket) return null;

    const { rows } = await db.query<{ id: string }>(
      `update public.tickets set status = $2 where id = $1 returning id`,
      [ticket.id, status],
    );
    if (!rows[0]) return null;

    return selectTicket(db, "t.id = $1", [ticket.id]);
  });
}

export interface BotComment {
  author: string;
  is_staff: boolean;
  message: string;
  created_at: string;
}

export async function listComments(userId: string, ticketId: string, limit = 4) {
  return asUser(userId, async (db) => {
    const { rows } = await db.query<BotComment>(
      `select
         coalesce(p.full_name, 'Unknown') as author,
         coalesce(p.role in ('it_support', 'admin'), false) as is_staff,
         c.message,
         c.created_at
       from public.ticket_comments c
       left join public.profiles p on p.id = c.user_id
       where c.ticket_id = $1
       order by c.created_at desc
       limit $2`,
      [ticketId, limit],
    );
    return rows.reverse();
  });
}

export async function addComment(userId: string, ticketId: string, message: string) {
  return asUser(userId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.ticket_comments (ticket_id, user_id, message)
       values ($1, $2, $3) returning id`,
      [ticketId, userId, message],
    );
    return rows[0];
  });
}

/** Staff-only; the `tickets_update_staff` RLS policy is the actual enforcement. */
export async function updateTicketStatus(
  userId: string,
  ticketId: string,
  status: TicketStatus,
) {
  return asUser(userId, async (db) => {
    const { rows } = await db.query<{ id: string; status: TicketStatus }>(
      `update public.tickets set status = $2 where id = $1 returning id, status`,
      [ticketId, status],
    );
    return rows[0] ?? null;
  });
}

export async function claimTicket(userId: string, ticketId: string) {
  return asUser(userId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `update public.tickets set assigned_to = $2 where id = $1 returning id`,
      [ticketId, userId],
    );
    return rows[0] ?? null;
  });
}

/* -------------------------------------------------------------------------- */
/* Notification fan-out                                                        */
/* -------------------------------------------------------------------------- */

export interface PendingNotification {
  id: string;
  title: string;
  message: string;
  ticket_id: string | null;
  ticket_number: string | null;
}

/** Queued by the `notifications_queue_delivery` trigger in 0007. */
export async function pendingNotifications(chatId: number, limit = 10) {
  return asSystem(async (db) => {
    const { rows } = await db.query<PendingNotification>(
      `select n.id, n.title, n.message, n.ticket_id, t.ticket_number
         from public.notification_deliveries d
         join public.notifications n on n.id = d.notification_id
         join public.profiles p on p.id = n.user_id
         left join public.tickets t on t.id = n.ticket_id
        where d.channel = 'telegram'
          and d.status = 'PENDING'
          and p.telegram_user_id = $1
          and p.is_active = true
        order by n.created_at asc
        limit $2`,
      [chatId, limit],
    );
    return rows;
  });
}

export async function markDeliveries(ids: string[], error?: string) {
  if (!ids.length) return;
  return asSystem(async (db) => {
    await db.query(
      `update public.notification_deliveries
          set status = $2,
              attempts = attempts + 1,
              last_error = $3,
              sent_at = case when $2 = 'SENT' then now() else null end
        where notification_id = any($1::uuid[]) and channel = 'telegram'`,
      [ids, error ? "FAILED" : "SENT", error ?? null],
    );
  });
}

export function ticketKeyboard(tickets: BotTicketRow[], prefix = "t") {
  return tickets.map((ticket) => [
    {
      text: `${ticket.ticket_number} · ${ticket.title.slice(0, 30)}`,
      callback_data: `${prefix}:${ticket.id}`,
    },
  ]);
}

export type { Queryable };
