import "server-only";

import type { BotCommand } from "@/lib/telegram/client";
import { telegramApi } from "@/lib/telegram/client";
import type { BotKind } from "@/lib/telegram/bots";

/**
 * One command menu per bot.
 *
 * There is no role branching here any more. The old single bot picked between a
 * short and a long list based on the caller's role, which meant installing a
 * per-chat override for every staff member and remembering to delete it on
 * demotion. Now the employee bot simply *has* the employee list and the staff
 * bot *has* the staff list, so the menu cannot disagree with the bot you are
 * talking to.
 *
 * The menu is still presentation only: RLS is the enforcement.
 */

const EMPLOYEE_COMMANDS: BotCommand[] = [
  { command: "new", description: "Buat tiket baru" },
  { command: "tickets", description: "Tiket milik kamu" },
  { command: "ticket", description: "Lihat satu tiket: /ticket IT-000004" },
  { command: "reply", description: "Balas tiket: /reply IT-000004 pesan" },
  { command: "status", description: "Ringkasan akun dan tiket kamu" },
  { command: "help", description: "Daftar perintah" },
  { command: "unlink", description: "Putuskan akun Telegram ini" },
];

const STAFF_COMMANDS: BotCommand[] = [
  { command: "new", description: "Buat tiket baru" },
  { command: "tickets", description: "Tiket milik kamu" },
  { command: "ticket", description: "Lihat satu tiket: /ticket IT-000004" },
  { command: "queue", description: "Semua tiket tim IT" },
  { command: "open", description: "Tiket yang belum selesai" },
  { command: "unassigned", description: "Tiket yang belum ditangani" },
  { command: "find", description: "Cari tiket: /find printer" },
  { command: "reply", description: "Balas tiket: /reply IT-000004 pesan" },
  { command: "claim", description: "Ambil tiket: /claim IT-000004" },
  { command: "close", description: "Tutup tiket: /close IT-000004" },
  { command: "status", description: "Ringkasan akun dan antrean tim" },
  { command: "help", description: "Daftar perintah" },
  { command: "unlink", description: "Putuskan akun Telegram ini" },
];

const COMMANDS: Record<BotKind, BotCommand[]> = {
  employee: EMPLOYEE_COMMANDS,
  staff: STAFF_COMMANDS,
};

export function commandsFor(bot: BotKind) {
  return COMMANDS[bot];
}

export async function registerDefaultCommands(bot: BotKind) {
  return telegramApi(bot).setMyCommands(COMMANDS[bot], { type: "default" });
}

/**
 * Module-level flags: a default list belongs to the bot, not to a chat, so it
 * only has to be installed once per isolate. Re-registering is idempotent and
 * harmless, but there is no reason to do it on every message.
 */
const ensured: Partial<Record<BotKind, boolean>> = {};

/**
 * Keeps the ☰ menu in step with the code.
 *
 * Deliberately fire-and-forget: a menu is a convenience, and failing to install
 * one must never stop a ticket from being created.
 */
export function ensureDefaultCommands(bot: BotKind) {
  if (ensured[bot]) return;
  ensured[bot] = true;

  void registerDefaultCommands(bot).catch((error) => {
    ensured[bot] = false;
    console.error(`[telegram:${bot}] registerDefaultCommands failed:`, error);
  });
}
