import "server-only";

import { asUser } from "@/lib/db/pool";
import { mimeFromPath, downloadTelegramFile, uploadToTicket } from "@/lib/telegram/files";

export interface TelegramPhoto {
  file_id: string;
  file_size?: number;
}

/**
 * Attach a Telegram photo to an existing ticket.
 *
 * Runs the DB insert as the user, so the storage and attachment policies still
 * decide whether they are allowed to attach to this ticket — the bot has no
 * special privileges here.
 */
export async function attachPhoto(
  userId: string,
  ticketId: string,
  photo: TelegramPhoto,
  caption?: string,
): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  try {
    const file = await downloadTelegramFile(photo.file_id);
    if (!file) {
      return { ok: false, reason: "Foto tidak bisa diambil dari Telegram (mungkin terlalu besar)." };
    }

    const mime = mimeFromPath(file.filePath, "image/jpeg");
    const name = `telegram-${photo.file_id.slice(-12)}.${file.filePath.split(".").pop() ?? "jpg"}`;
    const stored = await uploadToTicket(ticketId, name, mime, file.buffer);

    const inserted = await asUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.ticket_attachments
           (ticket_id, uploaded_by, file_name, file_path, mime_type, file_size)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [ticketId, userId, stored.file_name, stored.file_path, stored.mime_type, stored.file_size],
      );
      return rows[0];
    });

    if (!inserted) {
      return { ok: false, reason: "Kamu tidak punya akses ke tiket ini." };
    }

    if (caption?.trim()) {
      await asUser(userId, async (db) => {
        await db.query(
          `insert into public.ticket_comments (ticket_id, user_id, message) values ($1, $2, $3)`,
          [ticketId, userId, caption.trim().slice(0, 5000)],
        );
      });
    }

    return { ok: true, name: stored.file_name };
  } catch (error) {
    console.error("[telegram] attachPhoto failed", error);
    return { ok: false, reason: "Gagal mengunggah foto." };
  }
}
