import "server-only";

import { asSystem } from "@/lib/db/pool";
import { BOT_KINDS, type BotKind } from "@/lib/telegram/bots";
import { telegramApi } from "@/lib/telegram/client";

/**
 * Session state. Telegram is a stateless HTTP webhook, so multi-step flows
 * (/new asks for a title, then a description, then a priority) need somewhere
 * to park the half-finished draft between messages.
 *
 * Everything here is keyed by (bot, chat_id). The same person talking to both
 * bots has the *same* private chat id on each, so the bot has to be part of the
 * key or a draft started on one would be resumed by the other.
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
  bot: BotKind;
  chatId: number;
  userId: string;
  state: BotState;
  draft: Draft;
}

export async function getSession(bot: BotKind, chatId: number): Promise<BotSession | null> {
  return asSystem(async (db) => {
    const { rows } = await db.query<{
      user_id: string | null;
      state: BotState;
      draft: Draft;
    }>(
      `select user_id, state, draft from public.telegram_sessions
        where bot = $1 and chat_id = $2`,
      [bot, chatId],
    );

    const row = rows[0];
    if (!row || !row.user_id) return null;

    return {
      bot,
      chatId,
      userId: row.user_id,
      state: row.state,
      draft: row.draft ?? {},
    };
  });
}

export async function setSession(
  bot: BotKind,
  chatId: number,
  userId: string,
  state: BotState,
  draft: Draft = {},
) {
  await asSystem(async (db) => {
    await db.query(
      `insert into public.telegram_sessions (bot, chat_id, user_id, state, draft, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, now())
       on conflict (bot, chat_id) do update
         set user_id = excluded.user_id,
             state = excluded.state,
             draft = excluded.draft,
             updated_at = now()`,
      [bot, chatId, userId, state, JSON.stringify(draft)],
    );
  });
}

export async function clearSession(bot: BotKind, chatId: number) {
  await asSystem(async (db) => {
    await db.query(
      `update public.telegram_sessions
          set state = null, draft = '{}'::jsonb, updated_at = now()
        where bot = $1 and chat_id = $2`,
      [bot, chatId],
    );
  });
}

/**
 * Telegram retries any webhook it did not see a 200 for, so every update_id is
 * claimed exactly once. `false` means "already handled, ignore the retry".
 *
 * `update_id` is unique per bot, not globally, so the claim is keyed by both —
 * otherwise the two bots would keep discarding each other's updates whenever
 * their sequences happened to line up.
 */
export async function claimUpdate(
  bot: BotKind,
  updateId: number,
  chatId: number,
): Promise<boolean> {
  return asSystem(async (db) => {
    const { rowCount } = await db.query(
      `insert into public.telegram_updates (bot, update_id, chat_id)
       values ($1, $2, $3)
       on conflict (bot, update_id) do nothing`,
      [bot, updateId, chatId],
    );
    return (rowCount ?? 0) > 0;
  });
}

export async function logUpdate(
  bot: BotKind,
  updateId: number,
  patch: {
    userId?: string;
    command?: string;
    payload?: string;
    ticketId?: string;
    reply?: string;
  },
) {
  await asSystem(async (db) => {
    await db.query(
      `update public.telegram_updates
          set user_id = $3, command = $4, payload = $5, ticket_id = $6, reply = $7
        where bot = $1 and update_id = $2`,
      [
        bot,
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

export async function profileForChat(bot: BotKind, chatId: number) {
  return asSystem(async (db) => {
    const { rows } = await db.query<{
      user_id: string;
      full_name: string;
      role: "employee" | "it_support" | "admin";
      email: string;
    }>(`select * from public.profile_for_telegram_chat($1, $2)`, [bot, chatId]);
    return rows[0] ?? null;
  });
}

export async function redeemLinkCode(bot: BotKind, code: string, chatId: number) {
  return asSystem(async (db) => {
    const { rows } = await db.query<{ user_id: string; full_name: string; role: string }>(
      `select * from public.redeem_telegram_code($1, $2, $3)`,
      [code, bot, chatId],
    );
    return rows[0] ?? null;
  });
}

/**
 * Find the profile a chat is linked to, whichever bot holds the link.
 *
 * Used only by web sign-in, and only because the login page has no session and
 * therefore cannot know which bot the visitor linked. A chat is one human, so
 * the answer is the same person either way; asking them to remember which bot
 * they linked is a trap that costs a query to avoid.
 *
 * The preferred bot is tried first so the common case is one lookup. If the same
 * chat were ever linked to two different profiles, the preferred bot wins — a
 * situation `create_telegram_link_code` makes hard to reach, since linking
 * requires a code issued while already signed in as that profile.
 */
export async function profileForChatAcrossBots(chatId: number, preferred: BotKind) {
  const order = [preferred, ...BOT_KINDS.filter((bot) => bot !== preferred)];

  for (const bot of order) {
    const profile = await profileForChat(bot, chatId);
    if (profile) return { bot, profile };
  }

  return null;
}

/**
 * Bind a pending web sign-in to the profile this chat is linked to.
 *
 * The profile comes from `telegram_links`, never from the message, which is why
 * a code someone else reads off a screen can only ever sign them in as
 * themselves.
 */
export async function redeemWebLoginCode(code: string, profileId: string) {
  return asSystem(async (db) => {
    const { rows } = await db.query<{ redeem_web_login_code: boolean }>(
      `select public.redeem_web_login_code($1, $2) as redeem_web_login_code`,
      [code, profileId],
    );
    return rows[0]?.redeem_web_login_code ?? false;
  });
}

export async function unlinkChat(bot: BotKind, chatId: number) {
  return asSystem(async (db) => {
    const { rows } = await db.query<{ unlink_telegram: boolean }>(
      `select public.unlink_telegram($1, $2) as unlink_telegram`,
      [bot, chatId],
    );
    return rows[0]?.unlink_telegram ?? false;
  });
}

/**
 * Push queued notifications for this chat, if any.
 *
 * Only the channel belonging to this bot: a bench notification waits for the
 * staff bot, and the employee bot must not be the thing that delivers it just
 * because the user happened to say something there first.
 */
export async function flushNotifications(bot: BotKind, chatId: number, limit = 10) {
  const { pendingNotifications, markDeliveries } = await import("@/lib/telegram/tickets");

  const pending = await pendingNotifications(bot, chatId, limit);
  if (!pending.length) return 0;

  const api = telegramApi(bot);
  const sent: string[] = [];

  for (const item of pending) {
    const text = `*${escapeMarkdown(item.title)}*\n${escapeMarkdown(item.message)}`;
    const result = await api.sendMessage(chatId, text);
    if (result) sent.push(item.id);
  }

  await markDeliveries(bot, sent);
  return sent.length;
}

/**
 * Telegram's legacy Markdown only needs these escaped. Being conservative is
 * better than a 400 "can't parse entities" that silently drops the message.
 */
export function escapeMarkdown(value: string) {
  return value.replace(/([_*`\[\]])/g, "\\$1");
}
