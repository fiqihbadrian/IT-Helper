import { badRequest, forbidden, unauthorized } from "@/lib/api/errors";
import { widgetJson, widgetPreflight, widgetRoute } from "@/lib/widget/cors";
import { appendVisitorMessage, listMessages, readMessage } from "@/lib/widget/conversations";
import { readSessionToken } from "@/lib/widget/keys";
import { findSession, touchSession, type WidgetSession } from "@/lib/widget/sessions";
import type { WidgetChannel } from "@/lib/widget/channels";

/**
 * Read and reply to one conversation.
 *
 * Both verbs take the ticket from the session row, never from the request. The
 * widget never learns a ticket id and has no way to name one, so a visitor
 * cannot read a conversation that is not theirs by guessing — there is nothing
 * to guess.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A token is minted for one channel. Presenting it alongside a *different*
 * channel's public key means someone has copied a token off another site, so it
 * is refused rather than quietly honoured.
 */
async function requireSession(
  channel: WidgetChannel,
  request: Request,
): Promise<WidgetSession> {
  const token = readSessionToken(request);
  if (!token) throw unauthorized("No conversation token. Start a chat first.");

  const session = await findSession(token);
  if (!session) throw unauthorized("This conversation has expired. Please start a new one.");
  if (session.channelId !== channel.id) throw forbidden("This token belongs to another channel.");

  return session;
}

function readSince(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest("`since` must be an ISO timestamp.");
  return date.toISOString();
}

export const GET = widgetRoute(async ({ channel }, request) => {
  const session = await requireSession(channel, request);
  const since = readSince(new URL(request.url).searchParams.get("since"));

  const payload = await listMessages({ channel, ticketId: session.ticketId, since });
  await touchSession(session.id);

  return widgetJson(payload);
});

export const POST = widgetRoute(async ({ channel }, request) => {
  const session = await requireSession(channel, request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("Body must be valid JSON.");
  }

  const message = readMessage((body as Record<string, unknown> | null)?.message);

  await appendVisitorMessage({ channel, ticketId: session.ticketId, message });

  const payload = await listMessages({ channel, ticketId: session.ticketId });
  await touchSession(session.id);

  return widgetJson(payload, { status: 201 });
});

export const OPTIONS = widgetPreflight;
