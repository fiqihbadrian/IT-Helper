import { parseOptionalPriority, parseOptionalStatus, readJson } from "@/lib/api/body";
import { apiRouteWithParams } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { notFound } from "@/lib/api/errors";
import { findTicket, updateTicket } from "@/lib/api/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/tickets/IT-000004
 *
 * `not_found` covers "does not exist" and "not visible to you" alike — an
 * employee probing numbers cannot tell the two apart, which is the point.
 */
export const GET = apiRouteWithParams<{ number: string }>(async ({ db }, _request, params) => {
  const ticket = await findTicket(db, params.number);
  if (!ticket) throw notFound(`No ticket ${params.number}, or it is not visible to you.`);
  return jsonOk(ticket);
});

/**
 * PATCH /api/v1/tickets/IT-000004
 *
 * Status and priority changes are staff-only; the `tickets_update` RLS policy is
 * the enforcement, so an employee sending them simply matches no row.
 */
export const PATCH = apiRouteWithParams<{ number: string }>(
  async ({ db, identity }, request, params) => {
    const body = await readJson(request);

    const ticket = await updateTicket(db, params.number, identity, {
      status: parseOptionalStatus(body.status),
      priority: parseOptionalPriority(body.priority),
      categoryId:
        body.category_id === undefined
          ? undefined
          : body.category_id === null
            ? null
            : String(body.category_id),
      assignToMe: body.assign_to_me === true,
    });

    if (!ticket) {
      throw notFound(`No ticket ${params.number}, or your role cannot change it.`);
    }

    return jsonOk(ticket);
  },
);
