import "server-only";

import { PRIORITY_META, STATUS_META } from "@/lib/constants";
import { isStaffRole, type BotKind } from "@/lib/telegram/bots";
import type {
  InlineKeyboardButton,
  TelegramApi,
  TelegramCallbackQuery,
  TelegramMessage,
} from "@/lib/telegram/client";
import { telegramApi } from "@/lib/telegram/client";
import { ensureDefaultCommands } from "@/lib/telegram/menu";
import {
  clearSession,
  escapeMarkdown as md,
  flushNotifications,
  getSession,
  profileForChat,
  redeemLinkCode,
  setSession,
  unlinkChat,
  type BotSession,
} from "@/lib/telegram/session";
import {
  addComment,
  claimTicket,
  claimByNumber,
  commentByNumber,
  createTicket,
  findTicketById,
  findTicketByNumber,
  listCategories,
  listComments,
  listMyTickets,
  listQueue,
  searchTickets,
  setStatusByNumber,
  ticketKeyboard,
  updateTicketStatus,
  type BotTicketRow,
  type StaffQueue,
} from "@/lib/telegram/tickets";
import { attachPhoto } from "@/lib/telegram/attachments";
import type { TicketPriority, TicketStatus } from "@/types";

/**
 * Which bot is answering, and the API client bound to its token.
 *
 * Threaded explicitly through every function rather than read from a module
 * global: on Cloudflare Workers one isolate serves both bots concurrently, so a
 * "current bot" would leak across requests.
 */
export interface BotContext {
  bot: BotKind;
  api: TelegramApi;
}

export function botContext(bot: BotKind): BotContext {
  return { bot, api: telegramApi(bot) };
}

/** True on the staff bot, where everybody linked is on the bench by definition. */
function isStaffBot(ctx: BotContext) {
  return ctx.bot === "staff";
}

/**
 * The staff commands, which only exist on the staff bot.
 *
 * The employee bot does not merely hide these from its menu — it has no path to
 * them at all, because the only account that can link the staff bot is a staff
 * account. This set is here so an employee who types `/queue` out of curiosity
 * gets a straight answer instead of "unknown command".
 */
const STAFF_ONLY = new Set(["queue", "open", "unassigned", "find", "claim", "close"]);

function helpText(ctx: BotContext) {
  const lines = [
    isStaffBot(ctx) ? "*IT Helpdesk — bot tim IT*" : "*IT Helpdesk — bot karyawan*",
    "",
    "*Buat tiket*",
    "`/new` — laporkan masalah, langkah demi langkah",
    "",
    "*Tiket kamu*",
    "`/tickets` — 10 tiket terakhir milikmu",
    "`/ticket IT-000004` — satu tiket beserta percakapannya",
    "`/reply IT-000004 pesan` — balas langsung dari sini",
  ];

  if (isStaffBot(ctx)) {
    lines.push(
      "",
      "*Antrean tim IT*",
      "`/queue` — semua tiket",
      "`/open` — tiket yang belum selesai",
      "`/unassigned` — tiket yang belum ditangani",
      "`/find printer` — cari nomor atau judul",
      "`/claim IT-000004` — ambil tiket",
      "`/close IT-000004` — tutup tiket",
    );
  }

  lines.push(
    "",
    "*Akun*",
    "`/status` — ringkasan akun",
    "`/unlink` — putuskan akun Telegram ini",
    "`/help` — pesan ini",
  );

  return lines.join("\n");
}

