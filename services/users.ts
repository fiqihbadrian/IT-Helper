import "server-only";

import type { Db } from "@/services/tickets";
import type { Department, Profile } from "@/types";

export interface ProfileWithDepartment extends Profile {
  department: Pick<Department, "id" | "name"> | null;
}

export async function listProfiles(db: Db): Promise<ProfileWithDepartment[]> {
  const { data, error } = await db
    .from("profiles")
    .select(
      `id, full_name, email, role, department_id, avatar_url,
       is_active, created_at, updated_at,
       department:departments ( id, name )`,
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProfileWithDepartment[];
}

export async function listDepartments(db: Db): Promise<Department[]> {
  const { data, error } = await db
    .from("departments")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Department[];
}
