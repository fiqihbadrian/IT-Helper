import "server-only";

import { asSystem, type Queryable } from "@/lib/db/pool";
import { tooManyRequests } from "@/lib/api/errors";

/**
 * Rate limits for the widget API.
 *
 * Counted in the database rather than in memory. A Worker isolate's memory is
 * per-isolate and short-lived, so a counter kept there is not a limit at all —
 * it resets on every cold start and is not shared between colos. Counting rows
 * that already exist costs one indexed query and cannot be evaded that way.
 *
 * These are deliberately generous. The job is to stop a script from turning the
 * ticket queue into a landfill, not to police a chatty human.
 */

/** Per conversation: a person typing quickly still stays well under this. */
const MESSAGES_PER_MINUTE = 20;

/** Per IP: new conversations per hour. Generous for an office behind one NAT. */
const CONVERSATIONS_PER_HOUR = 15;

/**
 * Checked inside the same transaction as the insert it guards, so the count and
 * the write cannot drift apart under concurrent requests.
 */
export async function assertMessageRate(db: Queryable, ticketId: string): Promise<void> {
  const { rows } = await db.query<{ recent: number }>(
    `select count(*)::int as recent
       from public.ticket_comments
      where ticket_id = $1
        and created_at > now() - interval '1 minute'`,
    [ticketId],
  );

  if ((rows[0]?.recent ?? 0) >= MESSAGES_PER_MINUTE) {
    throw tooManyRequests("That is a lot of messages at once. Please wait a moment.");
  }
}

/**
 * Per-IP cap on *new* conversations.
 *
 * Keyed on `ticket_contacts.visitor_ip`, which is the address the request
 * arrived from. Behind a proxy that would be the proxy's address, which is why
 * the limit is generous enough for a shared office connection.
 */
export async function assertConversationRate(ip: string | null): Promise<void> {
  if (!ip) return;

  const recent = await asSystem(async (db) => {
    const { rows } = await db.query<{ recent: number }>(
      `select count(*)::int as recent
         from public.ticket_contacts
        where visitor_ip = $1
          and created_at > now() - interval '1 hour'`,
      [ip],
    );
    return rows[0]?.recent ?? 0;
  });

  if (recent >= CONVERSATIONS_PER_HOUR) {
    throw tooManyRequests("Too many conversations started from this network. Try again later.");
  }
}

/**
 * Best-effort client address.
 *
 * `CF-Connecting-IP` is set by Cloudflare's edge and cannot be forged by the
 * client, so it is preferred. `X-Forwarded-For` is only a fallback for local
 * development, where it is trivially spoofable — and that is exactly why the
 * limits above are a backstop rather than the whole defence.
 */
export function clientIp(request: Request): string | null {
  const direct = request.headers.get("cf-connecting-ip")?.trim();
  if (direct) return direct;

  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || null;
}
