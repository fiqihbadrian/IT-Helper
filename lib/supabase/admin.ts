import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleKey, publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Service-role client. Bypasses RLS — never import this from a client
 * component and never return raw results to an unauthenticated caller.
 * Used only for admin-only user provisioning.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    publicEnv.supabaseUrl,
    getServiceRoleKey(),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
