import "server-only";

import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv, telegramEnv } from "@/lib/env";
import type { BotKind } from "@/lib/telegram/bots";
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";

/**
 * Telegram hosts files behind a token-protected URL. To attach a screenshot to a
 * ticket we have to fetch it ourselves and re-upload it to Supabase Storage, so
 * the ticket keeps a permanent, access-controlled copy instead of a file_id that
 * only this bot can resolve.
 */

const API = "https://api.telegram.org";

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export async function downloadTelegramFile(
  bot: BotKind,
  fileId: string,
): Promise<{ buffer: Buffer; filePath: string } | null> {
  const token = telegramEnv.botToken(bot);

  const infoResponse = await fetch(`${API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, {
    cache: "no-store",
  });
  const info = (await infoResponse.json()) as { ok: boolean; result?: TelegramFile };
  if (!info.ok || !info.result?.file_path) return null;

  // Telegram caps bot downloads at 20 MB, so this is the real ceiling.
  if ((info.result.file_size ?? 0) > MAX_UPLOAD_BYTES) return null;

  const fileResponse = await fetch(`${API}/file/bot${token}/${info.result.file_path}`, {
    cache: "no-store",
  });
  if (!fileResponse.ok) return null;

  return {
    buffer: Buffer.from(await fileResponse.arrayBuffer()),
    filePath: info.result.file_path,
  };
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
};

export function mimeFromPath(filePath: string, fallback = "application/octet-stream") {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[extension] ?? fallback;
}

export interface StoredAttachment {
  file_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
}

/**
 * Uploads into the same private bucket and path convention the web app uses
 * (`<ticket_id>/<uuid>-<filename>`), so the storage RLS policies in 0004 apply
 * unchanged and both channels produce identical rows.
 */
export async function uploadToTicket(
  ticketId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<StoredAttachment> {
  const supabase = createAdminClient();
  const bucket = publicEnv.ticketBucket;

  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("File is larger than the 10 MB limit.");
  }

  const safeName = fileName.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const path = `${ticketId}/${randomUUID()}-${safeName}`;

  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) throw new Error(error.message);

  return {
    file_path: path,
    file_name: safeName,
    mime_type: mimeType,
    file_size: buffer.byteLength,
  };
}
