import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/types";

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!data || !data.is_active) return null;
  return data as Profile;
});

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireRole(roles: UserRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/dashboard");
  return profile;
}

export async function requireStaff(): Promise<Profile> {
  return requireRole(["it_support", "admin"]);
}

export async function requireAdmin(): Promise<Profile> {
  return requireRole(["admin"]);
}

/** For server actions: throws instead of redirecting. */
export async function assertStaff(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not authenticated");
  if (profile.role !== "it_support" && profile.role !== "admin") {
    throw new Error("Not authorised");
  }
  return profile;
}

export async function assertAdmin(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not authenticated");
  if (profile.role !== "admin") throw new Error("Not authorised");
  return profile;
}

export function landingPathFor(role: UserRole) {
  return "/dashboard";
}
