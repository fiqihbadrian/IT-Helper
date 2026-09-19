import "server-only";

import type { Queryable } from "@/lib/db/pool";
import { badRequest, forbidden } from "@/lib/api/errors";
import type { TicketPriority, TicketSource, TicketStatus } from "@/types";

/**
 * Query helpers for the REST API. They take an already-impersonated connection
 * (see `withIdentity` in lib/api/auth.ts), so nothing here decides who may read
 * what — RLS does. The only checks in this file are the ones RLS cannot express,
 * like "a caller may not file a ticket on someone else's behalf".
 */

export interface ApiTicket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  /** Which surface filed the ticket: web, telegram, api or widget. */
  source: TicketSource;
  category: string | null;
  category_id: string | null;
  requester: { id: string; full_name: string; email: string } | null;
  assignee: { id: string; full_name: string; email: string } | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
}

/**
 * Every ticket payload carries the requester's email, because API consumers
 * (scripts, AI tools, the Telegram bot) routinely need to map a ticket back to a
 * person without a second lookup.
 */
const SELECT_TICKET = `
  select
    t.id,
    t.ticket_number,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.source,
    t.category_id,
    c.name as category,
    t.created_at,
    t.updated_at,
    t.resolved_at,
    t.closed_at,
    json_build_object('id', r.id, 'full_name', r.full_name, 'email', r.email) as requester,
    case when a.id is null then null
         else json_build_object('id', a.id, 'full_name', a.full_name, 'email', a.email)
    end as assignee
  from public.tickets t
  left join public.categories c on c.id = t.category_id
  left join public.profiles r on r.id = t.created_by
  left join public.profiles a on a.id = t.assigned_to
`;

export interface ListFilters {
  status?: TicketStatus | null;
  priority?: TicketPriority | null;
  categoryId?: string | null;
  search?: string | null;
  limit: number;
  offset: number;
}

export async function listTickets(db: Queryable, filters: ListFilters) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`t.status = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    where.push(`t.priority = $${params.length}`);
  }
  if (filters.categoryId) {
    params.push(filters.categoryId);
    where.push(`t.category_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(t.title ilike $${params.length} or t.description ilike $${params.length})`);
  }

  const clause = where.length ? `where ${where.join(" and ")}` : "";

  const countParams = [...params];
  params.push(filters.limit, filters.offset);

  const { rows } = await db.query<ApiTicket & { total: number }>(
    `with filtered as (
       ${SELECT_TICKET} ${clause}
     )
     select *, (select count(*) from filtered)::int as total
       from filtered
      order by updated_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  const total = rows[0]?.total ?? 0;
  const items = rows.map(({ total: _total, ...ticket }) => ticket);

  // No rows means either "nothing matched" or "nothing visible to you" — RLS
  // makes those indistinguishable, so ask the unfiltered view which it is.
  if (!rows.length && (clause || filters.offset > 0)) {
    const fallback = await db.query<{ total: number }>(
      `with filtered as (${SELECT_TICKET} ${clause}) select count(*)::int as total from filtered`,
      countParams,
    );
    return { items, total: fallback.rows[0]?.total ?? 0 };
  }

  return { items, total };
}

export async function findTicket(db: Queryable, number: string) {
  const { rows } = await db.query<ApiTicket>(
    `${SELECT_TICKET} where upper(t.ticket_number) = upper($1) limit 1`,
    [number],
  );
  return rows[0] ?? null;
}

export async function findTicketById(db: Queryable, id: string) {
  const { rows } = await db.query<ApiTicket>(`${SELECT_TICKET} where t.id = $1`, [id]);
  return rows[0] ?? null;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  priority?: TicketPriority | null;
  categoryId?: string | null;
  requesterEmail?: string | null;
}

export async function createTicket(
  db: Queryable,
  identity: { userId: string; email: string },
  input: CreateTicketInput,
) {
  // RLS forces `created_by = auth.uid()`, so a mismatched email is a caller
  // mistake worth naming rather than a silent override.
  if (
    input.requesterEmail &&
    input.requesterEmail.toLowerCase() !== identity.email.toLowerCase()
  ) {
    throw forbidden(
      `An API key can only file tickets for its own account (${identity.email}).`,
    );
  }

  const { rows } = await db.query<{ id: string }>(
    `insert into public.tickets (title, description, category_id, priority, created_by, source)
     values ($1, $2, $3, $4, $5, 'api')
     returning id`,
    [
      input.title,
      input.description,
      input.categoryId ?? null,
      input.priority ?? "MEDIUM",
      identity.userId,
    ],
  );

  return findTicketById(db, rows[0].id);
}

export interface UpdateTicketInput {
  status?: TicketStatus | null;
  priority?: TicketPriority | null;
  categoryId?: string | null;
  assignToMe?: boolean;
}

export async function updateTicket(
  db: Queryable,
  number: string,
  identity: { userId: string },
  input: UpdateTicketInput,
) {
  const sets: string[] = [];
  const params: unknown[] = [number];

  if (input.status) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }
  if (input.priority) {
    params.push(input.priority);
    sets.push(`priority = $${params.length}`);
  }
  if (input.categoryId !== undefined) {
    params.push(input.categoryId);
    sets.push(`category_id = $${params.length}`);
  }
  if (input.assignToMe) {
    params.push(identity.userId);
    sets.push(`assigned_to = $${params.length}`);
  }

  if (!sets.length) throw badRequest("Nothing to update. Send status, priority, category_id or assign_to_me.");

  const { rows } = await db.query<{ id: string }>(
    `update public.tickets set ${sets.join(", ")}
      where upper(ticket_number) = upper($1)
      returning id`,
    params,
  );

  if (!rows.length) return null;
  return findTicketById(db, rows[0].id);
}

export interface ApiComment {
  id: string;
  message: string;
  author: { id: string; full_name: string; email: string; role: string } | null;
  is_staff: boolean;
  created_at: string;
}

export async function listComments(db: Queryable, ticketId: string) {
  const { rows } = await db.query<ApiComment>(
    `select
       c.id,
       c.message,
       c.created_at,
       json_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email,
                         'role', p.role) as author,
       coalesce(p.role in ('it_support', 'admin'), false) as is_staff
     from public.ticket_comments c
     left join public.profiles p on p.id = c.user_id
     where c.ticket_id = $1
     order by c.created_at asc`,
    [ticketId],
  );
  return rows;
}

export async function addComment(
  db: Queryable,
  ticketId: string,
  userId: string,
  message: string,
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.ticket_comments (ticket_id, user_id, message)
     values ($1, $2, $3) returning id`,
    [ticketId, userId, message],
  );
  return rows[0];
}

export async function listCategories(db: Queryable) {
  const { rows } = await db.query<{ id: string; name: string; description: string | null }>(
    `select id, name, description from public.categories where is_active = true order by name`,
  );
  return rows;
}

export async function listDepartments(db: Queryable) {
  const { rows } = await db.query<{ id: string; name: string }>(
    `select id, name from public.departments order by name`,
  );
  return rows;
}

export async function ticketStats(db: Queryable) {
  const { rows } = await db.query<{ ticket_stats: unknown }>("select public.ticket_stats() as ticket_stats");
  return rows[0]?.ticket_stats ?? null;
}
