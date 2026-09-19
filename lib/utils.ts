import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import { twMerge } from "tailwind-merge";

import type { TicketWithRelations } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

export function formatDateTime(value: string | Date | null | undefined) {
  const date = toDate(value);
  return date ? format(date, "d MMMM yyyy, HH:mm") : "—";
}

export function formatDate(value: string | Date | null | undefined) {
  const date = toDate(value);
  return date ? format(date, "d MMM yyyy") : "—";
}

export function formatRelative(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) return "—";
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function formatFileSize(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const size = bytes / Math.pow(1024, exponent);
  return `${size.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

export function truncate(value: string, length = 140) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}

/**
 * Who a ticket is from, as a person should read it.
 *
 * A widget ticket's requester is the channel's machine profile, whose name is
 * "Widget: Acme Support" — true in the database, meaningless in a timeline. The
 * visitor's own name lives on the contact row and wins.
 */
export function requesterName(ticket: TicketWithRelations) {
  return ticket.contact?.name ?? ticket.requester?.full_name ?? "Requester";
}

export function requesterEmail(ticket: TicketWithRelations) {
  return ticket.contact?.email ?? ticket.requester?.email ?? "—";
}

/** True when the requester is somebody outside the company. */
export function isExternalTicket(ticket: TicketWithRelations) {
  return ticket.source === "widget" && ticket.contact !== null;
}
