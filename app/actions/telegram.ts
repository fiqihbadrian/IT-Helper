"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createApiKey, createTelegramLinkCode, revokeApiKey } from "@/services/telegram";
import type { ActionResult } from "@/types";

export async function generateTelegramLinkCode(): Promise<
  ActionResult<{ code: string; expiresAt: string }>
> {
  const profile = await requireProfile();
  if (!profile.is_active) return { ok: false, error: "Akun kamu tidak aktif." };

  const supabase = await createClient();
  const result = await createTelegramLinkCode(supabase);

  if (!result) return { ok: false, error: "Gagal membuat kode. Coba lagi." };

  revalidatePath("/profile");
  return { ok: true, data: { code: result.code, expiresAt: result.expires_at } };
}

export async function createUserApiKey(
  formData: FormData,
): Promise<ActionResult<{ apiKey: string; name: string }>> {
  const profile = await requireProfile();
  if (!profile.is_active) return { ok: false, error: "Akun kamu tidak aktif." };

  const name = String(formData.get("name") ?? "").trim() || "Tanpa nama";
  if (name.length > 60) return { ok: false, error: "Nama maksimal 60 karakter." };

  const supabase = await createClient();
  const created = await createApiKey(supabase, name);

  if (!created) return { ok: false, error: "Gagal membuat API key." };

  revalidatePath("/profile");
  return { ok: true, data: { apiKey: created.api_key, name: created.name } };
}

export async function revokeUserApiKey(id: string): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!profile.is_active) return { ok: false, error: "Akun kamu tidak aktif." };

  const supabase = await createClient();
  const revoked = await revokeApiKey(supabase, id);

  revalidatePath("/profile");
  return revoked
    ? { ok: true }
    : { ok: false, error: "Key tidak ditemukan atau bukan milikmu." };
}