function welcomeText(ctx: BotContext) {
  const lines = [
    isStaffBot(ctx)
      ? "*Bot tim IT — IT Helpdesk*"
      : "*Selamat datang di IT Helpdesk*",
    "",
    isStaffBot(ctx)
      ? "Bot ini untuk tim IT: antrean, ambil tiket, ubah status."
      : "Bot ini terhubung ke sistem tiket yang sama dengan web.",
    "",
    "Untuk mulai, hubungkan akun:",
    "1. Buka *Profil → Telegram* di web",
    "2. Salin kode yang muncul",
    "3. Kirim ke sini sebagai `/start KODE`",
  ];

  if (isStaffBot(ctx)) {
    lines.push(
      "",
      "_Hanya akun `it_support` dan `admin` yang bisa menghubungkan bot ini._",
    );
  }

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function statusLine(status: TicketStatus) {
  return STATUS_META[status]?.label ?? status;
}

function priorityLine(priority: TicketPriority) {
  return PRIORITY_META[priority]?.label ?? priority;
}

function formatTicket(ticket: BotTicketRow, withDescription = true) {
  const lines = [
    `*#${md(ticket.ticket_number)}* · ${md(statusLine(ticket.status))} · ${md(priorityLine(ticket.priority))}`,
    `*${md(ticket.title)}*`,
    "",
    `Kategori: ${md(ticket.category ?? "Tanpa kategori")}`,
    `Ditangani: ${md(ticket.assignee ?? "Belum ada")}`,
    `Dibuat: ${md(new Date(ticket.created_at).toLocaleString("id-ID"))}`,
  ];

  if (withDescription) {
    lines.push("", "```", ticket.description.slice(0, 900), "```");
  }

  return lines.join("\n");
}

function formatConversation(comments: Awaited<ReturnType<typeof listComments>>) {
  if (!comments.length) return "_Belum ada balasan._";

  return comments
    .map((comment) => {
      const who = comment.is_staff ? `${comment.author} (IT)` : comment.author;
      return `*${md(who)}*\n${md(comment.message.slice(0, 400))}`;
    })
    .join("\n\n");
}

function priorityKeyboard(): InlineKeyboardButton[][] {
  const order: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return [
    order.map((priority) => ({
      text: priorityLine(priority),
      callback_data: `p:${priority}`,
    })),
  ];
}

function ticketActionsKeyboard(ticket: BotTicketRow, staff: boolean): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [
    [
      { text: "Balas", callback_data: `r:${ticket.id}` },
      { text: "Segarkan", callback_data: `t:${ticket.id}` },
    ],
  ];

  if (staff) {
    if (!ticket.assignee) {
      rows.push([{ text: "Ambil tiket ini", callback_data: `a:${ticket.id}` }]);
    }

    const next: Array<{ label: string; status: TicketStatus }> = [
      { label: "Proses", status: "IN_PROGRESS" },
      { label: "Menunggu user", status: "WAITING_USER" },
      { label: "Selesai", status: "RESOLVED" },
      { label: "Tutup", status: "CLOSED" },
    ];

    rows.push(
      next
        .filter((option) => option.status !== ticket.status)
        .map((option) => ({
          text: option.label,
          callback_data: `s:${option.status}:${ticket.id}`,
        })),
    );
  } else if (ticket.status !== "CLOSED") {
    rows.push([{ text: "Tandai selesai", callback_data: `s:RESOLVED:${ticket.id}` }]);
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export async function handleUpdate(
  bot: BotKind,
  update: {
    update_id: number;
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
  },
): Promise<{ userId?: string }> {
  const ctx = botContext(bot);

  // A default list belongs to the bot, not a chat, so it is installed once per
  // isolate. A brand new bot with no list shows an empty ☰ menu until then.
  ensureDefaultCommands(bot);

  if (update.callback_query) {
    return { userId: await handleCallback(ctx, update.callback_query) };
  }

  const message = update.message;
  if (!message?.chat) return {};
  return { userId: await handleMessage(ctx, message) };
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

async function handleMessage(ctx: BotContext, message: TelegramMessage) {
  const chatId = message.chat.id;
  const text = (message.text ?? message.caption)?.trim();
  const photo = message.photo?.at(-1);
  const document = message.document;

  // Anything queued for this user rides along with the next thing they send.
  void flushNotifications(ctx.bot, chatId);

  if (text?.startsWith("/")) {
    const [rawCommand, ...rest] = text.split(/\s+/);
    const command = rawCommand.slice(1).split("@")[0].toLowerCase();
    return await handleCommand(ctx, chatId, command, rest.join(" ").trim());
  }

  const session = await getSession(ctx.bot, chatId);
  if (!session) {
    await ctx.api.sendMessage(chatId, welcomeText(ctx));
    return undefined;
  }

  // Screenshots are half of every real IT report, so photos are first-class.
  if (photo || document) {
    await handleUpload(ctx, chatId, session, photo?.file_id ?? document?.file_id, text);
    return session.userId;
  }

  if (!text) {
    await ctx.api.sendMessage(chatId, "Kirim pesan teks ya. Ketik /help untuk melihat perintah.");
    return session.userId;
  }

  await handleText(ctx, chatId, session, text);
  return session.userId;
}

/**
 * A photo sent while a draft is open is remembered and attached once the ticket
 * exists; a photo sent while replying goes straight onto that ticket.
 */
async function handleUpload(
  ctx: BotContext,
  chatId: number,
  session: BotSession,
  fileId: string | undefined,
  caption?: string,
) {
  if (!fileId) return;
  const { userId, state, draft } = session;

  if (state === "new:category" || state === "new:title" || state === "new:description") {
    if (caption && caption.length >= 10) {
      await setSession(ctx.bot, chatId, userId, "new:priority", {
        ...draft,
        photoFileId: fileId,
        description: caption.slice(0, 4000),
      });
      await ctx.api.sendMessage(chatId, "Foto dan deskripsi tersimpan. Seberapa mendesak?", {
        keyboard: priorityKeyboard(),
      });
      return;
    }

    await setSession(ctx.bot, chatId, userId, "new:description", { ...draft, photoFileId: fileId });
    await ctx.api.sendMessage(
      chatId,
      draft.title
        ? "Foto tersimpan. Sekarang tulis deskripsi masalahnya."
        : "Foto tersimpan. Tulis judul singkat masalahnya dulu.",
    );
    return;
  }

  if (state === "reply" && draft.ticketId) {
    await ctx.api.sendMessage(chatId, "Mengunggah foto…");
    const result = await attachPhoto(ctx.bot, userId, draft.ticketId, { file_id: fileId }, caption);
    await clearSession(ctx.bot, chatId);

    await ctx.api.sendMessage(
      chatId,
      result.ok
        ? `Foto terlampir ke *#${md(draft.ticketNumber ?? "")}*.`
        : result.reason,
    );
    return;
  }

  await ctx.api.sendMessage(
    chatId,
    "Kirim foto sambil membuat tiket (/new) atau sambil membalas tiket.",
  );
}

async function handleCommand(ctx: BotContext, chatId: number, command: string, args: string) {
  if (command === "start") {
    if (args) {
      await handleLink(ctx, chatId, args);
      return undefined;
    }

    const profile = await profileForChat(ctx.bot, chatId);
    if (!profile) {
      await ctx.api.sendMessage(chatId, welcomeText(ctx));
      return undefined;
    }

    if (!(await ensureEligible(ctx, chatId, profile))) return undefined;

    await ctx.api.sendMessage(
      chatId,
      `Halo *${md(profile.full_name)}* 👋\n\n` +
        (isStaffBot(ctx)
          ? "Ketik /queue untuk melihat antrean tim IT, atau /new untuk membuat tiket."
          : "Ketik /new untuk membuat tiket, atau /tickets untuk melihat tiket kamu."),
    );
    return profile.user_id;
  }

  if (command === "help") {
    const profile = await profileForChat(ctx.bot, chatId);
    if (profile && !(await ensureEligible(ctx, chatId, profile))) return undefined;

    await ctx.api.sendMessage(chatId, helpText(ctx));
    return profile?.user_id;
  }

  if (command === "unlink") {
    const removed = await unlinkChat(ctx.bot, chatId);
    await clearSession(ctx.bot, chatId);
    await ctx.api.sendMessage(
      chatId,
      removed
        ? "Akun Telegram sudah diputus. Kirim /start KODE untuk menghubungkan lagi."
        : "Akun ini belum terhubung.",
    );
    return undefined;
  }

  // everything below needs a linked account
  const profile = await profileForChat(ctx.bot, chatId);
  if (!profile) {
    await ctx.api.sendMessage(chatId, welcomeText(ctx));
    return undefined;
  }

  if (!(await ensureEligible(ctx, chatId, profile))) return undefined;

  if (STAFF_ONLY.has(command) && !isStaffBot(ctx)) {
    await ctx.api.sendMessage(
      chatId,
      "Perintah itu ada di bot tim IT.\n\nBot ini untuk karyawan: buat dan pantau tiketmu sendiri.",
    );
    return profile.user_id;
  }

  switch (command) {
    case "new":
      await startNewTicket(ctx, chatId, profile.user_id);
      break;

    case "tickets":
      await showTicketList(ctx, chatId, profile.user_id);
      break;

    case "ticket":
      await showTicket(ctx, chatId, profile.user_id, args);
      break;

    case "reply":
      await replyByNumber(ctx, chatId, profile.user_id, args);
      break;

    case "queue":
      await showQueue(ctx, chatId, profile.user_id, "all");
      break;

    case "open":
      await showQueue(ctx, chatId, profile.user_id, "open");
      break;

    case "unassigned":
      await showQueue(ctx, chatId, profile.user_id, "unassigned");
      break;

    case "find":
      await showSearch(ctx, chatId, profile.user_id, args);
      break;

    case "claim":
      await claimByNumberCommand(ctx, chatId, profile.user_id, args);
      break;

    case "close":
      await closeByNumberCommand(ctx, chatId, profile.user_id, args);
      break;

    case "status":
      await showStatus(ctx, chatId, profile);
      break;

    default:
      await ctx.api.sendMessage(
        chatId,
        `Perintah \`/${command}\` tidak dikenal.\n\n${helpText(ctx)}`,
      );
  }

  return profile.user_id;
}

/**
 * The staff bot is for the bench, and a link outlives a role change: someone
 * demoted in the web app keeps a working chat with a staff menu until something
 * notices. Rather than half-serve them, every entry point re-checks and unlinks.
 *
 * RLS would refuse the writes anyway — this is about not pretending otherwise.
 */
async function ensureEligible(
  ctx: BotContext,
  chatId: number,
  profile: { role: string },
): Promise<boolean> {
  if (!isStaffBot(ctx) || isStaffRole(profile.role)) return true;

  await unlinkChat(ctx.bot, chatId);
  await clearSession(ctx.bot, chatId);
  await ctx.api.sendMessage(
    chatId,
    "Akunmu bukan lagi bagian tim IT, jadi bot ini diputus.\n\n" +
      "Untuk melaporkan masalah, pakai bot karyawan. Hubungi admin kalau ini keliru.",
  );
  return false;
}

async function handleLink(ctx: BotContext, chatId: number, code: string) {
  const linked = await redeemLinkCode(ctx.bot, code, chatId);

  if (!linked) {
    await ctx.api.sendMessage(
      chatId,
      "Kode tidak valid atau sudah kedaluwarsa.\n\n" +
        "Buat kode baru di web: *Profil → Telegram*." +
        (isStaffBot(ctx)
          ? "\n\nPastikan kode dibuat dari panel *Bot Tim IT*, bukan panel bot karyawan."
          : ""),
    );
    return;
  }

  await clearSession(ctx.bot, chatId);
  await ctx.api.sendMessage(
    chatId,
    `Terhubung sebagai *${md(linked.full_name)}* (${md(linked.role)}).\n\n` +
      (isStaffBot(ctx)
        ? "Menu perintahnya: /queue, /open, /unassigned, /find, /claim, /close."
        : "Ketik /new untuk membuat tiket."),
  );
}

/* -------------------------------------------------------------------------- */
/* Open a ticket — the main flow                                               */
/* -------------------------------------------------------------------------- */

async function startNewTicket(ctx: BotContext, chatId: number, userId: string) {
  const categories = await listCategories();

  if (!categories.length) {
    await ctx.api.sendMessage(chatId, "Belum ada kategori aktif. Hubungi admin.");
    return;
  }

  await setSession(ctx.bot, chatId, userId, "new:category", {});

  await ctx.api.sendMessage(chatId, "*Buat tiket baru*\n\nPilih kategori kendala:", {
    keyboard: [
      ...categories.map((category) => [
        { text: category.name, callback_data: `c:${category.id}` },
      ]),
      [{ text: "Lewati kategori", callback_data: "c:none" }],
    ],
  });
}

async function handleText(ctx: BotContext, chatId: number, session: BotSession, text: string) {
  const { userId, state, draft } = session;

  switch (state) {
    case "new:title": {
      if (text.length < 4) {
        await ctx.api.sendMessage(chatId, "Judul terlalu pendek. Tulis minimal 4 karakter.");
        return;
      }

      await setSession(ctx.bot, chatId, userId, "new:description", {
        ...draft,
        title: text.slice(0, 160),
      });
      await ctx.api.sendMessage(
        chatId,
        `Judul: *${md(text.slice(0, 160))}*\n\nSekarang jelaskan masalahnya. Sertakan pesan error kalau ada.`,
      );
      return;
    }

    case "new:description": {
      if (text.length < 10) {
        await ctx.api.sendMessage(
          chatId,
          "Deskripsi terlalu pendek. Jelaskan sedikit lebih detail.",
        );
        return;
      }

      await setSession(ctx.bot, chatId, userId, "new:priority", {
        ...draft,
        description: text.slice(0, 4000),
      });

      await ctx.api.sendMessage(chatId, "Seberapa mendesak?", {
        keyboard: priorityKeyboard(),
      });
      return;
    }

    case "reply": {
      if (!draft.ticketId) {
        await clearSession(ctx.bot, chatId);
        await ctx.api.sendMessage(
          chatId,
          "Sesi balasan sudah tidak berlaku. Buka tiket lalu tekan Balas.",
        );
        return;
      }

      const comment = await addComment(userId, draft.ticketId, text.slice(0, 5000));
      await clearSession(ctx.bot, chatId);

      await ctx.api.sendMessage(
        chatId,
        comment
          ? `Balasan terkirim ke *#${md(draft.ticketNumber ?? "")}*.`
          : "Gagal mengirim balasan. Pastikan kamu punya akses ke tiket ini.",
      );
      return;
    }

    default: {
      await clearSession(ctx.bot, chatId);
      await ctx.api.sendMessage(chatId, `Ketik /help untuk melihat perintah yang tersedia.`);
    }
  }
}

async function createFromDraft(
  ctx: BotContext,
  chatId: number,
  userId: string,
  session: BotSession,
  priority: TicketPriority,
) {
  const { draft } = session;
  if (!draft.title) {
    await clearSession(ctx.bot, chatId);
    await ctx.api.sendMessage(chatId, "Draf tiket hilang. Mulai lagi dengan /new.");
    return;
  }

  const description = draft.description ?? draft.title;

  const ticket = await createTicket(userId, {
    title: draft.title,
    description,
    categoryId: draft.categoryId ?? null,
    priority,
  });

  await clearSession(ctx.bot, chatId);

  if (!ticket) {
    await ctx.api.sendMessage(chatId, "Gagal membuat tiket. Coba lagi sebentar.");
    return;
  }

  // the screenshot that was attached mid-draft, now that the ticket exists
  let photoNote = "";
  if (draft.photoFileId) {
    const attached = await attachPhoto(ctx.bot, userId, ticket.id, { file_id: draft.photoFileId });
    if (attached.ok) photoNote = `\n\n📎 Foto terlampir: ${md(attached.name)}`;
  }

  await ctx.api.sendMessage(
    chatId,
    `✅ *Tiket dibuat*\n\n${formatTicket(ticket)}${photoNote}\n\nTim IT akan segera menindaklanjuti. Kamu akan dapat notifikasi di sini setiap ada perubahan.`,
    { keyboard: ticketActionsKeyboard(ticket, isStaffBot(ctx)) },
  );
}

/* -------------------------------------------------------------------------- */
/* Listing and detail                                                          */
/* -------------------------------------------------------------------------- */

function renderTicketList(tickets: BotTicketRow[]) {
  return tickets
    .map((ticket) =>
      [
        `*#${md(ticket.ticket_number)}* · ${md(statusLine(ticket.status))}`,
        md(ticket.title.slice(0, 60)),
        `_${md(ticket.requester ?? "tanpa pemohon")} → ${md(ticket.assignee ?? "belum ditangani")}_`,
      ].join("\n"),
    )
    .join("\n\n");
}

async function showTicketList(ctx: BotContext, chatId: number, userId: string) {
  const tickets = await listMyTickets(userId, 10);

  if (!tickets.length) {
    await ctx.api.sendMessage(
      chatId,
      "Kamu belum punya tiket.\n\nKetik /new untuk membuat yang pertama.",
    );
    return;
  }

  await ctx.api.sendMessage(
    chatId,
    `*Tiket kamu* (${tickets.length})\n\n${renderTicketList(tickets)}`,
    { keyboard: ticketKeyboard(tickets) },
  );
}

/* -------------------------------------------------------------------------- */
/* Staff queue                                                                 */
/* -------------------------------------------------------------------------- */

const QUEUE_TITLE: Record<StaffQueue, string> = {
  all: "Semua tiket",
  open: "Tiket yang belum selesai",
  unassigned: "Tiket yang belum ditangani",
  mine: "Ditugaskan ke kamu",
};

async function showQueue(ctx: BotContext, chatId: number, userId: string, queue: StaffQueue) {
  const tickets = await listQueue(userId, queue, 10);

  if (!tickets.length) {
    await ctx.api.sendMessage(chatId, `Tidak ada tiket untuk *${md(QUEUE_TITLE[queue])}*.`);
    return;
  }

  await ctx.api.sendMessage(
    chatId,
    `*${md(QUEUE_TITLE[queue])}* (${tickets.length})\n\n${renderTicketList(tickets)}\n\n` +
      "_Tekan nomor tiket untuk membuka, atau balas dengan `/reply IT-000004 pesan`._",
    { keyboard: ticketKeyboard(tickets) },
  );
}

async function showSearch(ctx: BotContext, chatId: number, userId: string, args: string) {
  const query = args.trim();
  if (!query) {
    await ctx.api.sendMessage(chatId, "Format: `/find printer`");
    return;
  }

  const tickets = await searchTickets(userId, query, 10);

  if (!tickets.length) {
    await ctx.api.sendMessage(chatId, `Tidak ada tiket yang cocok dengan *${md(query)}*.`);
    return;
  }

  await ctx.api.sendMessage(
    chatId,
    `*Hasil pencarian* \`${md(query)}\` (${tickets.length})\n\n${renderTicketList(tickets)}`,
    { keyboard: ticketKeyboard(tickets) },
  );
}

/* -------------------------------------------------------------------------- */
/* Acting on a ticket by its number                                            */
/* -------------------------------------------------------------------------- */

/** Splits `IT-000004 pesan panjang` into its number and its message. */
function splitReference(args: string) {
  const match = /^(\S+)\s+([\s\S]+)$/.exec(args.trim());
  return match ? { reference: match[1], body: match[2].trim() } : null;
}

/**
 * Replying by command rather than by "your next message is a reply". The
 * session-based flow is still there behind the *Balas* button, but a plain
 * message should never be mistaken for a reply.
 */
async function replyByNumber(ctx: BotContext, chatId: number, userId: string, args: string) {
  const parsed = splitReference(args);

  if (!parsed) {
    await ctx.api.sendMessage(chatId, "Format: `/reply IT-000004 pesanmu`");
    return;
  }

  const ticket = await commentByNumber(userId, parsed.reference, parsed.body.slice(0, 5000));

  if (!ticket) {
    await ctx.api.sendMessage(
      chatId,
      `Tiket *${md(parsed.reference)}* tidak ditemukan atau bukan milikmu.`,
    );
    return;
  }

  // A pending "next message is a reply" draft would otherwise swallow whatever
  // the user types next.
  const session = await getSession(ctx.bot, chatId);
  if (session?.state === "reply") await clearSession(ctx.bot, chatId);

  await ctx.api.sendMessage(chatId, `Balasan terkirim ke *#${md(ticket.ticket_number)}*.`, {
    keyboard: ticketActionsKeyboard(ticket, isStaffBot(ctx)),
  });
}

async function claimByNumberCommand(
  ctx: BotContext,
  chatId: number,
  userId: string,
  args: string,
) {
  const reference = args.trim();
  if (!reference) {
    await ctx.api.sendMessage(chatId, "Format: `/claim IT-000004`");
    return;
  }

  const ticket = await claimByNumber(userId, reference);

  if (!ticket) {
    await ctx.api.sendMessage(
      chatId,
      `Tiket *${md(reference)}* tidak ditemukan, atau kamu tidak berhak mengambilnya.`,
    );
    return;
  }

  await ctx.api.sendMessage(
    chatId,
    `*#${md(ticket.ticket_number)}* sekarang ditangani *${md(ticket.assignee ?? "kamu")}*.`,
  );
  await sendTicketDetail(ctx, chatId, userId, ticket);
}

async function closeByNumberCommand(
  ctx: BotContext,
  chatId: number,
  userId: string,
  args: string,
) {
  const reference = args.trim();
  if (!reference) {
    await ctx.api.sendMessage(chatId, "Format: `/close IT-000004`");
    return;
  }

  const ticket = await setStatusByNumber(userId, reference, "CLOSED");

  if (!ticket) {
    await ctx.api.sendMessage(
      chatId,
      `Tiket *${md(reference)}* tidak ditemukan, atau hanya tim IT yang bisa menutupnya.`,
    );
    return;
  }

  await ctx.api.sendMessage(chatId, `*#${md(ticket.ticket_number)}* ditutup.`);
  await sendTicketDetail(ctx, chatId, userId, ticket);
}

async function showTicket(ctx: BotContext, chatId: number, userId: string, args: string) {
  const reference = args.trim();
  if (!reference) {
    await ctx.api.sendMessage(chatId, "Format: `/ticket IT-000004`");
    return;
  }

  const ticket = await findTicketByNumber(userId, reference);
  if (!ticket) {
    await ctx.api.sendMessage(
      chatId,
      `Tiket *${md(reference)}* tidak ditemukan atau bukan milikmu.`,
    );
    return;
  }

  await sendTicketDetail(ctx, chatId, userId, ticket);
}

async function sendTicketDetail(
  ctx: BotContext,
  chatId: number,
  userId: string,
  ticket: BotTicketRow,
) {
  const comments = await listComments(userId, ticket.id, 4);

  await ctx.api.sendMessage(
    chatId,
    `${formatTicket(ticket)}\n\n*Percakapan terakhir*\n${formatConversation(comments)}`,
    { keyboard: ticketActionsKeyboard(ticket, isStaffBot(ctx)) },
  );
}

async function showStatus(
  ctx: BotContext,
  chatId: number,
  profile: { user_id: string; full_name: string; role: string },
) {
  const tickets = await listMyTickets(profile.user_id, 100);
  const open = tickets.filter(
    (ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status),
  ).length;

  const lines = [
    `*${md(profile.full_name)}*`,
    `Role: ${md(profile.role)}`,
    "",
    `Total tiket: ${tickets.length}`,
    `Masih berjalan: ${open}`,
    `Selesai: ${tickets.length - open}`,
    "",
    `Telegram: terhubung ke bot ${isStaffBot(ctx) ? "tim IT" : "karyawan"}`,
  ];

  if (isStaffBot(ctx)) {
    const [unassigned, mine] = await Promise.all([
      listQueue(profile.user_id, "unassigned", 100),
      listQueue(profile.user_id, "mine", 100),
    ]);

    lines.push(
      "",
      "*Antrean tim IT*",
      `Belum ditangani: ${unassigned.length}`,
      `Ditugaskan ke kamu: ${mine.length}`,
    );
  }

  await ctx.api.sendMessage(chatId, lines.join("\n"));
}

/* -------------------------------------------------------------------------- */
/* Callbacks                                                                   */
/* -------------------------------------------------------------------------- */

async function handleCallback(ctx: BotContext, query: TelegramCallbackQuery) {
  const chatId = query.message?.chat.id;
  const data = query.data;
  if (!chatId || !data) return undefined;

  const [action, ...rest] = data.split(":");
  const profile = await profileForChat(ctx.bot, chatId);

  if (!profile) {
    await ctx.api.answerCallbackQuery(query.id, "Hubungkan akun dulu: /start KODE");
    return undefined;
  }

  if (!(await ensureEligible(ctx, chatId, profile))) {
    await ctx.api.answerCallbackQuery(query.id);
    return undefined;
  }

  const session = await getSession(ctx.bot, chatId);

  switch (action) {
    case "c": {
      const [categoryId] = rest;
      const categories = await listCategories();
      const name =
        categories.find((category) => category.id === categoryId)?.name ?? "Tanpa kategori";

      await setSession(ctx.bot, chatId, profile.user_id, "new:title", {
        categoryId: categoryId === "none" ? null : categoryId,
      });

      await ctx.api.answerCallbackQuery(query.id, name);
      await ctx.api.sendMessage(
        chatId,
        `Kategori: *${md(name)}*\n\nTulis judul singkat masalahnya.`,
      );
      return profile.user_id;
    }

    case "p": {
      const [priority] = rest as [TicketPriority];

      if (!session || session.state !== "new:priority") {
        await ctx.api.answerCallbackQuery(query.id, "Sesi habis, mulai lagi dengan /new");
        return profile.user_id;
      }

      await ctx.api.answerCallbackQuery(query.id, priorityLine(priority));
      await createFromDraft(ctx, chatId, profile.user_id, session, priority);
      return profile.user_id;
    }

    case "a": {
      const [ticketId] = rest;
      const claimed = await claimTicket(profile.user_id, ticketId);
      await ctx.api.answerCallbackQuery(query.id, claimed ? "Ditugaskan ke kamu" : "Tidak diizinkan");

      const ticket = claimed ? await findTicketById(profile.user_id, ticketId) : null;
      if (ticket) {
        await sendTicketDetail(ctx, chatId, profile.user_id, ticket);
      } else {
        await ctx.api.sendMessage(chatId, "Hanya tim IT yang bisa mengambil tiket.");
      }
      return profile.user_id;
    }

    case "t": {
      const [ticketId] = rest;
      const ticket = await findTicketById(profile.user_id, ticketId);
      await ctx.api.answerCallbackQuery(query.id);

      if (!ticket) {
        await ctx.api.sendMessage(chatId, "Tiket tidak ditemukan atau bukan milikmu.");
        return profile.user_id;
      }

      await sendTicketDetail(ctx, chatId, profile.user_id, ticket);
      return profile.user_id;
    }

    case "r": {
      const [ticketId] = rest;
      const ticket = await findTicketById(profile.user_id, ticketId);
      await ctx.api.answerCallbackQuery(query.id);

      if (!ticket) {
        await ctx.api.sendMessage(chatId, "Tiket tidak ditemukan atau bukan milikmu.");
        return profile.user_id;
      }

      await setSession(ctx.bot, chatId, profile.user_id, "reply", {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
      });

      await ctx.api.sendMessage(
        chatId,
        `Tulis balasan untuk *#${md(ticket.ticket_number)}*. Pesan berikutnya langsung dikirim.`,
      );
      return profile.user_id;
    }

    case "s": {
      const [status, ticketId] = rest as [TicketStatus, string];
      const updated = await updateTicketStatus(profile.user_id, ticketId, status);
      await ctx.api.answerCallbackQuery(query.id, updated ? "Status diperbarui" : "Tidak diizinkan");

      if (!updated) {
        await ctx.api.sendMessage(chatId, "Hanya tim IT yang bisa mengubah status.");
        return profile.user_id;
      }

      const ticket = await findTicketById(profile.user_id, ticketId);
      await ctx.api.sendMessage(chatId, `Status diubah ke *${md(statusLine(status))}*.`);

      if (ticket) {
        await sendTicketDetail(ctx, chatId, profile.user_id, ticket);
      }
      return profile.user_id;
    }

    default:
      await ctx.api.answerCallbackQuery(query.id);
      return profile.user_id;
  }
}
