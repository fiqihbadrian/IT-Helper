import "server-only";

import { telegramEnv } from "@/lib/env";
import type { BotKind } from "@/lib/telegram/bots";
import type { TelegramUpdate } from "@/lib/telegram/client";
import { handleUpdate } from "@/lib/telegram/commands";
import { claimUpdate, logUpdate } from "@/lib/telegram/session";

/**
 * The shared body of both webhook endpoints.
 *
 * Registered with a `secret_token`, which Telegram echoes back in the
 * `X-Telegram-Bot-Api-Secret-Token` header — that is the only authentication
 * these endpoints have, since Telegram obviously cannot present a session
 * cookie. Requests without it are rejected outright so a stranger who learns the
 * URL cannot inject updates.
 *
 * The secret is shared by both bots; which bot an update belongs to is decided
 * by *which URL* Telegram posted to, not by anything in the payload.
 */
export async function handleTelegramWebhook(bot: BotKind, request: Request): Promise<Response> {
  const provided = request.headers.get("x-telegram-bot-api-secret-token");

  if (provided !== telegramEnv.webhookSecret()) {
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
  const fresh = await claimUpdate(bot, update.update_id, chatId);
  if (!fresh) return new Response("ok", { status: 200 });

  try {
    const { userId } = await handleUpdate(bot, update);

    const raw = update.message?.text ?? update.message?.caption;
    await logUpdate(bot, update.update_id, {
      userId,
      command: raw?.startsWith("/") ? raw.split(/\s+/)[0].slice(1).split("@")[0] : undefined,
      payload: update.callback_query?.data ?? (raw?.startsWith("/") ? undefined : raw),
    });
  } catch (error) {
    console.error(`[telegram:${bot}] handler failed`, error);
    await logUpdate(bot, update.update_id, { reply: `error: ${String(error)}` });
  }

  // Always 200: a 500 would make Telegram replay the update forever.
  return new Response("ok", { status: 200 });
}
