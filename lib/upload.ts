"use client";

import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

const BUCKET = process.env.NEXT_PUBLIC_TICKET_BUCKET ?? "ticket-attachments";

export interface UploadResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export function validateFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;
  }
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type)) {
    return `${file.name} has an unsupported file type`;
  }
  return null;
}

/**
 * Uploads straight to Supabase Storage as the signed-in user. The bucket is
 * private and storage.objects policies check ticket access, so a forged
 * ticket id is rejected by the database.
 */
export async function uploadTicketFile(
  ticketId: string,
  file: File,
): Promise<UploadResult> {
  const invalid = validateFile(file);
  if (invalid) throw new Error(invalid);

  const supabase = createClient();
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
  const filePath = `${ticketId}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(filePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw new Error(error.message);

  return {
    filePath,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
  };
}

export async function getAttachmentUrl(filePath: string, expiresIn = 3600) {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function getAttachmentUrls(filePaths: string[], expiresIn = 3600) {
  if (!filePaths.length) return {} as Record<string, string>;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(filePaths, expiresIn);
  if (error) throw new Error(error.message);

  return Object.fromEntries(
    (data ?? [])
      .filter((item) => item.signedUrl && item.path)
      .map((item) => [item.path as string, item.signedUrl as string]),
  );
}
