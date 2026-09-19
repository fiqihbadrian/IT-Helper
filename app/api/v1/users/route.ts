import { apiRoute } from "@/lib/api/handler";
import { jsonOk, readPagination } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PersonRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  department: string | null;
  is_active: boolean;
  telegram: { employee: boolean; staff: boolean };
}

/**
 * GET /api/v1/users
 *
 * Who to assign a ticket to, or who filed it. Email is part of the payload
 * because that is the identifier external systems already know people by.
 *
 * Visibility is the `profiles_select` policy: an employee sees only themselves,
 * staff see colleagues. A directory endpoint that leaked every address to every
 * caller would undo that, so there is no elevated query here.
 */
export const GET = apiRoute(async ({ db }, request) => {
  const url = new URL(request.url);
  const { limit, page, offset } = readPagination(url, 50);

  const where: string[] = [];
  const params: unknown[] = [];

  const role = url.searchParams.get("role");
  if (role) {
    params.push(role);
    where.push(`p.role = $${params.length}`);
  }

  const search = url.searchParams.get("q");
  if (search) {
    params.push(`%${search}%`);
    where.push(`(p.full_name ilike $${params.length} or p.email ilike $${params.length})`);
  }

  if (url.searchParams.get("active") !== "all") {
    where.push(`p.is_active = true`);
  }

  const clause = where.length ? `where ${where.join(" and ")}` : "";
  params.push(limit, offset);

  const { rows } = await db.query<PersonRow & { total: number }>(
    `with filtered as (
       select
         p.id,
         p.full_name,
         p.email,
         p.role::text as role,
         (select d.name from public.departments d where d.id = p.department_id) as department,
         p.is_active,
         jsonb_build_object(
           'employee', exists (select 1 from public.telegram_links l
                                where l.profile_id = p.id and l.bot = 'employee'),
           'staff', exists (select 1 from public.telegram_links l
                             where l.profile_id = p.id and l.bot = 'staff')
         ) as telegram
       from public.profiles p
       ${clause}
     )
     select *, (select count(*) from filtered)::int as total
       from filtered
      order by full_name
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  const total = rows[0]?.total ?? 0;
  const items = rows.map(({ total: _total, ...person }) => person);

  return jsonOk({
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
});
