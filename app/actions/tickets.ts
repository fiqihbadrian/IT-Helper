"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  attachmentSchema,
  commentSchema,
  createTicketSchema,
  ticketUpdateSchema,
} from "@/lib/validation";
import type { ActionResult, TicketPriority, TicketStatus } from "@/types";
import type { Database } from "@/types/database";

type TicketPatch = Database["public"]["Tables"]["tickets"]["Update"];

export async function createTicket(
  _prev: ActionResult<{ id: string; ticketNumber: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; ticketNumber: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not authenticated" };

  const parsed = createTicketSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    priority: formData.get("priority"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description,
      category_id: parsed.data.categoryId,
      priority: parsed.data.priority,
      created_by: profile.id,
      status: "OPEN",
    })
    .select("id, ticket_number")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/tickets");
  revalidatePath("/notifications");

  return {
    ok: true,
    data: { id: data.id, ticketNumber: data.ticket_number },
  };
}

export async function addComment(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not authenticated" };

  const parsed = commentSchema.safeParse({
    ticketId: formData.get("ticketId"),
    message: formData.get("message"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ticket_comments")
    .insert({
      ticket_id: parsed.data.ticketId,
      user_id: profile.id,
      message: parsed.data.message,
    })
    .select("id")
    .single();

  if (error) {
    // RLS rejects this when the ticket is not visible to the caller
    return { ok: false, error: "You cannot reply to this ticket" };
  }

  revalidatePath(`/tickets/${parsed.data.ticketId}`);
  revalidatePath("/notifications");
  return { ok: true, data: { id: data.id } };
}

export async function registerAttachment(
  input: {
    ticketId: string;
    commentId?: string | null;
    fileName: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
  },
): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not authenticated" };

  const parsed = attachmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ticket_attachments").insert({
    ticket_id: parsed.data.ticketId,
    comment_id: parsed.data.commentId ?? null,
    uploaded_by: profile.id,
    file_name: parsed.data.fileName,
    file_path: parsed.data.filePath,
    file_size: parsed.data.fileSize,
    mime_type: parsed.data.mimeType,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/tickets/${parsed.data.ticketId}`);
  return { ok: true };
}

export async function updateTicket(
  input: {
    ticketId: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    categoryId?: string | null;
    assignedTo?: string | null;
  },
): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not authenticated" };
  if (profile.role !== "it_support" && profile.role !== "admin") {
    return { ok: false, error: "Not authorised" };
  }

  const parsed = ticketUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const patch: TicketPatch = {};
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
  if (parsed.data.categoryId !== undefined) patch.category_id = parsed.data.categoryId;
  if (parsed.data.assignedTo !== undefined) patch.assigned_to = parsed.data.assignedTo;

  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tickets")
    .update(patch)
    .eq("id", parsed.data.ticketId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/tickets/${parsed.data.ticketId}`);
  revalidatePath("/tickets");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  return { ok: true };
}

export async function assignToMe(ticketId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not authenticated" };
  if (profile.role !== "it_support" && profile.role !== "admin") {
    return { ok: false, error: "Not authorised" };
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("tickets")
    .select("status")
    .eq("id", ticketId)
    .maybeSingle();

  const patch: TicketPatch = { assigned_to: profile.id };
  if (!current || current.status === "OPEN") patch.status = "ASSIGNED";

  const { error } = await supabase.from("tickets").update(patch).eq("id", ticketId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  revalidatePath("/dashboard");
  return { ok: true };
}
