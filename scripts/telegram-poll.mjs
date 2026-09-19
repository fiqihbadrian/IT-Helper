#!/usr/bin/env node
/**
 * Local development without a public URL.
 *
 * Telegram only delivers webhooks to HTTPS, so while working on localhost this
 * script long-polls `getUpdates` and forwards each update to the very same
 * webhook route the real thing would hit. Nothing is duplicated: the same
 * handler, the same dedup table, the same replies.
 *
 *   npm run dev                        # in one terminal
 *   npm run telegram:poll              # employee bot
 *   npm run telegram:poll:staff        # staff bot
 *
 * Stop it with Ctrl+C, then run `npm run telegram:setup -- --bot <bot> <url>` to
 * switch back to real webhooks when you deploy.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { BOT_KINDS, BOT_META, BOT_TOKEN_VARS, webhookPath } from "../lib/telegram/bots.ts";

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

const bot = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "employee";
if (!BOT_KINDS.includes(bot)) {
  console.error(`Bot must be one of: ${BOT_KINDS.join(", ")}`);
  process.exit(1);
}

const tokenVar = BOT_TOKEN_VARS[bot].find((name) => process.env[name]);
const token = tokenVar ? process.env[tokenVar] : null;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? process.env.TELEGRAM_SECRET;
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!token) {
  console.error(
    `${BOT_META[bot].label}: no token found.\n` +
      `Set one of ${BOT_TOKEN_VARS[bot].join(", ")} in .env.local`,
  );
  process.exit(1);
}
if (!secret) {
  console.error("TELEGRAM_WEBHOOK_SECRET is missing from .env.local");
  process.exit(1);
}

/**
 * This script starts by deleting the webhook, which would silently take the
 * deployed bot offline. Refuse to run against anything that is not localhost.
 */
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(appUrl)) {
  console.error(
    `Refusing to poll: NEXT_PUBLIC_APP_URL is ${appUrl}, not localhost.\n` +
      "Polling deletes the webhook, which would kill the deployed bot.",
  );
  process.exit(1);
}

const API = `https://api.telegram.org/bot${token}`;

async function telegram(method, payload = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`${method}: ${body.description}`);
  return body.result;
}

// getUpdates and webhooks are mutually exclusive; clear any registered webhook.
await telegram("deleteWebhook", { drop_pending_updates: false });

const me = await telegram("getMe");
const endpoint = `${appUrl}${webhookPath(bot)}`;
console.log(`${BOT_META[bot].label} — polling as @${me.username} → ${endpoint}`);
console.log("Ctrl+C to stop.\n");

let offset = 0;
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
  console.log("\nStopping…");
});

while (!stopping) {
  let updates;
  try {
    updates = await telegram("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message", "callback_query"],
    });
  } catch (error) {
    console.error(`getUpdates failed: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    continue;
  }

  for (const update of updates) {
    offset = update.update_id + 1;

    const summary =
      update.message?.text ??
      update.message?.caption ??
      (update.callback_query ? `callback ${update.callback_query.data}` : "(non-text)");
    console.log(`→ ${update.update_id}: ${String(summary).slice(0, 70)}`);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": secret,
        },
        body: JSON.stringify(update),
      });

      if (!response.ok) {
        console.error(`   webhook responded ${response.status}`);
      }
    } catch (error) {
      console.error(`   could not reach the app: ${error.message}`);
    }
  }
}

console.log("Stopped.");
