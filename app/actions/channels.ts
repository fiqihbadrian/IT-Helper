"use server";

import { revalidatePath } from "next/cache";

import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { channelSchema, channelStateSchema, parseOrigins } from "@/lib/validation";
import { generateChannelPublicKey } from "@/lib/widget/keys";
import type { ActionResult } from "@/types";

const PAGE = "/admin/channels";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "channel";
}

async function uniqueSlug(
  db: Awaited<ReturnType<typeof createClient>>,
  name: string,
): Promise<string> {
  const base = slugify(name);

  const { data } = await db.from("channels").select("slug").like("slug", `${base}%`);
  const taken = new Set((data ?? []).map((row) => row.slug));

  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Create a channel.
 *
 * A channel needs a profile to act as, and a profile needs an auth user — that
 * foreign key is not negotiable. So a real account is created for the machine,
 * with a password nobody is ever shown and an email at a domain that cannot
 * receive mail. It exists to satisfy the schema and to be the identity widget
 * tickets are filed under; it cannot be signed into.
 *
 * The alternative — teaching RLS to accept anonymous inserts for widget tickets
 * — would have meant a second, weaker authorisation path through every policy
 * that touches tickets. One unusable account is a smaller thing to explain.
 */
export async function createChannel(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const parsed = channelSchema.safeParse({
    name: formData.get("name"),
    origins: formData.get("origins") ?? "",
    greeting: formData.get("greeting"),
    accentColor: formData.get("accentColor"),
    defaultPriority: formData.get("defaultPriority"),
    defaultCategoryId: formData.get("defaultCategoryId") || null,
    departmentId: formData.get("departmentId") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const slug = await uniqueSlug(supabase, parsed.data.name);
  const service = createAdminClient();

  // A password that is generated, never returned, and never recoverable.
  const password = generateChannelPublicKey() + generateChannelPublicKey();
  const { data: created, error: authError } = await service.auth.admin.createUser({
    email: `${slug}@widget.local`,
    password,
    email_confirm: true,
    user_metadata: { full_name: `${parsed.data.name} (widget)`, role: "employee" },
  });

  if (authError || !created.user) {
    return { ok: false, error: authError?.message ?? "Could not create the channel identity" };
  }

  const systemProfileId = created.user.id;

  const { error: profileError } = await service
    .from("profiles")
    .update({
      full_name: `${parsed.data.name} (widget)`,
      role: "employee",
      is_active: true,
      is_system: true,
    })
    .eq("id", systemProfileId);

  if (profileError) {
    await service.auth.admin.deleteUser(systemProfileId);
    return { ok: false, error: profileError.message };
  }

  const { error } = await supabase.from("channels").insert({
    name: parsed.data.name,
    slug,
    public_key: generateChannelPublicKey(),
    allowed_origins: parseOrigins(parsed.data.origins),
    greeting: parsed.data.greeting,
    accent_color: parsed.data.accentColor,
    default_priority: parsed.data.defaultPriority,
    default_category_id: parsed.data.defaultCategoryId,
    department_id: parsed.data.departmentId,
    system_profile_id: systemProfileId,
    created_by: admin.id,
  });

  if (error) {
    // do not leave an orphan account behind if the channel row is rejected
    await service.auth.admin.deleteUser(systemProfileId);
    return { ok: false, error: error.message };
  }

  revalidatePath(PAGE);
  return { ok: true };
}

export async function updateChannel(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const parsed = channelSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    origins: formData.get("origins") ?? "",
    greeting: formData.get("greeting"),
    accentColor: formData.get("accentColor"),
    defaultPriority: formData.get("defaultPriority"),
    defaultCategoryId: formData.get("defaultCategoryId") || null,
    departmentId: formData.get("departmentId") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (!parsed.data.id) return { ok: false, error: "Missing channel id" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channels")
    .update({
      name: parsed.data.name,
      allowed_origins: parseOrigins(parsed.data.origins),
      greeting: parsed.data.greeting,
      accent_color: parsed.data.accentColor,
      default_priority: parsed.data.defaultPriority,
      default_category_id: parsed.data.defaultCategoryId,
      department_id: parsed.data.departmentId,
    })
    .eq("id", parsed.data.id)
    .select("system_profile_id")
    .single();

  if (error) return { ok: false, error: error.message };

  // keep the machine profile's name in step so the ticket timeline reads right
  if (data?.system_profile_id) {
    await createAdminClient()
      .from("profiles")
      .update({ full_name: `${parsed.data.name} (widget)` })
      .eq("id", data.system_profile_id);
  }

  revalidatePath(PAGE);
  return { ok: true };
}

/**
 * Switch a channel off.
 *
 * This is the remedy for a key that ended up somewhere it should not be — not
 * deletion. Deactivating refuses every request immediately and keeps the tickets
 * and their history, which is what an audit needs. Deleting a channel that has
 * conversations is blocked by the foreign key on purpose.
 */
export async function setChannelActive(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const parsed = channelStateSchema.safeParse({
    id: formData.get("id"),
    isActive: formData.get("isActive") === "true",
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("channels")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(PAGE);
  return { ok: true };
}

/**
 * Remove a channel that never received anything.
 *
 * Refused once a ticket exists: those tickets reference the channel and the
 * machine profile that wrote them, and erasing the other side of that history
 * would leave conversations attributed to nobody.
 */
export async function deleteChannel(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "Not authorised" };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing channel id" };

  const supabase = await createClient();
  const { data: channel } = await supabase
    .from("channels")
    .select("id, system_profile_id")
    .eq("id", id)
    .maybeSingle();

  if (!channel) return { ok: false, error: "Channel not found" };

  const { count } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", id);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `This channel has ${count} ticket(s). Switch it off instead of deleting it.`,
    };
  }

  const { error } = await supabase.from("channels").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  // the account only existed to back the channel
  await createAdminClient().auth.admin.deleteUser(channel.system_profile_id);

  revalidatePath(PAGE);
  return { ok: true };
}
