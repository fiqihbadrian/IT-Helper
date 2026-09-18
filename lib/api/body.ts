import { badRequest } from "@/lib/api/errors";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/constants";
import type { TicketPriority, TicketStatus } from "@/types";

/** Parse a JSON object body, turning anything else into a 400 rather than a 500. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw badRequest("Body must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("Body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

/**
 * Enum parsing. Values arrive from hand-written scripts as often as from typed
 * clients, so a typo gets a message listing the accepted values instead of a
 * Postgres constraint violation.
 */
export function parseStatus(value: unknown): TicketStatus {
  const status = String(value ?? "").trim().toUpperCase();
  if (!TICKET_STATUSES.includes(status as TicketStatus)) {
    throw badRequest(`Unknown status "${value}".`, { allowed: TICKET_STATUSES });
  }
  return status as TicketStatus;
}

export function parsePriority(value: unknown): TicketPriority {
  const priority = String(value ?? "").trim().toUpperCase();
  if (!TICKET_PRIORITIES.includes(priority as TicketPriority)) {
    throw badRequest(`Unknown priority "${value}".`, { allowed: TICKET_PRIORITIES });
  }
  return priority as TicketPriority;
}

/** Optional variant: returns null when absent, throws when present but invalid. */
export function parseOptionalStatus(value: unknown): TicketStatus | null {
  if (value === undefined || value === null || value === "") return null;
  return parseStatus(value);
}

export function parseOptionalPriority(value: unknown): TicketPriority | null {
  if (value === undefined || value === null || value === "") return null;
  return parsePriority(value);
}
