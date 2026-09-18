import { telegramEnv } from "@/lib/env";
import { handleUpdate } from "@/lib/telegram/commands";
import { claimUpdate, logUpdate } from "@/lib/telegram/session";
import { flushNotifications } from "@/lib/telegram/session";
import type { TelegramUpdate } from "@/lib/telegram/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram webhook.
 *
 * Registered with a `secret_token`, which Telegram echoes back in this header —
 * that is the only authentication this endpoint has, since Telegram obviously
 * cannot present a session cookie. Requests without it are rejected outright so
 * a stranger who learns the URL cannot inject updates.
 */
export async function POST(request: Request) {
  const secret = telegramEnv.webhookSecret();
  const provided = request.headers.get("x-telegram-bot-api-secret-token");

  if (provided !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (!chatId) return new Response("ok", { status: 200 });

  // Telegram retries anything it did not get a 200 for. Claim the update_id
  // first so a retry cannot create the same ticket twice.
  const fresh = await claimUpdate(update.update_id, chatId);
  if (!fresh) return new Response("ok", { status: 200 });

  try {
    await handleUpdate(update);

    const raw = update.message?.text ?? update.message?.caption;
    await logUpdate(update.update_id, {
      command: raw?.startsWith("/") ? raw.split(/\s+/)[0].slice(1).split("@")[0] : undefined,
      payload: update.callback_query?.data ?? (raw?.startsWith("/") ? undefined : raw),
    });
  } catch (error) {
    console.error("[telegram] handler failed", error);
    await logUpdate(update.update_id, { reply: `error: ${String(error)}` });
  }

  // Always 200: a 500 would make Telegram replay the update forever.
  return new Response("ok", { status: 200 });
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "telegram-webhook" });
}
