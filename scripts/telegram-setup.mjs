#!/usr/bin/env node
/**
 * Registers (or clears) the Telegram webhook.
 *
 *   node scripts/telegram-setup.mjs https://your-app.vercel.app
 *   node scripts/telegram-setup.mjs --info
 *   node scripts/telegram-setup.mjs --delete
 *
 * Telegram requires a public HTTPS URL, so for local development run a tunnel
 * first (ngrok/cloudflared) and pass that URL here.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");

for (const file of [".env.local", ".env"]) {
  const full = path.join(root, file);
  if (!existsSync(full)) continue;
  for (const line of (await readFile(full, "utf8")).split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TELE;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN (or BOT_TELE) is missing from .env.local");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${token}`;

async function call(method, payload) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`${method}: ${body.description}`);
  return body.result;
}

const args = process.argv.slice(2);

if (args.includes("--info")) {
  const me = await call("getMe");
  const info = await call("getWebhookInfo");
  console.log(`Bot: @${me.username} (${me.first_name})`);
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}

if (args.includes("--delete")) {
  await call("deleteWebhook", { drop_pending_updates: true });
  console.log("Webhook deleted.");
  process.exit(0);
}

const baseUrl = args.find((arg) => !arg.startsWith("--")) ?? process.env.NEXT_PUBLIC_APP_URL;
if (!baseUrl || baseUrl.includes("localhost")) {
  console.error(
    "Telegram needs a public HTTPS URL.\n" +
      "  ngrok http 3000\n" +
      "  node scripts/telegram-setup.mjs https://<id>.ngrok-free.app",
  );
  process.exit(1);
}

const secret =
  process.env.TELEGRAM_WEBHOOK_SECRET ??
  process.env.TELEGRAM_SECRET ??
  randomBytes(24).toString("hex");
const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;

const me = await call("getMe");
await call("setWebhook", {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});

const info = await call("getWebhookInfo");

console.log(`Bot      @${me.username}`);
console.log(`Webhook  ${webhookUrl}`);
console.log(`Pending  ${info.pending_update_count ?? 0}`);

if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
  console.log("");
  console.log("Add this to .env.local and restart the app:");
  console.log(`TELEGRAM_WEBHOOK_SECRET=${secret}`);
}