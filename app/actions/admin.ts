"use server";

import { revalidatePath } from "next/cache";

import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  categorySchema,
  createUserSchema,
  departmentSchema,
  updateUserSchema,
} from "@/lib/validation";
import type { ActionResult, UserRole } from "@/types";
import type { Database } from "@/types/database";

type ProfilePatch = Database["public"]["Tables"]["profiles"]["Update"];

// -----------------------------------------------------------------------------
// Users
// -----------------------------------------------------------------------------

export async function createUser(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const parsed = createUserSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
    departmentId: formData.get("departmentId") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullName,
      role: parsed.data.role,
      department_id: parsed.data.departmentId ?? null,
    },
  });

  if (error) return { ok: false, error: error.message };

  // handle_new_user() created the profile; make sure the optional columns match
  if (data.user) {
    await admin
      .from("profiles")
      .update({
        full_name: parsed.data.fullName,
        role: parsed.data.role,
        department_id: parsed.data.departmentId ?? null,
      })
      .eq("id", data.user.id);
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateUser(
  input: {
    userId: string;
    fullName?: string;
    role?: UserRole;
    departmentId?: string | null;
    isActive?: boolean;
  },
): Promise<ActionResult> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const patch: ProfilePatch = {};
  if (parsed.data.fullName !== undefined) patch.full_name = parsed.data.fullName;
  if (parsed.data.role !== undefined) patch.role = parsed.data.role;
  if (parsed.data.departmentId !== undefined) patch.department_id = parsed.data.departmentId;
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;

  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", parsed.data.userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/users");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------

export async function saveCategory(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const parsed = categorySchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const payload = {
    name: parsed.data.name,
    description: parsed.data.description || null,
    is_active: parsed.data.isActive,
  };

  const { error } = parsed.data.id
    ? await supabase.from("categories").update(payload).eq("id", parsed.data.id)
    : await supabase.from("categories").insert(payload);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/categories");
  revalidatePath("/tickets/new");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Departments
// -----------------------------------------------------------------------------

export async function saveDepartment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const parsed = departmentSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = parsed.data.id
    ? await supabase.from("departments").update({ name: parsed.data.name }).eq("id", parsed.data.id)
    : await supabase.from("departments").insert({ name: parsed.data.name });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/departments");
  return { ok: true };
}
