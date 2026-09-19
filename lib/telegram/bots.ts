/**
 * The two bots.
 *
 * Phase 2 shipped one bot that changed its behaviour based on the caller's role.
 * That works, but it makes the employee surface and the IT surface the same
 * conversation: an employee talking to the bot is one role check away from the
 * queue commands, and a staff member raising a ticket does it in the same chat
 * they work the bench from.
 *
 * They are now two separate bots with two tokens, two webhook endpoints and two
 * menus. The role is expressed by *which bot you are talking to*, not by what the
 * bot decides about you mid-conversation.
 *
 * Deliberately not a `server-only` module: the profile page renders one panel per
 * bot, and the labels live here so they cannot drift from the kinds.
 */

export type BotKind = "employee" | "staff";

export const BOT_KINDS: readonly BotKind[] = ["employee", "staff"];

export interface BotMeta {
  /** Shown as the card title on the profile page. */
  label: string;
  /** One line explaining who should link this bot. */
  purpose: string;
  /** Who the bot is for; the staff bot refuses anybody else at link time. */
  audience: "everyone" | "staff";
}

export const BOT_META: Record<BotKind, BotMeta> = {
  employee: {
    label: "Bot Karyawan",
    purpose: "Laporkan masalah dan pantau tiketmu sendiri.",
    audience: "everyone",
  },
  staff: {
    label: "Bot Tim IT",
    purpose: "Antrean tiket, ambil tiket, ubah status.",
    audience: "staff",
  },
};

/**
 * Which environment variables name each bot's token and username, in precedence
 * order. The `BOT_TELE_*` names are aliases because that is what the tokens are
 * called in the dashboard this project was set up from; `BOT_TELE` is a
 * last-resort employee fallback so a single-bot deployment keeps working.
 *
 * Kept here rather than in `lib/env.ts` so the profile page can tell the user
 * which variable to set without importing a server-only module.
 */
export const BOT_TOKEN_VARS: Record<BotKind, string[]> = {
  employee: ["TELEGRAM_EMPLOYEE_BOT_TOKEN", "BOT_TELE_KARYAWAN", "BOT_TELE"],
  staff: ["TELEGRAM_STAFF_BOT_TOKEN", "BOT_TELE_ADMIN"],
};

export const BOT_USERNAME_VARS: Record<BotKind, string[]> = {
  employee: [
    "NEXT_PUBLIC_TELEGRAM_EMPLOYEE_BOT_USERNAME",
    "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME",
    "TELEGRAM_BOT_USERNAME",
  ],
  staff: ["NEXT_PUBLIC_TELEGRAM_STAFF_BOT_USERNAME", "TELEGRAM_STAFF_BOT_USERNAME"],
};

export function isBotKind(value: string): value is BotKind {
  return (BOT_KINDS as readonly string[]).includes(value);
}

/** The bench. Decides who may link the staff bot, in the UI and in the database. */
export function isStaffRole(role: string) {
  return role === "it_support" || role === "admin";
}

/**
 * The channel a notification for this bot is queued under. Mirrors the
 * `notification_deliveries.channel` values and the routing in
 * `notifications_queue_delivery()` — the audience decides the bot, not the
 * other way round.
 */
export const BOT_CHANNEL: Record<BotKind, "telegram" | "telegram_staff"> = {
  employee: "telegram",
  staff: "telegram_staff",
};

/** Where Telegram should POST this bot's updates. */
export function webhookPath(bot: BotKind) {
  return bot === "staff" ? "/api/telegram/webhook/staff" : "/api/telegram/webhook";
}
