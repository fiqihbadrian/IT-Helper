import type { SupabaseClient } from "@supabase/supabase-js";

import type { BotKind } from "@/lib/telegram/bots";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

export interface TelegramLinkCode {
  code: string;
  expires_at: string;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Minted server-side by `create_telegram_link_code()`; the plaintext is shown
 * once. The bot is part of the code, so a code minted for the employee bot
 * cannot be redeemed against the staff bot.
 */
export async function createTelegramLinkCode(supabase: Db, bot: BotKind) {
  const { data, error } = await supabase.rpc("create_telegram_link_code", { p_bot: bot });
  if (error) throw new Error(error.message);
  return (data as TelegramLinkCode[] | null)?.[0] ?? null;
}

export async function listApiKeys(supabase: Db, userId: string) {
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, last_used_at, expires_at, revoked_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ApiKeyRow[];
}

export async function createApiKey(supabase: Db, name: string) {
  const { data, error } = await supabase.rpc("create_api_key", { p_name: name });
  if (error) throw new Error(error.message);
  return (
    (data as Array<{ id: string; name: string; api_key: string }> | null)?.[0] ?? null
  );
}

export async function revokeApiKey(supabase: Db, id: string) {
  const { data, error } = await supabase.rpc("revoke_api_key", { p_id: id });
  if (error) throw new Error(error.message);
  return Boolean(data);
}
