import { telegramEnv } from "@/lib/env";
import { sendMessage } from "@/lib/telegram/client";
import { markDeliveries, pendingNotifications } from "@/lib/telegram/tickets";
import { escapeMarkdown as md } from "@/lib/telegram/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Notification dispatcher.
 *
 * `notifications` rows are written by the database triggers and each one queues
 * a `notification_deliveries` row for Telegram (0007). This endpoint drains the
 * queue, so the web app and the bot share one source of truth and the bot never
 * has to poll for ticket changes.
 *
 * Call it from a cron job:
 *   curl -H "x-dispatch-secret: $DISPATCH_SECRET" https://<app>/api/telegram/dispatch
 */
export async function POST(request: Request) {
  const secret = telegramEnv.dispatchSecret();
  const provided =
    request.headers.get("x-dispatch-secret") ??
    new URL(request.url).searchParams.get("secret");

  if (provided !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const { asSystem } = await import("@/lib/db/pool");

  // One row per (chat, notification) that still needs pushing.
  const queue = await asSystem(async (db) => {
    const { rows } = await db.query<{
      notification_id: string;
      title: string;
      message: string;
      chat_id: string;
    }>(
      `select d.notification_id, n.title, n.message, p.telegram_user_id as chat_id
         from public.notification_deliveries d
         join public.notifications n on n.id = d.notification_id
         join public.profiles p on p.id = n.user_id
        where d.channel = 'telegram'
          and d.status = 'PENDING'
          and p.telegram_user_id is not null
          and p.is_active = true
        order by n.created_at asc
        limit 100`,
    );
    return rows;
  });

  if (!queue.length) {
    return Response.json({ ok: true, data: { sent: 0, failed: 0, pending: 0 } });
  }

  const sent: string[] = [];
  const failed: string[] = [];

  for (const item of queue) {
    const result = await sendMessage(
      item.chat_id,
      `*${md(item.title)}*\n${md(item.message)}`,
    );
    (result ? sent : failed).push(item.notification_id);
  }

  await markDeliveries(sent);
  if (failed.length) {
    await markDeliveries(failed, "Telegram rejected the message (blocked or invalid chat).");
  }

  return Response.json({
    ok: true,
    data: { sent: sent.length, failed: failed.length, pending: 0 },
  });
}

export async function GET(request: Request) {
  return POST(request);
}
