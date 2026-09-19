import "server-only";

import { telegramEnv } from "@/lib/env";
import type { BotKind } from "@/lib/telegram/bots";

/**
 * Minimal Telegram Bot API client. Only the handful of methods this project
 * actually calls — no SDK, so there is nothing to keep in sync.
 *
 * Every method takes the bot it is talking to. There is deliberately no
 * "current bot": on Cloudflare Workers one isolate serves concurrent requests
 * for both bots, so a module-level token would leak whichever bot was resolved
 * last into an unrelated conversation.
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

/** Telegram caps descriptions at 256 characters and lists at 100 entries. */
export interface BotCommand {
  command: string;
  description: string;
}

/**
 * Telegram has no concept of our roles, so a bot's menu is expressed as a scope:
 * `default` is what everyone who talks to that bot sees, and `chat` overrides it
 * for one conversation.
 */
export type BotCommandScope =
  | { type: "default" }
  | { type: "all_private_chats" }
  | { type: "chat"; chat_id: number | string };

async function call<T>(
  bot: BotKind,
  method: string,
  payload: Record<string, unknown>,
): Promise<T | null> {
  const response = await fetch(`${API}/bot${telegramEnv.botToken(bot)}/${method}`, {
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
    console.error(`[telegram:${bot}] ${method} failed: ${body.description}`);
    return null;
  }

  return body.result ?? null;
}

export interface SendOptions {
  keyboard?: InlineKeyboardButton[][];
  markdown?: boolean;
  disablePreview?: boolean;
}

/** The methods the app calls, bound to one bot. */
export interface TelegramApi {
  sendMessage(
    chatId: number | string,
    text: string,
    options?: SendOptions,
  ): Promise<TelegramMessage | null>;
  answerCallbackQuery(id: string, text?: string): Promise<boolean | null>;
  setMyCommands(commands: BotCommand[], scope?: BotCommandScope): Promise<boolean | null>;
}

export function telegramApi(bot: BotKind): TelegramApi {
  return {
    sendMessage(chatId, text, options = {}) {
      return call<TelegramMessage>(bot, "sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: options.markdown === false ? undefined : "Markdown",
        link_preview_options: { is_disabled: options.disablePreview ?? true },
        reply_markup: options.keyboard ? { inline_keyboard: options.keyboard } : undefined,
      });
    },

    answerCallbackQuery(id, text) {
      return call<boolean>(bot, "answerCallbackQuery", {
        callback_query_id: id,
        text,
        show_alert: false,
      });
    },

    setMyCommands(commands, scope) {
      return call<boolean>(bot, "setMyCommands", { commands, scope });
    },
  };
}
