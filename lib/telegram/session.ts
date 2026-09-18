import "server-only";

import { asSystem } from "@/lib/db/pool";
import { sendMessage } from "@/lib/telegram/client";

/**
 * Session state. Telegram is a stateless HTTP webhook, so multi-step flows
 * (/new asks for a title, then a description, then a priority) need somewhere
 * to park the half-finished draft between messages.
 */

export type BotState =
  | "new:category"
  | "new:title"
  | "new:description"
  | "new:priority"
  | "reply"
  | null;

export interface Draft {
  categoryId?: string | null;
  title?: string;
  description?: string;
  priority?: string;
  ticketId?: string;
  ticketNumber?: string;
  photoFileId?: string;
}

export interface BotSession {
  chatId: number;
  userId: string;
  state: BotState;
  draft: Draft;
}

export async function getSession(chatId: number): Promise<BotSession | null> {
  return asSystem(async (db) => {
    const { rows } = await db.query<{
      chat_id: string;
      user_id: string | null;
      state: BotState;
      draft: Draft;
    }>(`select chat_id, user_id, state, draft from public.telegram_sessions where chat_id = $1`, [
      chatId,
    ]);

    const row = rows[0];
    if (!row || !row.user_id) return null;

    return {
      chatId,
      userId: row.user_id,
      state: row.state,
      draft: row.draft ?? {},
    };
  });
}

export async function setSession(
  chatId: number,
  userId: string,
  state: BotState,
  draft: Draft = {},
) {
  await asSystem(async (db) => {
    await db.query(
      `insert into public.telegram_sessions (chat_id, user_id, state, draft, updated_at)
       values ($1, $2, $3, $4::jsonb, now())
       on conflict (chat_id) do update
         set user_id = excluded.user_id,
             state = excluded.state,
             draft = excluded.draft,
             updated_at = now()`,
      [chatId, userId, state, JSON.stringify(draft)],
    );
  });
}

export async function clearSession(chatId: number) {
  await asSystem(async (db) => {
    await db.query(
      `update public.telegram_sessions set state = null, draft = '{}'::jsonb, updated_at = now()
        where chat_id = $1`,
      [chatId],
    );
  });
}

/**
 * Telegram retries any webhook it did not see a 200 for, so every update_id is
 * claimed exactly once. `false` means "already handled, ignore the retry".
 */
export async function claimUpdate(updateId: number, chatId: number): Promise<boolean> {
  return asSystem(async (db) => {
    const { rowCount } = await db.query(
      `insert into public.telegram_updates (update_id, chat_id)
       values ($1, $2)
       on conflict (update_id) do nothing`,
      [updateId, chatId],
    );
    return (rowCount ?? 0) > 0;
  });
}

export async function logUpdate(
  updateId: number,
  patch: { userId?: string; command?: string; payload?: string; ticketId?: string; reply?: string },
) {
  await asSystem(async (db) => {
    await db.query(
      `update public.telegram_updates
          set user_id = $2, command = $3, payload = $4, ticket_id = $5, reply = $6
        where update_id = $1`,
      [
        updateId,
        patch.userId ?? null,
        patch.command ?? null,
        patch.payload ?? null,
        patch.ticketId ?? null,
        patch.reply?.slice(0, 500) ?? null,
      ],
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Account linking                                                             */
/* -------------------------------------------------------------------------- */

export async function profileForChat(chatId: number) {
  return asSystem(async (db) => {
    const { rows } = await db.query<{
      user_id: string;
      full_name: string;
      role: "employee" | "it_support" | "admin";
      email: string;
    }>(`select * from public.profile_for_telegram_chat($1)`, [chatId]);
    return rows[0] ?? null;
  });
}

export async function redeemLinkCode(code: string, chatId: number) {
  return asSystem(async (db) => {
    const { rows } = await db.query<{ user_id: string; full_name: string; role: string }>(
      `select * from public.redeem_telegram_code($1, $2)`,
      [code, chatId],
    );
    return rows[0] ?? null;
  });
}

export async function unlinkChat(chatId: number) {
  return asSystem(async (db) => {
    const { rows } = await db.query<{ unlink_telegram: boolean }>(
      `select public.unlink_telegram($1) as unlink_telegram`,
      [chatId],
    );
    return rows[0]?.unlink_telegram ?? false;
  });
}

/** Push queued notifications for this chat, if any. */
export async function flushNotifications(chatId: number, limit = 10) {
  const { pendingNotifications, markDeliveries } = await import("@/lib/telegram/tickets");
  const pending = await pendingNotifications(chatId, limit);
  if (!pending.length) return 0;

  const sent: string[] = [];
  for (const item of pending) {
    const text = `*${escapeMarkdown(item.title)}*\n${escapeMarkdown(item.message)}`;
    const result = await sendMessage(chatId, text);
    if (result) sent.push(item.id);
  }

  await markDeliveries(sent);
  return sent.length;
}

/**
 * Telegram's legacy Markdown only needs these escaped. Being conservative is
 * better than a 400 "can't parse entities" that silently drops the message.
 */
export function escapeMarkdown(value: string) {
  return value.replace(/([_*`\[\]])/g, "\\$1");
}
