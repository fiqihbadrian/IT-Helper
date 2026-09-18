import { badRequest } from "@/lib/api/errors";
import { readJson } from "@/lib/api/body";
import { apiRouteWithParams } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { notFound } from "@/lib/api/errors";
import { addComment, findTicket, listComments } from "@/lib/api/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/tickets/IT-000004/comments */
export const GET = apiRouteWithParams<{ number: string }>(async ({ db }, _request, params) => {
  const ticket = await findTicket(db, params.number);
  if (!ticket) throw notFound(`No ticket ${params.number}, or it is not visible to you.`);

  return jsonOk({
    ticket_number: ticket.ticket_number,
    items: await listComments(db, ticket.id),
  });
});

/**
 * POST /api/v1/tickets/IT-000004/comments
 *
 * Posting a comment also notifies the other side, because that side effect lives
 * in a database trigger — an API comment behaves exactly like one typed in the
 * browser.
 */
export const POST = apiRouteWithParams<{ number: string }>(
  async ({ db, identity }, request, params) => {
    const ticket = await findTicket(db, params.number);
    if (!ticket) throw notFound(`No ticket ${params.number}, or it is not visible to you.`);

    const body = await readJson(request);
    const message = String(body.message ?? "").trim();
    if (!message) throw badRequest("`message` is required.");
    if (message.length > 5000) throw badRequest("`message` must be at most 5000 characters.");

    const comment = await addComment(db, ticket.id, identity.userId, message);
    const [created] = (await listComments(db, ticket.id)).filter(
      (item) => item.id === comment.id,
    );

    return jsonOk(created ?? null, { status: 201 });
  },
);
