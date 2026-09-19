import type { TicketPriority, TicketSource, TicketStatus, UserRole } from "@/types";

/**
 * Full class strings (not interpolated) so Tailwind's scanner keeps them.
 */

/**
 * A state picks a tone by name; the tone supplies its own colours per theme in
 * `app/globals.css`. Components therefore never carry a `dark:` variant.
 */
export type Tone =
  | "open"
  | "closed"
  | "assigned"
  | "medium"
  | "progress"
  | "waiting"
  | "resolved"
  | "high"
  | "critical"
  | "admin";

export const STATUS_META: Record<TicketStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Open", tone: "open" },
  ASSIGNED: { label: "Assigned", tone: "assigned" },
  IN_PROGRESS: { label: "In Progress", tone: "progress" },
  WAITING_USER: { label: "Waiting User", tone: "waiting" },
  RESOLVED: { label: "Resolved", tone: "resolved" },
  CLOSED: { label: "Closed", tone: "closed" },
};

export const PRIORITY_META: Record<TicketPriority, { label: string; tone: Tone }> = {
  LOW: { label: "Low", tone: "open" },
  MEDIUM: { label: "Medium", tone: "medium" },
  HIGH: { label: "High", tone: "high" },
  CRITICAL: { label: "Critical", tone: "critical" },
};

export const ROLE_META: Record<UserRole, { label: string; tone: Tone }> = {
  employee: { label: "Employee", tone: "open" },
  it_support: { label: "IT Support", tone: "assigned" },
  admin: { label: "Admin", tone: "admin" },
};

export const TICKET_STATUSES: TicketStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_USER",
  "RESOLVED",
  "CLOSED",
];

export const TICKET_PRIORITIES: TicketPriority[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
];

export const USER_ROLES: UserRole[] = ["employee", "it_support", "admin"];

export const HISTORY_ACTION_LABEL: Record<string, string> = {
  CREATED: "created this ticket",
  STATUS_CHANGED: "changed status",
  PRIORITY_CHANGED: "changed priority",
  ASSIGNED: "assigned this ticket",
  CATEGORY_CHANGED: "changed category",
  COMMENT_ADDED: "replied",
  ATTACHMENT_ADDED: "attached a file",
};

export const ALLOWED_UPLOAD_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB, matches the bucket limit

/**
 * Where a ticket came in from.
 *
 * `web` is the app itself; the other three are the surfaces that were added
 * later. It is a stored column rather than something inferred, because "web",
 * "api" and "telegram" all arrive without a channel and are still different
 * origins — inferring would collapse them.
 */
export const SOURCE_META: Record<TicketSource, { label: string; short: string }> = {
  web: { label: "Web app", short: "web" },
  telegram: { label: "Telegram", short: "telegram" },
  api: { label: "REST API", short: "api" },
  widget: { label: "Web widget", short: "widget" },
};
