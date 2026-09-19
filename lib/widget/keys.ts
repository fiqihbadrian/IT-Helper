import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Keys and tokens for the widget API.
 *
 * Both are the same shape as an API key (`lib/api/auth.ts`): a random secret
 * that is shown once and stored only as a sha256 hash. A database dump must not
 * contain anything replayable.
 *
 * They are not the same *kind* of secret, though, and the difference matters:
 *
 *   public_key  ships in the page source of the customer's website. It is public
 *               by definition. It names a channel; it authorises nothing.
 *   token       lives in one visitor's localStorage and is the only thing that
 *               ties them to their conversation.
 */

const PUBLIC_KEY_PREFIX = "wk_";

export function generateChannelPublicKey(): string {
  return PUBLIC_KEY_PREFIX + randomBytes(18).toString("base64url");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** One-way, like an API key: the raw token is never stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** `X-Widget-Key: wk_…` — the channel, sent on every widget request. */
export function readChannelKey(request: Request): string | null {
  return request.headers.get("x-widget-key")?.trim() || null;
}

/** `X-Widget-Token: …` — this visitor's session, sent once one exists. */
export function readSessionToken(request: Request): string | null {
  return request.headers.get("x-widget-token")?.trim() || null;
}

/**
 * A stable, non-identifying handle for one browser.
 *
 * Sent by the widget and stored on the contact row so staff can see that the
 * same person has written in before. It is *not* an authentication token — the
 * widget's session token is — so a forged value costs nothing.
 */
export function sanitiseVisitorRef(value: unknown): string {
  const ref = String(value ?? "").trim();
  return ref ? ref.slice(0, 64) : "unknown";
}
