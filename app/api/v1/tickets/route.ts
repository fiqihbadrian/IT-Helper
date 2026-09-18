import { badRequest } from "@/lib/api/errors";
import { parseOptionalPriority, parseOptionalStatus, readJson } from "@/lib/api/body";
import { apiRoute } from "@/lib/api/handler";
import { jsonOk, readPagination } from "@/lib/api/response";
import { createTicket, listTickets } from "@/lib/api/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/tickets
 *
 * Returns only what the key's owner is allowed to see — RLS decides, not this
 * handler. `total` is the count *within that visibility*, so an employee sees
 * their own ticket count while support sees the whole queue.
 */
export const GET = apiRoute(async ({ db }, request) => {
  const url = new URL(request.url);
  const { limit, page, offset } = readPagination(url);

  const { items, total } = await listTickets(db, {
    status: parseOptionalStatus(url.searchParams.get("status")),
    priority: parseOptionalPriority(url.searchParams.get("priority")),
    categoryId: url.searchParams.get("category_id"),
    search: url.searchParams.get("q"),
    limit,
    offset,
  });

  return jsonOk({
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
});

/** POST /api/v1/tickets — file a ticket as the key's owner. */
export const POST = apiRoute(async ({ db, identity }, request) => {
  const body = await readJson(request);

  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();

  if (title.length < 4) throw badRequest("`title` must be at least 4 characters.");
  if (title.length > 160) throw badRequest("`title` must be at most 160 characters.");
  if (description.length < 10) throw badRequest("`description` must be at least 10 characters.");

  const ticket = await createTicket(db, identity, {
    title,
    description,
    priority: parseOptionalPriority(body.priority),
    categoryId: body.category_id ? String(body.category_id) : null,
    requesterEmail: body.requester_email ? String(body.requester_email) : null,
  });

  return jsonOk(ticket, { status: 201 });
});
