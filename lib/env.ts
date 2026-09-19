/**
 * Central env access. Only NEXT_PUBLIC_* values are ever bundled for the
 * browser; the service-role key is read exclusively on the server.
 */

import { BOT_TOKEN_VARS, BOT_USERNAME_VARS, type BotKind } from "@/lib/telegram/bots";

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.local.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const publicEnv = {
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  supabaseAnonKey: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ticketBucket: process.env.NEXT_PUBLIC_TICKET_BUCKET ?? "ticket-attachments",
};

export function getServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Telegram credentials. One token per bot — see `lib/telegram/bots.ts` for which
 * environment variables name them and in what order they win.
 */
function firstSet(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

export const telegramEnv = {
  botToken: (bot: BotKind) =>
    required(BOT_TOKEN_VARS[bot].join(" (or "), firstSet(BOT_TOKEN_VARS[bot])),
  webhookSecret: () =>
    required(
      "TELEGRAM_WEBHOOK_SECRET",
      process.env.TELEGRAM_WEBHOOK_SECRET ?? process.env.TELEGRAM_SECRET,
    ),
  dispatchSecret: () =>
    required(
      "DISPATCH_SECRET",
      process.env.DISPATCH_SECRET ?? process.env.TELEGRAM_DISPATCH_SECRET,
    ),
  /** `@name` without the leading @, for the t.me deep link on the profile page. */
  botUsername: (bot: BotKind) => firstSet(BOT_USERNAME_VARS[bot]) ?? null,
};

/** True when a bot has a token; used to hide Telegram UI that cannot work. */
export function telegramConfigured(bot: BotKind) {
  return Boolean(firstSet(BOT_TOKEN_VARS[bot]));
}
