import "server-only";

import type { Db } from "@/services/tickets";
import type { Notification } from "@/types";

export async function listNotifications(
  db: Db,
  userId: string,
  limit = 50,
): Promise<Notification[]> {
  const { data, error } = await db
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Notification[];
}

export async function countUnread(db: Db, userId: string): Promise<number> {
  const { count, error } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
