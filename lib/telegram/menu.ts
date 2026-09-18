import "server-only";

import {
  deleteMyCommands,
  setMyCommands,
  type BotCommand,
} from "@/lib/telegram/client";

/**
 * Role-aware command menu.
 *
 * Telegram has no idea what a role is, so "employees see less than IT staff" is
 * expressed with command *scopes*: one `default` list that everyone inherits,
 * plus a per-chat override installed against the staff member's own chat_id.
 * An employee therefore sees a shorter ☰ menu, and a staff member sees the
 * queue/claim/close commands without any extra screen in the bot.
 *
 * The menu is presentation only. Every staff-only command is guarded again in
 * `commands.ts`, and RLS is the final word — a menu is not a permission system.
 */

const BASE_COMMANDS: BotCommand[] = [
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

export function isStaffRole(role: string) {
  return role === "it_support" || role === "admin";
}

/** Installs the employee list as the fallback everyone inherits. */
export async function registerDefaultCommands() {
  return setMyCommands(BASE_COMMANDS, { type: "default" });
}

/**
 * Module-level flag: the default list is global to the bot, not per chat, so it
 * only has to be installed once per isolate. Re-registering on every cold start
 * is harmless — the call is idempotent — but there is no reason to do it on
 * every message.
 */
let defaultCommandsEnsured = false;

/**
 * Keeps the ☰ menu of *everyone who never linked* in step with the code.
 *
 * Deliberately fire-and-forget: a menu is a convenience, and failing to install
 * one must never stop a ticket from being created.
 */
export function ensureDefaultCommands() {
  if (defaultCommandsEnsured) return;
  defaultCommandsEnsured = true;

  void registerDefaultCommands().catch((error) => {
    defaultCommandsEnsured = false;
    console.error("[telegram] registerDefaultCommands failed:", error);
  });
}

/**
 * Gives one chat the menu its role deserves.
 *
 * Staff get a chat-scoped override; everyone else gets theirs *deleted*, which
 * is what makes a demotion take effect — a stale override would otherwise
 * outlive the promotion that created it.
 */
export async function syncCommandMenu(chatId: number, role: string) {
  const scope = { type: "chat", chat_id: chatId } as const;

  if (isStaffRole(role)) {
    return setMyCommands(STAFF_COMMANDS, scope);
  }

  return deleteMyCommands(scope);
}

/**
 * Repairs the menu of an already-linked user.
 *
 * Called on `/start` and `/help` because a role change happens in the web app,
 * where the bot is not watching; these two commands are how someone tells it to
 * look again.
 */
export async function refreshCommandMenu(chatId: number, role: string) {
  try {
    await syncCommandMenu(chatId, role);
  } catch (error) {
    // A broken menu must never take down the command that triggered the sync.
    console.error("[telegram] syncCommandMenu failed:", error);
  }
}
