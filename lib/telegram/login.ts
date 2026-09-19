import "server-only";

import { randomBytes } from "node:crypto";

import { telegramEnv } from "@/lib/env";
import { BOT_KINDS, type BotKind } from "@/lib/telegram/bots";

/**
 * The browser half of "sign in with Telegram".
 *
 * A browser that wants to sign in asks for a code and keeps a cookie of its
 * own. Telegram supplies the identity: the chat that sends the code is already
 * bound to a profile by `telegram_links`, so the bot never has to be told who
 * you are. See 0011_web_login.sql for the full handshake.
 */

/** No 0/O/1/I/L, so a code survives being read off a screen and typed. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const LOGIN_CODE_LENGTH = 8;

/** Long enough to switch tabs, short enough that a leaked code goes stale. */
export const LOGIN_TTL_MS = 10 * 60 * 1000;

/** Ties the code to the browser that asked for it. HttpOnly. */
export const BROWSER_COOKIE = "it-helpdesk-login";

/** Deep-link payload prefix, which is how `/start` tells a sign-in from a link code. */
const PAYLOAD_PREFIX = "login_";

export function generateLoginCode(): string {
  const bytes = randomBytes(LOGIN_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

export function generateBrowserToken(): string {
  return randomBytes(32).toString("base64url");
}

export function normaliseCode(value: string): string {
  return value.trim().toUpperCase();
}

export function loginPayload(code: string): string {
  return `${PAYLOAD_PREFIX}${normaliseCode(code)}`;
}

/** `login_7K2M9QX4` means sign-in; anything else is a link code. */
export function readLoginPayload(payload: string): string | null {
  const value = payload.trim();
  if (!value.toLowerCase().startsWith(PAYLOAD_PREFIX)) return null;

  const code = normaliseCode(value.slice(PAYLOAD_PREFIX.length));
  return code || null;
}

export interface LoginBotLink {
  bot: BotKind;
  username: string;
  url: string;
}

/**
 * One deep link per bot, because a chat is linked per bot.
 *
 * A staff member who only ever linked the staff bot would be stuck if the page
 * offered nothing but the employee bot, so the page shows whichever bots have a
 * username configured and lets the visitor pick the one they actually talk to.
 */
export function loginBotLinks(code: string): LoginBotLink[] {
  const payload = loginPayload(code);

  return BOT_KINDS.flatMap((bot) => {
    const username = telegramEnv.botUsername(bot);
    return username ? [{ bot, username, url: `https://t.me/${username}?start=${payload}` }] : [];
  });
}
