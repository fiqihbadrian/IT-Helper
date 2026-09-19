import { badRequest } from "@/lib/api/errors";
import { widgetJson, widgetPreflight, widgetRoute } from "@/lib/widget/cors";
import {
  createConversation,
  listMessages,
  readContact,
  readMessage,
} from "@/lib/widget/conversations";
import { generateSessionToken } from "@/lib/widget/keys";
import { assertConversationRate, clientIp } from "@/lib/widget/rate";
import { createSession } from "@/lib/widget/sessions";

/**
 * Start a conversation.
 *
 * No account, no password, no verification: the visitor gives a name and an
 * email so the IT team knows who they are talking to, and the reply is a ticket
 * in the same queue as everything else.
 *
 * The response hands back a session token exactly once. It is never stored in
 * readable form, so this is the only moment it exists in the clear.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = widgetRoute(async ({ channel }, request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("Body must be valid JSON.");
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const contact = readContact({
    name: input.name,
    email: input.email,
    visitorRef: input.visitorRef,
  });
  const message = readMessage(input.message);

  // Context the visitor cannot be trusted to supply, and which is useful to
  // staff reading the ticket later: where they were and what they were using.
  contact.userAgent = request.headers.get("user-agent")?.slice(0, 400) ?? null;
  contact.pageUrl = typeof input.pageUrl === "string" ? input.pageUrl.slice(0, 500) : null;

  const ip = clientIp(request);
  await assertConversationRate(ip);

  const { ticketId, ticketNumber } = await createConversation({
    channel,
    contact,
    message,
    ip,
  });

  const token = generateSessionToken();
  await createSession({
    channelId: channel.id,
    ticketId,
    visitorRef: contact.visitorRef,
    token,
  });

  const { conversation, messages } = await listMessages({ channel, ticketId });

  return widgetJson({ token, conversation, messages }, { status: 201 });
});

export const OPTIONS = widgetPreflight;
