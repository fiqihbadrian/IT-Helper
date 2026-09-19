import "server-only";

import type { Db } from "@/services/tickets";
import type { Category, Channel, Department } from "@/types";

export interface ChannelSummary extends Channel {
  category: Pick<Category, "id" | "name"> | null;
  department: Pick<Department, "id" | "name"> | null;
  tickets: number;
  openTickets: number;
}

const CHANNEL_SELECT = `
  id, name, slug, public_key, allowed_origins, department_id, default_category_id,
  default_priority, greeting, accent_color, system_profile_id, is_active,
  created_by, created_at, updated_at,
  category:categories ( id, name ),
  department:departments ( id, name )
`;

/**
 * Every channel, with the two numbers an admin actually wants next to it: how
 * much has come in, and how much is still open.
 *
 * Counted with a second query rather than an aggregate embed. PostgREST can do
 * `count` per embedded row, but it means one subquery per channel and the shape
 * it returns is awkward; two round trips over a table with a handful of rows is
 * cheaper and easier to read.
 */
export async function listChannels(db: Db): Promise<ChannelSummary[]> {
  const { data, error } = await db
    .from("channels")
    .select(CHANNEL_SELECT)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: ticketRows, error: ticketError } = await db
    .from("tickets")
    .select("channel_id, status")
    .not("channel_id", "is", null);
  if (ticketError) throw new Error(ticketError.message);

  const totals = new Map<string, { all: number; open: number }>();
  for (const row of ticketRows ?? []) {
    if (!row.channel_id) continue;
    const entry = totals.get(row.channel_id) ?? { all: 0, open: 0 };
    entry.all += 1;
    if (row.status !== "CLOSED" && row.status !== "RESOLVED") entry.open += 1;
    totals.set(row.channel_id, entry);
  }

  return (data ?? []).map((row) => {
    const counts = totals.get(row.id) ?? { all: 0, open: 0 };
    return {
      ...row,
      allowed_origins: row.allowed_origins ?? [],
      tickets: counts.all,
      openTickets: counts.open,
    } as unknown as ChannelSummary;
  });
}
