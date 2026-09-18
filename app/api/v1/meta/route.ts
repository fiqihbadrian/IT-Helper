import { apiRoute } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { listCategories, listDepartments, ticketStats } from "@/lib/api/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/meta
 *
 * Everything an integration needs to build a ticket form in one round trip:
 * categories to choose from, departments to attribute the request to, and the
 * counters shown on the dashboard. Read-only, so it is safe to call on every
 * page load.
 */
export const GET = apiRoute(async ({ db }) => {
  const [categories, departments, stats] = await Promise.all([
    listCategories(db),
    listDepartments(db),
    ticketStats(db),
  ]);

  return jsonOk({ categories, departments, stats });
});
