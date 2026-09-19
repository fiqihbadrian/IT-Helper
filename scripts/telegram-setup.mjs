#!/usr/bin/env node
/**
 * Registers (or clears) a Telegram webhook — one bot at a time.
 *
 *   node scripts/telegram-setup.mjs --bot staff https://it-helpdesk.example.workers.dev
 *   node scripts/telegram-setup.mjs --bot employee --info
 *   node scripts/telegram-setup.mjs --bot staff --delete
 *   node scripts/telegram-setup.mjs --bot employee --menus
 *   node scripts/telegram-setup.mjs --bot employee --clean-overrides 8620947265
 *
 * Registering keeps Telegram's pending updates by default. Dropping them throws
 * away whatever a real person typed while the webhook was broken, which is
 * exactly the moment you are least willing to lose it — pass `--drop-pending`
 * when the backlog is known junk.
 *
 * Telegram requires a public HTTPS URL, so for local development run a tunnel
 * first (ngrok/cloudflared) and pass that URL here.
 *
 * `--bot` selects which token from .env.local to use; the names come from
 * `lib/telegram/bots.ts` so this script and the app can never disagree about
 * which bot is which. Node strips the TypeScript on import — the module has no
 * imports of its own and no runtime dependencies.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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

const args = process.argv.slice(2);

/**
 * Reads `--name value`, and returns null when the value is missing or is itself
 * another flag — otherwise `--menus --bot staff` would read `--bot` as a chat id
 * and call Telegram with `chat_id: NaN`.
 */
const flagValue = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const next = args[index + 1];
  return next && !next.startsWith("--") ? next : null;
};

// Values swallowed by a flag are not positional arguments, so the webhook URL
// cannot be confused with the bot name.
const consumed = new Set(
  ["--bot", "--menus", "--clean-overrides"]
    .map((name) => flagValue(name))
    .filter((value) => value !== null),
);

const bot = flagValue("--bot") ?? "employee";
if (!BOT_KINDS.includes(bot)) {
  console.error(`--bot must be one of: ${BOT_KINDS.join(", ")}`);
  process.exit(1);
}

const tokenVar = BOT_TOKEN_VARS[bot].find((name) => process.env[name]);
const token = tokenVar ? process.env[tokenVar] : null;
if (!token) {
  console.error(
    `${BOT_META[bot].label}: no token found.\n` +
      `Set one of ${BOT_TOKEN_VARS[bot].join(", ")} in .env.local`,
  );
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

const me = await call("getMe");
const heading = `${BOT_META[bot].label} — @${me.username} (${me.first_name}) via ${tokenVar}`;

if (args.includes("--info")) {
  console.log(heading);
  console.log(JSON.stringify(await call("getWebhookInfo"), null, 2));
  process.exit(0);
}

if (args.includes("--delete")) {
  await call("deleteWebhook", { drop_pending_updates: true });
  console.log(`${heading}\nWebhook deleted.`);
  process.exit(0);
}

/**
 * The ☰ command menu is not installed from here: `lib/telegram/menu.ts` owns the
 * lists and the bot registers them itself, so there is no second copy to drift.
 * This flag only reports what Telegram currently holds.
 *
 * There are no per-chat overrides in this design — each bot has exactly one
 * default menu — so any override found is leftover from the single-bot era and
 * should be removed with `--clean-overrides`.
 */
if (args.includes("--menus")) {
  const chatId = flagValue("--menus") || args.find((arg) => /^-?\d+$/.test(arg));

  const show = (label, commands) => {
    console.log(`\n${label} (${commands.length})`);
    for (const item of commands) console.log(`  /${item.command.padEnd(12)} ${item.description}`);
    if (!commands.length) console.log("  (kosong)");
  };

  console.log(heading);
  show("default — dipakai semua orang", await call("getMyCommands", { scope: { type: "default" } }));

  if (chatId) {
    const override = await call("getMyCommands", {
      scope: { type: "chat", chat_id: Number(chatId) },
    });
    show(`chat ${chatId} — override`, override);
    if (override.length) {
      console.log(
        `\nOverride itu sisa dari era satu bot. Hapus:\n` +
          `  node scripts/telegram-setup.mjs --bot ${bot} --clean-overrides ${chatId}`,
      );
    }
  } else {
    console.log("\nTip: --menus <chatId> untuk memeriksa override per chat.");
  }

  process.exit(0);
}

if (args.includes("--clean-overrides")) {
  const chatId = flagValue("--clean-overrides") || args.find((arg) => /^\d+$/.test(arg));
  if (!chatId) {
    console.error("--clean-overrides needs a chat id.");
    process.exit(1);
  }
  await call("deleteMyCommands", { scope: { type: "chat", chat_id: Number(chatId) } });
  console.log(`${heading}\nPer-chat override for ${chatId} deleted.`);
  process.exit(0);
}

const baseUrl = args.find((arg) => !arg.startsWith("--") && !consumed.has(arg));
if (!baseUrl || baseUrl.includes("localhost")) {
  console.error(
    "Telegram needs a public HTTPS URL.\n" +
      "  ngrok http 3000\n" +
      `  node scripts/telegram-setup.mjs --bot ${bot} https://<id>.ngrok-free.app`,
  );
  process.exit(1);
}

const secret =
  process.env.TELEGRAM_WEBHOOK_SECRET ??
  process.env.TELEGRAM_SECRET ??
  randomBytes(24).toString("hex");
const webhookUrl = `${baseUrl.replace(/\/$/, "")}${webhookPath(bot)}`;

await call("setWebhook", {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: args.includes("--drop-pending"),
});

const info = await call("getWebhookInfo");

console.log(heading);
console.log(`Webhook  ${webhookUrl}`);
console.log(`Pending  ${info.pending_update_count ?? 0}`);

if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
  console.log("");
  console.log("Add this to .env.local and restart the app:");
  console.log(`TELEGRAM_WEBHOOK_SECRET=${secret}`);
}
