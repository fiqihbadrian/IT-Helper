import "server-only";

import { asSystem, asUser, type Queryable } from "@/lib/db/pool";
import { forbidden, unauthorized } from "@/lib/api/errors";

export interface ApiIdentity {
  userId: string;
  keyId: string;
  keyName: string;
  email: string;
  fullName: string;
  role: "employee" | "it_support" | "admin";
}

export interface ApiContext {
  identity: ApiIdentity;
  /** Already impersonating `identity`; every query is subject to RLS. */
  db: Queryable;
}

/** `Authorization: Bearer <key>` or the single-field `X-API-Key: <key>`. */
export function readApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }
  return request.headers.get("x-api-key")?.trim() || null;
}

export async function resolveIdentity(request: Request): Promise<ApiIdentity> {
  const key = readApiKey(request);
  if (!key) throw unauthorized();

  const row = await asSystem(async (db) => {
    const { rows } = await db.query<{
      user_id: string;
      key_id: string;
      key_name: string;
      role: ApiIdentity["role"];
      email: string;
      full_name: string;
    }>("select * from public.verify_api_key($1)", [key]);
    return rows[0];
  });

  if (!row) throw unauthorized("This API key is invalid, revoked, or expired.");

  return {
    userId: row.user_id,
    keyId: row.key_id,
    keyName: row.key_name,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
  };
}

/**
 * Run a handler inside a transaction authenticated as the API key's owner. The
 * transaction commits when the handler returns, so multi-statement writes are
 * atomic, and `set local` guarantees the impersonation cannot leak onto the next
 * request that borrows the pooled connection.
 */
export async function withIdentity<T>(
  identity: ApiIdentity,
  handler: (ctx: ApiContext) => Promise<T>,
): Promise<T> {
  return asUser(identity.userId, (db) => handler({ identity, db }));
}

export function requireRole(identity: ApiIdentity, ...roles: ApiIdentity["role"][]) {
  if (!roles.includes(identity.role)) {
    throw forbidden(`This endpoint requires one of: ${roles.join(", ")}.`);
  }
}

export const isStaff = (identity: ApiIdentity) =>
  identity.role === "it_support" || identity.role === "admin";
