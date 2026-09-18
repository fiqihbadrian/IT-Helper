export type UserRole = "employee" | "it_support" | "admin";

export type TicketStatus =
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "WAITING_USER"
  | "RESOLVED"
  | "CLOSED";

export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type HistoryAction =
  | "CREATED"
  | "STATUS_CHANGED"
  | "PRIORITY_CHANGED"
  | "ASSIGNED"
  | "CATEGORY_CHANGED"
  | "COMMENT_ADDED"
  | "ATTACHMENT_ADDED";

export interface Department {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  department_id: string | null;
  telegram_user_id: number | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  category_id: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  created_by: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  user_id: string;
  message: string;
  created_at: string;
  updated_at: string;
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  uploaded_by: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  created_at: string;
}

export interface TicketHistoryEntry {
  id: string;
  ticket_id: string;
  user_id: string | null;
  action: HistoryAction;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  ticket_id: string | null;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

/** Ticket row joined with the relations the UI always needs. */
export interface TicketWithRelations extends Ticket {
  category: Pick<Category, "id" | "name"> | null;
  requester: Pick<Profile, "id" | "full_name" | "email" | "avatar_url"> | null;
  assignee: Pick<Profile, "id" | "full_name" | "email" | "avatar_url"> | null;
}

export interface CommentWithRelations extends TicketComment {
  author: Pick<Profile, "id" | "full_name" | "email" | "avatar_url" | "role"> | null;
  attachments: TicketAttachment[];
}

export interface HistoryWithActor extends TicketHistoryEntry {
  actor: Pick<Profile, "id" | "full_name" | "role"> | null;
}

export interface TicketDetail extends TicketWithRelations {
  comments: CommentWithRelations[];
  history: HistoryWithActor[];
  attachments: TicketAttachment[];
}

export interface TicketFilters {
  search?: string;
  status?: TicketStatus | "ALL";
  priority?: TicketPriority | "ALL";
  categoryId?: string;
  technicianId?: string;
  departmentId?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: TicketSort;
  scope?: TicketScope;
}

export type TicketScope = "all" | "mine" | "unassigned" | "high_priority" | "created";

export type TicketSort =
  | "newest"
  | "oldest"
  | "priority"
  | "updated";

export interface DashboardStats {
  open: number;
  assigned: number;
  inProgress: number;
  waitingUser: number;
  resolved: number;
  closed: number;
  active: number;
  unassigned: number;
  assignedToMe: number;
  highPriority: number;
  critical: number;
  total: number;
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}
