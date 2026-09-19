import "server-only";

import { asUser } from "@/lib/db/pool";
import { badRequest } from "@/lib/api/errors";
import type { WidgetChannel } from "@/lib/widget/channels";
import { assertMessageRate } from "@/lib/widget/rate";
import type { TicketStatus } from "@/types";

/** A message as the widget sees it: no user ids, no internal ids. */
export interface WidgetMessage {
  id: string;
  /** `visitor` is the person in the chat window; `staff` is the IT team. */
  role: "visitor" | "staff";
  author: string;
  body: string;
  createdAt: string;
}

export interface WidgetConversation {
  ticketNumber: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
}

export interface VisitorContact {
  name: string;
  email: string;
  visitorRef: string;
  userAgent: string | null;
  pageUrl: string | null;
}

export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Validation lives here rather than in a zod schema because the same rules have
 * to hold for the first message (which also becomes the ticket title) and for
 * every reply.
 */
export function readMessage(value: unknown): string {
  const message = String(value ?? "").trim();
  if (!message) throw badRequest("Message cannot be empty.");
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw badRequest(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
  }
  return message;
}

export function readContact(input: {
  name?: unknown;
  email?: unknown;
  visitorRef?: unknown;
}): VisitorContact {
  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const visitorRef = String(input.visitorRef ?? "").trim() || "unknown";

  if (name.length < 2) throw badRequest("Please tell us your name.");
  if (name.length > 120) throw badRequest("Name is too long.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw badRequest("Please give a valid email address.");
  }

  return {
    name,
    email,
    visitorRef: visitorRef.slice(0, 64),
    userAgent: null,
    pageUrl: null,
  };
}

/**
 * A ticket title from a chat message.
 *
 * A support widget should not interrogate someone for a subject line before
 * letting them speak, so the first line of what they actually wrote becomes the
 * title. It is a label for the queue, not a summary — the full text is the
 * ticket's description and first comment.
 */
export function titleFromMessage(message: string): string {
  const firstLine = message.split(/\r?\n/).find((line) => line.trim().length > 0) ?? message;
  const collapsed = firstLine.replace(/\s+/g, " ").trim();

  if (collapsed.length <= 80) return collapsed;
  return `${collapsed.slice(0, 77).trimEnd()}…`;
}

/**
 * Open a conversation: ticket, contact row and first message, in one
 * transaction so a half-created ticket cannot exist.
 *
 * Everything here runs as the channel's system profile. That is the whole trick
 * of this feature: `tickets_insert` requires `created_by = auth.uid()`, so a
 * widget ticket is created by exactly the same rule as an employee's, and no
 * policy had to be relaxed to let a stranger in.
 *
 * `channelId` is the widget's link to the outside world. `source` is set with it
 * because the database enforces that the two agree.
 */
export async function createConversation(input: {
  channel: WidgetChannel;
  contact: VisitorContact;
  message: string;
  ip: string | null;
}): Promise<{ ticketId: string; ticketNumber: string }> {
  const { channel, contact, message, ip } = input;

  return asUser(channel.systemProfileId, async (db) => {
    const { rows } = await db.query<{ id: string; ticket_number: string }>(
      `insert into public.tickets
         (title, description, category_id, priority, created_by, source, channel_id)
       values ($1, $2, $3, $4, $5, 'widget', $6)
       returning id, ticket_number`,
      [
        titleFromMessage(message),
        message,
        channel.defaultCategoryId,
        channel.defaultPriority,
        channel.systemProfileId,
        channel.id,
      ],
    );

    const ticket = rows[0];
    if (!ticket) throw new Error("Ticket insert returned no row.");

    await db.query(
      `insert into public.ticket_contacts
         (ticket_id, visitor_ref, name, email, visitor_ip, user_agent, page_url)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ticket.id,
        contact.visitorRef,
        contact.name,
        contact.email,
        ip,
        contact.userAgent,
        contact.pageUrl,
      ],
    );

    await db.query(
      `insert into public.ticket_comments (ticket_id, user_id, message)
       values ($1, $2, $3)`,
      [ticket.id, channel.systemProfileId, message],
    );

    return { ticketId: ticket.id, ticketNumber: ticket.ticket_number };
  });
}

/**
 * Add a visitor's reply.
 *
 * The rate check runs inside the same transaction as the insert it guards, so
 * two simultaneous messages cannot both see a count below the limit.
 */
export async function appendVisitorMessage(input: {
  channel: WidgetChannel;
  ticketId: string;
  message: string;
}): Promise<void> {
  const { channel, ticketId, message } = input;

  await asUser(channel.systemProfileId, async (db) => {
    await assertMessageRate(db, ticketId);
    await db.query(
      `insert into public.ticket_comments (ticket_id, user_id, message)
       values ($1, $2, $3)`,
      [ticketId, channel.systemProfileId, message],
    );
  });
}

/**
 * The conversation, oldest first.
 *
 * Who wrote what is decided by comparing the author against the ticket's
 * requester, which for a widget ticket is the channel's system profile. So the
 * visitor's own words come back labelled `visitor` and everything else is the
 * IT team — including a colleague of theirs replying from the web app, which is
 * the right answer.
 *
 * The visitor is shown the contact name the widget collected, never the
 * profile's name: `Widget: Acme Support` is a database detail, not a person.
 */
export async function listMessages(input: {
  channel: WidgetChannel;
  ticketId: string;
  since?: string | null;
}): Promise<{ conversation: WidgetConversation; messages: WidgetMessage[] }> {
  const { channel, ticketId, since } = input;

  return asUser(channel.systemProfileId, async (db) => {
    const ticketResult = await db.query<{
      ticket_number: string;
      title: string;
      status: TicketStatus;
      created_at: Date;
      created_by: string;
      contact_name: string | null;
    }>(
      `select t.ticket_number, t.title, t.status, t.created_at, t.created_by,
              c.name as contact_name
         from public.tickets t
         left join public.ticket_contacts c on c.ticket_id = t.id
        where t.id = $1`,
      [ticketId],
    );

    const ticket = ticketResult.rows[0];
    if (!ticket) throw badRequest("This conversation no longer exists.");

    const messages = await db.query<{
      id: string;
      user_id: string;
      message: string;
      created_at: Date;
    }>(
      `select id, user_id, message, created_at
         from public.ticket_comments
        where ticket_id = $1
          and ($2::timestamptz is null or created_at > $2::timestamptz)
        order by created_at asc
        limit 200`,
      [ticketId, since ?? null],
    );

    return {
      conversation: {
        ticketNumber: ticket.ticket_number,
        subject: ticket.title,
        status: ticket.status,
        createdAt: ticket.created_at.toISOString(),
      },
      messages: messages.rows.map((row) => ({
        id: row.id,
        role: row.user_id === ticket.created_by ? ("visitor" as const) : ("staff" as const),
        author:
          row.user_id === ticket.created_by
            ? (ticket.contact_name ?? "You")
            : "IT Support",
        body: row.message,
        createdAt: row.created_at.toISOString(),
      })),
    };
  });
}
