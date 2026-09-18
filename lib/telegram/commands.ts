import "server-only";

import { PRIORITY_META, STATUS_META } from "@/lib/constants";
import {
  answerCallbackQuery,
  sendMessage,
  type InlineKeyboardButton,
  type TelegramCallbackQuery,
  type TelegramMessage,
} from "@/lib/telegram/client";
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
import {
  ensureDefaultCommands,
  isStaffRole,
  refreshCommandMenu,
} from "@/lib/telegram/menu";
import { attachPhoto } from "@/lib/telegram/attachments";
import type { TicketPriority, TicketStatus } from "@/types";

/**
 * Commands the ☰ menu only shows to IT staff, and which are refused for anyone
 * else. The menu is presentation; this set is the guard; RLS is the enforcement.
 */
const STAFF_ONLY = new Set(["queue", "open", "unassigned", "find", "claim", "close"]);

function helpText(role: string) {
  const lines = [
    "*IT Helpdesk bot*",
    "",
    "*Buat tiket*",
    "`/new` — laporkan masalah, langkah demi langkah",
    "",
    "*Tiket kamu*",
    "`/tickets` — 10 tiket terakhir milikmu",
    "`/ticket IT-000004` — satu tiket beserta percakapannya",
    "`/reply IT-000004 pesan` — balas langsung dari sini",
  ];

  if (isStaffRole(role)) {
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

const WELCOME = [
  "*Selamat datang di IT Helpdesk*",
  "",
  "Bot ini terhubung ke sistem tiket yang sama dengan web.",
  "",
  "Untuk mulai, hubungkan akun:",
  "1. Buka *Profil → Telegram* di web",
  "2. Salin kode yang muncul",
  "3. Kirim ke sini sebagai `/start KODE`",
].join("\n");

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

function ticketActionsKeyboard(ticket: BotTicketRow, isStaff: boolean): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [
    [
      { text: "Balas", callback_data: `r:${ticket.id}` },
      { text: "Segarkan", callback_data: `t:${ticket.id}` },
    ],
  ];

  if (isStaff) {
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

export async function handleUpdate(update: {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}) {
  // Anyone who never linked has no chat-scoped menu, so the fallback list is
  // what they see. Refresh it from the code on the first update of an isolate.
  ensureDefaultCommands();

  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const message = update.message;
  if (!message?.chat) return;
  await handleMessage(message);
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

async function handleMessage(message: TelegramMessage) {
  const chatId = message.chat.id;
  const text = (message.text ?? message.caption)?.trim();
  const photo = message.photo?.at(-1);
  const document = message.document;

  // Anything queued for this user rides along with the next thing they send.
  void flushNotifications(chatId);

  if (text?.startsWith("/")) {
    const [rawCommand, ...rest] = text.split(/\s+/);
    const command = rawCommand.slice(1).split("@")[0].toLowerCase();
    await handleCommand(chatId, command, rest.join(" ").trim());
    return;
  }

  const session = await getSession(chatId);
  if (!session) {
    await sendMessage(chatId, WELCOME);
    return;
  }

  // Screenshots are half of every real IT report, so photos are first-class.
  if (photo || document) {
    await handleUpload(chatId, session, photo?.file_id ?? document?.file_id, text);
    return;
  }

  if (!text) {
    await sendMessage(chatId, "Kirim pesan teks ya. Ketik /help untuk melihat perintah.");
    return;
  }

  await handleText(chatId, session, text);
}

/**
 * A photo sent while a draft is open is remembered and attached once the ticket
 * exists; a photo sent while replying goes straight onto that ticket.
 */
async function handleUpload(
  chatId: number,
  session: BotSession,
  fileId: string | undefined,
  caption?: string,
) {
  if (!fileId) return;
  const { userId, state, draft } = session;

  if (state === "new:category" || state === "new:title" || state === "new:description") {
    if (caption && caption.length >= 10) {
      await setSession(chatId, userId, "new:priority", {
        ...draft,
        photoFileId: fileId,
        description: caption.slice(0, 4000),
      });
      await sendMessage(chatId, "Foto dan deskripsi tersimpan. Seberapa mendesak?", {
        keyboard: priorityKeyboard(),
      });
      return;
    }

    await setSession(chatId, userId, "new:description", { ...draft, photoFileId: fileId });
    await sendMessage(
      chatId,
      draft.title
        ? "Foto tersimpan. Sekarang tulis deskripsi masalahnya."
        : "Foto tersimpan. Tulis judul singkat masalahnya dulu.",
    );
    return;
  }

  if (state === "reply" && draft.ticketId) {
    await sendMessage(chatId, "Mengunggah foto…");
    const result = await attachPhoto(userId, draft.ticketId, { file_id: fileId }, caption);
    await clearSession(chatId);

    await sendMessage(
      chatId,
      result.ok
        ? `Foto terlampir ke *#${md(draft.ticketNumber ?? "")}*.`
        : result.reason,
    );
    return;
  }

  await sendMessage(
    chatId,
    "Kirim foto sambil membuat tiket (/new) atau sambil membalas tiket.",
  );
}

async function handleCommand(chatId: number, command: string, args: string) {
  if (command === "start") {
    if (args) {
      await handleLink(chatId, args);
      return;
    }

    const profile = await profileForChat(chatId);
    if (profile) {
      // `/start` is also how someone asks the bot to notice a role change made
      // in the web app, since nothing tells the bot when that happens.
      await refreshCommandMenu(chatId, profile.role);
      await sendMessage(
        chatId,
        `Halo *${md(profile.full_name)}* 👋\n\n` +
          (isStaffRole(profile.role)
            ? "Ketik /queue untuk melihat antrean tim IT, atau /new untuk membuat tiket."
            : "Ketik /new untuk membuat tiket, atau /tickets untuk melihat tiket kamu."),
      );
    } else {
      await sendMessage(chatId, WELCOME);
    }
    return;
  }

  if (command === "help") {
    const profile = await profileForChat(chatId);
    if (profile) await refreshCommandMenu(chatId, profile.role);
    await sendMessage(chatId, helpText(profile?.role ?? "employee"));
    return;
  }

  if (command === "unlink") {
    const removed = await unlinkChat(chatId);
    await clearSession(chatId);
    // Drop the chat-scoped menu too, so a former staff member does not keep a
    // menu full of commands they can no longer run.
    await refreshCommandMenu(chatId, "employee");
    await sendMessage(
      chatId,
      removed
        ? "Akun Telegram sudah diputus. Kirim /start KODE untuk menghubungkan lagi."
        : "Akun ini belum terhubung.",
    );
    return;
  }

  // everything below needs a linked account
  const profile = await profileForChat(chatId);
  if (!profile) {
    await sendMessage(chatId, WELCOME);
    return;
  }

  if (STAFF_ONLY.has(command) && !isStaffRole(profile.role)) {
    await sendMessage(
      chatId,
      "Perintah itu hanya untuk tim IT.\n\n" + helpText(profile.role),
    );
    return;
  }

  switch (command) {
    case "new":
      await startNewTicket(chatId, profile.user_id);
      return;

    case "tickets":
      await showTicketList(chatId, profile.user_id);
      return;

    case "ticket":
      await showTicket(chatId, profile.user_id, profile.role, args);
      return;

    case "reply":
      await replyByNumber(chatId, profile.user_id, profile.role, args);
      return;

    case "queue":
      await showQueue(chatId, profile.user_id, "all");
      return;

    case "open":
      await showQueue(chatId, profile.user_id, "open");
      return;

    case "unassigned":
      await showQueue(chatId, profile.user_id, "unassigned");
      return;

    case "find":
      await showSearch(chatId, profile.user_id, args);
      return;

    case "claim":
      await claimByNumberCommand(chatId, profile.user_id, profile.role, args);
      return;

    case "close":
      await closeByNumberCommand(chatId, profile.user_id, profile.role, args);
      return;

    case "status":
      await showStatus(chatId, profile);
      return;

    default:
      await sendMessage(
        chatId,
        `Perintah \`/${command}\` tidak dikenal.\n\n${helpText(profile.role)}`,
      );
  }
}

async function handleLink(chatId: number, code: string) {
  const linked = await redeemLinkCode(code, chatId);

  if (!linked) {
    await sendMessage(
      chatId,
      "Kode tidak valid atau sudah kedaluwarsa.\n\nBuat kode baru di web: *Profil → Telegram*.",
    );
    return;
  }

  await clearSession(chatId);
  await refreshCommandMenu(chatId, linked.role);
  await sendMessage(
    chatId,
    `Terhubung sebagai *${md(linked.full_name)}* (${md(linked.role)}).\n\n` +
      (isStaffRole(linked.role)
        ? "Menu perintahnya sudah ditambah: /queue, /open, /unassigned, /find, /claim, /close."
        : "Ketik /new untuk membuat tiket."),
  );
}

/* -------------------------------------------------------------------------- */
/* Open a ticket — the main flow                                               */
/* -------------------------------------------------------------------------- */

async function startNewTicket(chatId: number, userId: string) {
  const categories = await listCategories();

  if (!categories.length) {
    await sendMessage(chatId, "Belum ada kategori aktif. Hubungi admin.");
    return;
  }

  await setSession(chatId, userId, "new:category", {});

  await sendMessage(chatId, "*Buat tiket baru*\n\nPilih kategori kendala:", {
    keyboard: [
      ...categories.map((category) => [
        { text: category.name, callback_data: `c:${category.id}` },
      ]),
      [{ text: "Lewati kategori", callback_data: "c:none" }],
    ],
  });
}

async function handleText(chatId: number, session: BotSession, text: string) {
  const { userId, state, draft } = session;

  switch (state) {
    case "new:title": {
      if (text.length < 4) {
        await sendMessage(chatId, "Judul terlalu pendek. Tulis minimal 4 karakter.");
        return;
      }

      await setSession(chatId, userId, "new:description", { ...draft, title: text.slice(0, 160) });
      await sendMessage(
        chatId,
        `Judul: *${md(text.slice(0, 160))}*\n\nSekarang jelaskan masalahnya. Sertakan pesan error kalau ada.`,
      );
      return;
    }

    case "new:description": {
      if (text.length < 10) {
        await sendMessage(chatId, "Deskripsi terlalu pendek. Jelaskan sedikit lebih detail.");
        return;
      }

      await setSession(chatId, userId, "new:priority", {
        ...draft,
        description: text.slice(0, 4000),
      });

      await sendMessage(chatId, "Seberapa mendesak?", {
        keyboard: priorityKeyboard(),
      });
      return;
    }

    case "reply": {
      if (!draft.ticketId) {
        await clearSession(chatId);
        await sendMessage(chatId, "Sesi balasan sudah tidak berlaku. Buka tiket lalu tekan Balas.");
        return;
      }

      const comment = await addComment(userId, draft.ticketId, text.slice(0, 5000));
      await clearSession(chatId);

      await sendMessage(
        chatId,
        comment
          ? `Balasan terkirim ke *#${md(draft.ticketNumber ?? "")}*.`
          : "Gagal mengirim balasan. Pastikan kamu punya akses ke tiket ini.",
      );
      return;
    }

    default: {
      await clearSession(chatId);
      await sendMessage(chatId, `Ketik /help untuk melihat perintah yang tersedia.`);
    }
  }
}

async function createFromDraft(
  chatId: number,
  userId: string,
  role: string,
  session: BotSession,
  priority: TicketPriority,
) {
  const { draft } = session;
  if (!draft.title) {
    await clearSession(chatId);
    await sendMessage(chatId, "Draf tiket hilang. Mulai lagi dengan /new.");
    return;
  }

  const description = draft.description ?? draft.title;

  const ticket = await createTicket(userId, {
    title: draft.title,
    description,
    categoryId: draft.categoryId ?? null,
    priority,
  });

  await clearSession(chatId);

  if (!ticket) {
    await sendMessage(chatId, "Gagal membuat tiket. Coba lagi sebentar.");
    return;
  }

  // the screenshot that was attached mid-draft, now that the ticket exists
  let photoNote = "";
  if (draft.photoFileId) {
    const attached = await attachPhoto(userId, ticket.id, { file_id: draft.photoFileId });
    if (attached.ok) photoNote = `\n\n📎 Foto terlampir: ${md(attached.name)}`;
  }

  await sendMessage(
    chatId,
    `✅ *Tiket dibuat*\n\n${formatTicket(ticket)}${photoNote}\n\nTim IT akan segera menindaklanjuti. Kamu akan dapat notifikasi di sini setiap ada perubahan.`,
    { keyboard: ticketActionsKeyboard(ticket, isStaffRole(role)) },
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

async function showTicketList(chatId: number, userId: string) {
  const tickets = await listMyTickets(userId, 10);

  if (!tickets.length) {
    await sendMessage(chatId, "Kamu belum punya tiket.\n\nKetik /new untuk membuat yang pertama.");
    return;
  }

  await sendMessage(chatId, `*Tiket kamu* (${tickets.length})\n\n${renderTicketList(tickets)}`, {
    keyboard: ticketKeyboard(tickets),
  });
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

async function showQueue(
  chatId: number,
  userId: string,
  queue: StaffQueue,
) {
  const tickets = await listQueue(userId, queue, 10);

  if (!tickets.length) {
    await sendMessage(chatId, `Tidak ada tiket untuk *${md(QUEUE_TITLE[queue])}*.`);
    return;
  }

  await sendMessage(
    chatId,
    `*${md(QUEUE_TITLE[queue])}* (${tickets.length})\n\n${renderTicketList(tickets)}\n\n` +
      "_Tekan nomor tiket untuk membuka, atau balas dengan `/reply IT-000004 pesan`._",
    { keyboard: ticketKeyboard(tickets) },
  );
}

async function showSearch(chatId: number, userId: string, args: string) {
  const query = args.trim();
  if (!query) {
    await sendMessage(chatId, "Format: `/find printer`");
    return;
  }

  const tickets = await searchTickets(userId, query, 10);

  if (!tickets.length) {
    await sendMessage(chatId, `Tidak ada tiket yang cocok dengan *${md(query)}*.`);
    return;
  }

  await sendMessage(
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
async function replyByNumber(chatId: number, userId: string, role: string, args: string) {
  const parsed = splitReference(args);

  if (!parsed) {
    await sendMessage(chatId, "Format: `/reply IT-000004 pesanmu`");
    return;
  }

  const ticket = await commentByNumber(userId, parsed.reference, parsed.body.slice(0, 5000));

  if (!ticket) {
    await sendMessage(
      chatId,
      `Tiket *${md(parsed.reference)}* tidak ditemukan atau bukan milikmu.`,
    );
    return;
  }

  // A pending "next message is a reply" draft would otherwise swallow whatever
  // the user types next.
  const session = await getSession(chatId);
  if (session?.state === "reply") await clearSession(chatId);

  await sendMessage(
    chatId,
    `Balasan terkirim ke *#${md(ticket.ticket_number)}*.`,
    { keyboard: ticketActionsKeyboard(ticket, isStaffRole(role)) },
  );
}

async function claimByNumberCommand(chatId: number, userId: string, role: string, args: string) {
  const reference = args.trim();
  if (!reference) {
    await sendMessage(chatId, "Format: `/claim IT-000004`");
    return;
  }

  const ticket = await claimByNumber(userId, reference);

  if (!ticket) {
    await sendMessage(
      chatId,
      `Tiket *${md(reference)}* tidak ditemukan, atau kamu tidak berhak mengambilnya.`,
    );
    return;
  }

  await sendMessage(chatId, `*#${md(ticket.ticket_number)}* sekarang ditangani *${md(ticket.assignee ?? "kamu")}*.`);
  await sendTicketDetail(chatId, userId, role, ticket);
}

async function closeByNumberCommand(chatId: number, userId: string, role: string, args: string) {
  const reference = args.trim();
  if (!reference) {
    await sendMessage(chatId, "Format: `/close IT-000004`");
    return;
  }

  const ticket = await setStatusByNumber(userId, reference, "CLOSED");

  if (!ticket) {
    await sendMessage(
      chatId,
      `Tiket *${md(reference)}* tidak ditemukan, atau hanya tim IT yang bisa menutupnya.`,
    );
    return;
  }

  await sendMessage(chatId, `*#${md(ticket.ticket_number)}* ditutup.`);
  await sendTicketDetail(chatId, userId, role, ticket);
}

async function showTicket(chatId: number, userId: string, role: string, args: string) {
  const reference = args.trim();
  if (!reference) {
    await sendMessage(chatId, "Format: `/ticket IT-000004`");
    return;
  }

  const ticket = await findTicketByNumber(userId, reference);
  if (!ticket) {
    await sendMessage(chatId, `Tiket *${md(reference)}* tidak ditemukan atau bukan milikmu.`);
    return;
  }

  await sendTicketDetail(chatId, userId, role, ticket);
}

async function sendTicketDetail(chatId: number, userId: string, role: string, ticket: BotTicketRow) {
  const comments = await listComments(userId, ticket.id, 4);

  await sendMessage(
    chatId,
    `${formatTicket(ticket)}\n\n*Percakapan terakhir*\n${formatConversation(comments)}`,
    { keyboard: ticketActionsKeyboard(ticket, isStaffRole(role)) },
  );
}

async function showStatus(chatId: number, profile: { user_id: string; full_name: string; role: string }) {
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
    "Telegram: terhubung",
  ];

  if (isStaffRole(profile.role)) {
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

  await sendMessage(chatId, lines.join("\n"));
}

/* -------------------------------------------------------------------------- */
/* Callbacks                                                                   */
/* -------------------------------------------------------------------------- */

async function handleCallback(query: TelegramCallbackQuery) {
  const chatId = query.message?.chat.id;
  const data = query.data;
  if (!chatId || !data) return;

  const [action, ...rest] = data.split(":");
  const profile = await profileForChat(chatId);

  if (!profile) {
    await answerCallbackQuery(query.id, "Hubungkan akun dulu: /start KODE");
    return;
  }

  const session = await getSession(chatId);

  switch (action) {
    case "c": {
      const [categoryId] = rest;
      const categories = await listCategories();
      const name = categories.find((category) => category.id === categoryId)?.name ?? "Tanpa kategori";

      await setSession(chatId, profile.user_id, "new:title", {
        categoryId: categoryId === "none" ? null : categoryId,
      });

      await answerCallbackQuery(query.id, name);
      await sendMessage(chatId, `Kategori: *${md(name)}*\n\nTulis judul singkat masalahnya.`);
      return;
    }

    case "p": {
      const [priority] = rest as [TicketPriority];

      if (!session || session.state !== "new:priority") {
        await answerCallbackQuery(query.id, "Sesi habis, mulai lagi dengan /new");
        return;
      }

      await answerCallbackQuery(query.id, priorityLine(priority));
      await createFromDraft(chatId, profile.user_id, profile.role, session, priority);
      return;
    }

    case "a": {
      const [ticketId] = rest;
      const claimed = await claimTicket(profile.user_id, ticketId);
      await answerCallbackQuery(query.id, claimed ? "Ditugaskan ke kamu" : "Tidak diizinkan");

      const ticket = claimed ? await findTicketById(profile.user_id, ticketId) : null;
      if (ticket) {
        await sendTicketDetail(chatId, profile.user_id, profile.role, ticket);
      } else {
        await sendMessage(chatId, "Hanya tim IT yang bisa mengambil tiket.");
      }
      return;
    }

    case "t": {
      const [ticketId] = rest;
      const ticket = await findTicketById(profile.user_id, ticketId);
      await answerCallbackQuery(query.id);

      if (!ticket) {
        await sendMessage(chatId, "Tiket tidak ditemukan atau bukan milikmu.");
        return;
      }

      await sendTicketDetail(chatId, profile.user_id, profile.role, ticket);
      return;
    }

    case "r": {
      const [ticketId] = rest;
      const ticket = await findTicketById(profile.user_id, ticketId);
      await answerCallbackQuery(query.id);

      if (!ticket) {
        await sendMessage(chatId, "Tiket tidak ditemukan atau bukan milikmu.");
        return;
      }

      await setSession(chatId, profile.user_id, "reply", {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
      });

      await sendMessage(
        chatId,
        `Tulis balasan untuk *#${md(ticket.ticket_number)}*. Pesan berikutnya langsung dikirim.`,
      );
      return;
    }

    case "s": {
      const [status, ticketId] = rest as [TicketStatus, string];
      const updated = await updateTicketStatus(profile.user_id, ticketId, status);
      await answerCallbackQuery(query.id, updated ? "Status diperbarui" : "Tidak diizinkan");

      if (!updated) {
        await sendMessage(chatId, "Hanya tim IT yang bisa mengubah status.");
        return;
      }

      const ticket = await findTicketById(profile.user_id, ticketId);
      await sendMessage(chatId, `Status diubah ke *${md(statusLine(status))}*.`);

      if (ticket) {
        await sendTicketDetail(chatId, profile.user_id, profile.role, ticket);
      }
      return;
    }

    default:
      await answerCallbackQuery(query.id);
  }
}
