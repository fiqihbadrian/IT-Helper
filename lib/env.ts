/**
 * Central env access. Only NEXT_PUBLIC_* values are ever bundled for the
 * browser; the service-role key is read exclusively on the server.
 */

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
 * Telegram credentials.
 *
 * `BOT_TELE` is accepted as an alias because that is what the token is called
 * in some dashboards; TELEGRAM_BOT_TOKEN wins when both are set.
 */
export const telegramEnv = {
  botToken: () =>
    required(
      "TELEGRAM_BOT_TOKEN (or BOT_TELE)",
      process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TELE,
    ),
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
  botUsername: () =>
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ??
    process.env.TELEGRAM_BOT_USERNAME ??
    null,
};

/** True when the bot is configured; used to hide Telegram UI that cannot work. */
export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TELE);
}
