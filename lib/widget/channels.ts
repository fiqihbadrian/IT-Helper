import "server-only";

import { asSystem } from "@/lib/db/pool";
import { forbidden, notFound, unauthorized } from "@/lib/api/errors";
import { readChannelKey } from "@/lib/widget/keys";
import type { TicketPriority } from "@/types";

/** A channel row, camel-cased for the widget API's JSON payloads. */
export interface WidgetChannel {
  id: string;
  name: string;
  slug: string;
  publicKey: string;
  allowedOrigins: string[];
  departmentId: string | null;
  defaultCategoryId: string | null;
  defaultPriority: TicketPriority;
  greeting: string;
  accentColor: string;
  systemProfileId: string;
  isActive: boolean;
}

interface ChannelRow {
  id: string;
  name: string;
  slug: string;
  public_key: string;
  allowed_origins: string[];
  department_id: string | null;
  default_category_id: string | null;
  default_priority: TicketPriority;
  greeting: string;
  accent_color: string;
  system_profile_id: string;
  is_active: boolean;
}

const CHANNEL_COLUMNS = `
  id, name, slug, public_key, allowed_origins, department_id, default_category_id,
  default_priority, greeting, accent_color, system_profile_id, is_active
`;

function toChannel(row: ChannelRow): WidgetChannel {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    publicKey: row.public_key,
    allowedOrigins: row.allowed_origins ?? [],
    departmentId: row.department_id,
    defaultCategoryId: row.default_category_id,
    defaultPriority: row.default_priority,
    greeting: row.greeting,
    accentColor: row.accent_color,
    systemProfileId: row.system_profile_id,
    isActive: row.is_active,
  };
}

/**
 * Look a channel up by its public key.
 *
 * Runs on the service-role connection: the caller is an anonymous browser, so
 * there is no identity to impersonate yet. This is a read of a row that is
 * public by design — the key names it — and it is the one query in the widget
 * flow that does not go through `asUser()`.
 */
export async function findChannelByKey(publicKey: string): Promise<WidgetChannel | null> {
  const row = await asSystem(async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `select ${CHANNEL_COLUMNS} from public.channels where public_key = $1`,
      [publicKey],
    );
    return rows[0] ?? null;
  });

  return row ? toChannel(row) : null;
}

/**
 * Is this origin allowed to run the widget?
 *
 * Be honest about what this is: an `Origin` header is a claim, not a fact. Any
 * non-browser client can send whatever it likes, and a hostile page can proxy
 * through its own server. The check exists to stop the *ordinary* failure mode —
 * someone copying the snippet onto a site you did not intend — not to stop a
 * determined attacker.
 *
 * What actually bounds abuse is elsewhere: the public key grants no read access
 * to anything (see `widget_sessions`), message length is capped, and the rate
 * limits in `lib/widget/rate.ts` are counted in the database, not the browser.
 *
 * An absent `Origin` means the caller is not a browser at all, and this check
 * was never going to apply to them, so it passes rather than producing a
 * confusing error for a server-side integration.
 */
export function isOriginAllowed(channel: WidgetChannel, origin: string | null): boolean {
  if (!origin) return true;
  if (channel.allowedOrigins.includes("*")) return true;
  return channel.allowedOrigins.includes(origin);
}

export interface WidgetRequestContext {
  channel: WidgetChannel;
  origin: string | null;
}

/**
 * Resolve the channel named by `X-Widget-Key` and confirm the request's origin
 * is one the channel trusts. Every widget endpoint starts here.
 */
export async function resolveWidgetChannel(request: Request): Promise<WidgetRequestContext> {
  const key = readChannelKey(request);
  if (!key) throw unauthorized("Missing X-Widget-Key header.");

  const channel = await findChannelByKey(key);
  if (!channel) throw unauthorized("This widget key is not recognised.");
  if (!channel.isActive) throw forbidden("This chat channel is switched off.");

  const origin = request.headers.get("origin");
  if (!isOriginAllowed(channel, origin)) {
    throw forbidden(
      `Origin ${origin} is not allowed for this channel. Add it under Admin → Channels.`,
      { origin },
    );
  }

  return { channel, origin };
}

/** Channel lookup for the admin UI, which runs as a signed-in staff member. */
export async function findChannelById(id: string): Promise<WidgetChannel | null> {
  const row = await asSystem(async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `select ${CHANNEL_COLUMNS} from public.channels where id = $1`,
      [id],
    );
    return rows[0] ?? null;
  });

  return row ? toChannel(row) : null;
}

export function assertChannelExists(channel: WidgetChannel | null): WidgetChannel {
  if (!channel) throw notFound("Channel not found.");
  return channel;
}
