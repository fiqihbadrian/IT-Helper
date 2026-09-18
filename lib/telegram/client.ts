import "server-only";

import { telegramEnv } from "@/lib/env";

/**
 * Minimal Telegram Bot API client. Only the handful of methods this project
 * actually calls — no SDK, so there is nothing to keep in sync.
 */

const API = "https://api.telegram.org";

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  entities?: Array<{ type: string; offset: number; length: number }>;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const response = await fetch(`${API}/bot${telegramEnv.botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const body = (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };

  if (!body.ok) {
    // 403 means the user blocked the bot — not an error worth throwing on.
    console.error(`[telegram] ${method} failed: ${body.description}`);
    return null;
  }

  return body.result ?? null;
}

export interface SendOptions {
  keyboard?: InlineKeyboardButton[][];
  markdown?: boolean;
  disablePreview?: boolean;
}

export function sendMessage(chatId: number | string, text: string, options: SendOptions = {}) {
  return call<TelegramMessage>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: options.markdown === false ? undefined : "Markdown",
    link_preview_options: { is_disabled: options.disablePreview ?? true },
    reply_markup: options.keyboard ? { inline_keyboard: options.keyboard } : undefined,
  });
}

export function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  options: SendOptions = {},
) {
  return call<TelegramMessage>("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: options.markdown === false ? undefined : "Markdown",
    link_preview_options: { is_disabled: true },
    reply_markup: options.keyboard ? { inline_keyboard: options.keyboard } : undefined,
  });
}

export function answerCallbackQuery(id: string, text?: string) {
  return call<boolean>("answerCallbackQuery", {
    callback_query_id: id,
    text,
    show_alert: false,
  });
}

export function setWebhook(url: string, secretToken: string) {
  return call<boolean>("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export function deleteWebhook() {
  return call<boolean>("deleteWebhook", { drop_pending_updates: true });
}

export function getMe() {
  return call<TelegramUser>("getMe", {});
}

export function getWebhookInfo() {
  return call<Record<string, unknown>>("getWebhookInfo", {});
}
