import { handleTelegramWebhook } from "@/lib/telegram/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook for the staff bot (@bian_itbot).
 *
 * A separate URL rather than a path segment on the shared one: the webhook
 * secret is the same for both, so the URL is the only thing telling the handler
 * which token to answer with.
 */
export async function POST(request: Request) {
  return handleTelegramWebhook("staff", request);
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "telegram-webhook", bot: "staff" });
}
