import { handleTelegramWebhook } from "@/lib/telegram/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Webhook for the employee bot (@bian_it_bot). */
export async function POST(request: Request) {
  return handleTelegramWebhook("employee", request);
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "telegram-webhook", bot: "employee" });
}
