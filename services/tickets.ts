import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import type {
  Category,
  CommentWithRelations,
  DashboardStats,
  HistoryWithActor,
  Profile,
  TicketAttachment,
  TicketFilters,
  TicketPriority,
  TicketScope,
  TicketWithRelations,
} from "@/types";

export type Db = SupabaseClient<Database>;

export const TICKET_SELECT = `
  id, ticket_number, title, description, category_id, priority, status,
  source, channel_id, created_by, assigned_to, created_at, updated_at, resolved_at, closed_at,
  category:categories ( id, name ),
  requester:profiles!tickets_created_by_fkey ( id, full_name, email, avatar_url ),
  assignee:profiles!tickets_assigned_to_fkey ( id, full_name, email, avatar_url ),
  contact:ticket_contacts ( name, email ),
  channel:channels ( id, name, slug )
`;

const PRIORITY_RANK: Record<TicketPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export const PAGE_SIZE = 20;

export interface TicketListResult {
  tickets: TicketWithRelations[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listTickets(
  db: Db,
  filters: TicketFilters,
  currentUserId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<TicketListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = db
    .from("tickets")
    .select(TICKET_SELECT, { count: "exact" });

  const scope: TicketScope = filters.scope ?? "all";
  if (scope === "created") query = query.eq("created_by", currentUserId);
  if (scope === "mine") query = query.eq("assigned_to", currentUserId);
  if (scope === "unassigned") query = query.is("assigned_to", null);
  if (scope === "high_priority") query = query.in("priority", ["HIGH", "CRITICAL"]);

  if (filters.status && filters.status !== "ALL") {
    query = query.eq("status", filters.status);
  }
  if (filters.priority && filters.priority !== "ALL") {
    query = query.eq("priority", filters.priority);
  }
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.technicianId) query = query.eq("assigned_to", filters.technicianId);
  if (filters.departmentId) {
    const { data: people } = await db
      .from("profiles")
      .select("id")
      .eq("department_id", filters.departmentId);
    const ids = (people ?? []).map((person) => person.id);
    // an empty department must match nothing rather than everything
    query = query.in(
      "created_by",
      ids.length ? ids : ["00000000-0000-0000-0000-000000000000"],
    );
  }
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", `${filters.dateTo}T23:59:59.999Z`);

  if (filters.search?.trim()) {
    const term = filters.search.trim().replace(/[%,()]/g, " ").trim();
    const { data: people } = await db
      .from("profiles")
      .select("id")
      .ilike("full_name", `%${term}%`)
      .limit(50);

    const conditions = [
      `ticket_number.ilike.%${term}%`,
      `title.ilike.%${term}%`,
      `description.ilike.%${term}%`,
    ];
    if (people?.length) {
      conditions.push(`created_by.in.(${people.map((p) => p.id).join(",")})`);
    }
    query = query.or(conditions.join(","));
  }

  const sort = filters.sort ?? "newest";
  if (sort === "oldest") query = query.order("created_at", { ascending: true });
  else if (sort === "updated") query = query.order("updated_at", { ascending: false });
  else query = query.order("created_at", { ascending: false });

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);

  let tickets = (data ?? []) as unknown as TicketWithRelations[];

  if (sort === "priority") {
    tickets = [...tickets].sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    );
  }

  const total = count ?? tickets.length;
  return {
    tickets,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getTicketById(
  db: Db,
  ticketId: string,
): Promise<TicketWithRelations | null> {
  const { data, error } = await db
    .from("tickets")
    .select(TICKET_SELECT)
    .eq("id", ticketId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as unknown as TicketWithRelations) ?? null;
}

export async function getTicketDetail(
  db: Db,
  ticketId: string,
): Promise<{
  ticket: TicketWithRelations;
  comments: CommentWithRelations[];
  history: HistoryWithActor[];
  attachments: TicketAttachment[];
} | null> {
  const ticket = await getTicketById(db, ticketId);
  if (!ticket) return null;

  const [commentsResult, historyResult, attachmentsResult] = await Promise.all([
    db
      .from("ticket_comments")
      .select(
        `id, ticket_id, user_id, message, created_at, updated_at,
         author:profiles!ticket_comments_user_id_fkey ( id, full_name, email, avatar_url, role )`,
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
    db
      .from("ticket_history")
      .select(
        `id, ticket_id, user_id, action, old_value, new_value, created_at,
         actor:profiles!ticket_history_user_id_fkey ( id, full_name, role )`,
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
    db
      .from("ticket_attachments")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
  ]);

  if (commentsResult.error) throw new Error(commentsResult.error.message);
  if (historyResult.error) throw new Error(historyResult.error.message);
  if (attachmentsResult.error) throw new Error(attachmentsResult.error.message);

  const attachments = (attachmentsResult.data ?? []) as TicketAttachment[];
  const comments = ((commentsResult.data ?? []) as unknown as CommentWithRelations[]).map(
    (comment) => ({
      ...comment,
      attachments: attachments.filter((file) => file.comment_id === comment.id),
    }),
  );

  return {
    ticket,
    comments,
    history: (historyResult.data ?? []) as unknown as HistoryWithActor[],
    attachments: attachments.filter((file) => !file.comment_id),
  };
}

export async function getDashboardStats(db: Db): Promise<DashboardStats> {
  const { data, error } = await db.rpc("ticket_stats");
  if (error) throw new Error(error.message);

  const stats = (data ?? {}) as Record<string, number>;
  return {
    total: stats.total ?? 0,
    open: stats.open ?? 0,
    assigned: stats.assigned ?? 0,
    inProgress: stats.in_progress ?? 0,
    waitingUser: stats.waiting_user ?? 0,
    resolved: stats.resolved ?? 0,
    closed: stats.closed ?? 0,
    active: stats.active ?? 0,
    unassigned: stats.unassigned ?? 0,
    assignedToMe: stats.assigned_to_me ?? 0,
    highPriority: stats.high_priority ?? 0,
    critical: stats.critical ?? 0,
  };
}

export async function getRecentTickets(
  db: Db,
  limit = 5,
  scope: TicketScope = "all",
  currentUserId = "",
) {
  const result = await listTickets(
    db,
    { scope, sort: "newest" },
    currentUserId,
    { page: 1, pageSize: limit },
  );
  return result.tickets;
}

export async function getActiveTechnicians(db: Db): Promise<Profile[]> {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .in("role", ["it_support", "admin"])
    .eq("is_active", true)
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function getActiveCategories(db: Db): Promise<Category[]> {
  const { data, error } = await db
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Category[];
}
