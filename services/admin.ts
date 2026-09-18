import "server-only";

import type { Db } from "@/services/tickets";
import type { Category, TicketHistoryEntry } from "@/types";

export async function listAllCategories(db: Db): Promise<Category[]> {
  const { data, error } = await db
    .from("categories")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Category[];
}

export interface ActivityEntry {
  id: string;
  action: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  ticket_number: string | null;
  ticket_title: string | null;
  actor_name: string | null;
}

export async function listActivity(db: Db, limit = 100): Promise<ActivityEntry[]> {
  const { data, error } = await db
    .from("ticket_history")
    .select(
      `id, action, old_value, new_value, created_at,
       ticket:tickets ( ticket_number, title ),
       actor:profiles!ticket_history_user_id_fkey ( full_name )`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Array<{
    id: string;
    action: string;
    old_value: string | null;
    new_value: string | null;
    created_at: string;
    ticket: { ticket_number: string; title: string } | null;
    actor: { full_name: string } | null;
  }>).map((row) => ({
    id: row.id,
    action: row.action,
    old_value: row.old_value,
    new_value: row.new_value,
    created_at: row.created_at,
    ticket_number: row.ticket?.ticket_number ?? null,
    ticket_title: row.ticket?.title ?? null,
    actor_name: row.actor?.full_name ?? null,
  }));
}

export type { TicketHistoryEntry };
