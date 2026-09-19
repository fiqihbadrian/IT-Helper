import "server-only";

import { asSystem } from "@/lib/db/pool";
import { hashToken } from "@/lib/widget/keys";

/**
 * A visitor's conversation, looked up by the token in their localStorage.
 *
 * The row is the whole authorisation story for the widget: it binds a token to
 * exactly one ticket. Every read of `GET /messages` takes its `ticket_id` from
 * here and never from the request, which is why knowing a channel's public key
 * — a value printed in the customer's own page source — buys nothing.
 */
export interface WidgetSession {
  id: string;
  channelId: string;
  ticketId: string;
  visitorRef: string;
}

export async function findSession(token: string): Promise<WidgetSession | null> {
  const row = await asSystem(async (db) => {
    const { rows } = await db.query<{
      id: string;
      channel_id: string;
      ticket_id: string;
      visitor_ref: string;
    }>(
      `select id, channel_id, ticket_id, visitor_ref
         from public.widget_sessions
        where token_hash = $1
          and expires_at > now()`,
      [hashToken(token)],
    );
    return rows[0] ?? null;
  });

  if (!row) return null;

  return {
    id: row.id,
    channelId: row.channel_id,
    ticketId: row.ticket_id,
    visitorRef: row.visitor_ref,
  };
}

/** Cheap liveness marker so an idle session can be told from an abandoned one. */
export async function touchSession(sessionId: string): Promise<void> {
  await asSystem(async (db) => {
    await db.query("update public.widget_sessions set last_seen_at = now() where id = $1", [
      sessionId,
    ]);
  });
}

export async function createSession(input: {
  channelId: string;
  ticketId: string;
  visitorRef: string;
  token: string;
}): Promise<void> {
  await asSystem(async (db) => {
    await db.query(
      `insert into public.widget_sessions (channel_id, ticket_id, visitor_ref, token_hash)
       values ($1, $2, $3, $4)`,
      [input.channelId, input.ticketId, input.visitorRef, hashToken(input.token)],
    );
  });
}
