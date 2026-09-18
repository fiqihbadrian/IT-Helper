import { apiRoute } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1
 *
 * Discovery endpoint. An AI tool or a developer poking at the URL should be able
 * to learn the surface without reading the source, so the routes and the
 * accepted enum values are described here.
 */
export const GET = apiRoute(async ({ identity }) => {
  return jsonOk({
    service: "IT Helpdesk API",
    version: "v1",
    caller: { email: identity.email, full_name: identity.fullName, role: identity.role },
    auth: {
      header: "Authorization: Bearer itk_...",
      alternative: "X-API-Key: itk_...",
      note: "A key acts as its owner. Row Level Security decides what it can see.",
    },
    endpoints: [
      { method: "GET", path: "/api/v1", description: "This document" },
      { method: "GET", path: "/api/v1/me", description: "Caller identity, permissions, stats" },
      { method: "GET", path: "/api/v1/meta", description: "Categories, departments, counters" },
      { method: "GET", path: "/api/v1/users", description: "Directory, scoped by RLS" },
      { method: "GET", path: "/api/v1/tickets", description: "List tickets, filter and paginate" },
      { method: "POST", path: "/api/v1/tickets", description: "Create a ticket" },
      { method: "GET", path: "/api/v1/tickets/{number}", description: "One ticket" },
      { method: "PATCH", path: "/api/v1/tickets/{number}", description: "Update status, priority, assignee" },
      { method: "GET", path: "/api/v1/tickets/{number}/comments", description: "Conversation" },
      { method: "POST", path: "/api/v1/tickets/{number}/comments", description: "Post a comment" },
    ],
    filters: {
      tickets: ["status", "priority", "category_id", "q", "page", "limit"],
      users: ["role", "q", "active=all", "page", "limit"],
    },
    enums: {
      status: ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"],
      priority: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      role: ["employee", "it_support", "admin"],
    },
    examples: {
      create_ticket: {
        method: "POST",
        path: "/api/v1/tickets",
        body: {
          title: "Printer lantai 3 offline",
          description: "Muncul error offline sejak pagi, sudah restart tetap sama.",
          priority: "HIGH",
          requester_email: identity.email,
        },
      },
      list_my_tickets: { method: "GET", path: "/api/v1/tickets?status=OPEN&limit=10" },
      close_ticket: {
        method: "PATCH",
        path: "/api/v1/tickets/IT-000004",
        body: { status: "RESOLVED" },
      },
    },
  });
});
