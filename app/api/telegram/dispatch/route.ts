import { telegramEnv } from "@/lib/env";
import type { BotKind } from "@/lib/telegram/bots";
import { telegramApi } from "@/lib/telegram/client";
import { markDeliveries } from "@/lib/telegram/tickets";
import { escapeMarkdown as md } from "@/lib/telegram/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Notification dispatcher.
 *
 * `notifications` rows are written by the database triggers and each one queues a
 * `notification_deliveries` row for the bot that matches its audience (0009).
 * This endpoint drains both queues, so the web app and the bots share one source
 * of truth and no bot ever has to poll for ticket changes.
 *
 * The webhook path already flushes the queue opportunistically when a user says
 * something, but that only works while they are talking to the bot. This is the
 * one that can push.
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

  // One row per (chat, notification) that still needs pushing. The bot is read
  // from the link the delivery was queued against, so a person who linked both
  // bots gets a bench notification on the staff bot and a requester
  // notification on the employee bot — even though both use the same chat id.
  const queue = await asSystem(async (db) => {
    const { rows } = await db.query<{
      notification_id: string;
      title: string;
      message: string;
      chat_id: string;
      bot: BotKind;
    }>(
      `select d.notification_id, n.title, n.message, l.chat_id, l.bot
         from public.notification_deliveries d
         join public.notifications n on n.id = d.notification_id
         join public.profiles p on p.id = n.user_id
         join public.telegram_links l
           on l.profile_id = n.user_id
          and l.bot = case d.channel
                        when 'telegram_staff' then 'staff'
                        else 'employee'
                      end
        where d.channel in ('telegram', 'telegram_staff')
          and d.status = 'PENDING'
          and p.is_active = true
        order by n.created_at asc
        limit 100`,
    );
    return rows;
  });

  if (!queue.length) {
    return Response.json({ ok: true, data: { sent: 0, failed: 0, pending: 0 } });
  }

  const sent: Partial<Record<BotKind, string[]>> = {};
  const failed: Partial<Record<BotKind, string[]>> = {};

  for (const item of queue) {
    const result = await telegramApi(item.bot).sendMessage(
      item.chat_id,
      `*${md(item.title)}*\n${md(item.message)}`,
    );

    const bucket = result ? sent : failed;
    (bucket[item.bot] ??= []).push(item.notification_id);
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const bot of ["employee", "staff"] as BotKind[]) {
    const ok = sent[bot] ?? [];
    const bad = failed[bot] ?? [];
    sentCount += ok.length;
    failedCount += bad.length;

    await markDeliveries(bot, ok);
    if (bad.length) {
      await markDeliveries(bot, bad, "Telegram rejected the message (blocked or invalid chat).");
    }
  }

  return Response.json({
    ok: true,
    data: { sent: sentCount, failed: failedCount, pending: 0 },
  });
}

export async function GET(request: Request) {
  return POST(request);
}
