import { apiRoute } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/response";
import { ticketStats } from "@/lib/api/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/me
 *
 * The first call any integration should make: it tells you which account the key
 * belongs to and what that account is allowed to do, so a script can fail fast
 * instead of guessing. The email is included deliberately — it is the identity
 * an external tool needs to map its own records onto this system.
 */
export const GET = apiRoute(async ({ db, identity }) => {
  const { rows } = await db.query<{
    full_name: string;
    email: string;
    role: string;
    is_active: boolean;
    department: string | null;
    telegram_linked: boolean;
    created_at: string;
  }>(
    `select
       p.full_name,
       p.email,
       p.role::text as role,
       p.is_active,
       (select d.name from public.departments d where d.id = p.department_id) as department,
       (p.telegram_user_id is not null) as telegram_linked,
       p.created_at
     from public.profiles p
     where p.id = auth.uid()`,
  );

  const profile = rows[0];
  if (!profile) throw new Error("Profile not found for this API key.");

  return jsonOk({
    id: identity.userId,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role,
    department: profile.department,
    is_active: profile.is_active,
    telegram_linked: profile.telegram_linked,
    member_since: profile.created_at,
    api_key: { id: identity.keyId, name: identity.keyName },
    permissions: {
      create_ticket: true,
      view_all_tickets: profile.role === "it_support" || profile.role === "admin",
      change_status: profile.role === "it_support" || profile.role === "admin",
      manage_users: profile.role === "admin",
    },
    stats: await ticketStats(db),
  });
});
