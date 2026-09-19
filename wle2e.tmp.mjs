import pg from "pg";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const BASE = "http://localhost:3010";
const ADMIN_UID = "11111111-1111-4111-8111-111111111111";
const CHAT = 8620947265;

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const step = (label, value) => console.log(label.padEnd(34), typeof value === "string" ? value : JSON.stringify(value));

// link the chat so the bot can resolve it
await c.query(`insert into public.telegram_links (bot, chat_id, profile_id) values ('employee',$1,$2)
  on conflict (bot, chat_id) do update set profile_id = excluded.profile_id`, [CHAT, ADMIN_UID]);
step("linked chat ->", (await c.query(`select profile_id from public.telegram_links where bot='employee' and chat_id=$1`,[CHAT])).rows[0]);

// 1. browser asks for a code
const start = await (await fetch(`${BASE}/api/auth/telegram`, { method: "POST" })).json();
const code = start.data.code;
const cookie = "it-helpdesk-login=" + start.headers?.get?.("set-cookie") ?? "";
step("code ->", code);

// grab the cookie from the raw response
const raw = await fetch(`${BASE}/api/auth/telegram`, { method: "POST" });
const jar = (raw.headers.getSetCookie?.() ?? [])[0].split(";")[0];
const code2 = (await raw.json()).data.code;
step("code2 ->", code2);

// 2. the visitor presses the deep-link button and Telegram posts /start login_CODE
const update = {
  update_id: 900000000 + Math.floor(Math.random() * 100000),
  message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: CHAT, type: "private" }, from: { id: CHAT, is_bot: false, first_name: "Andi" }, text: `/start login_${code2}` },
};
const hook = await fetch(`${BASE}/api/telegram/webhook`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET },
  body: JSON.stringify(update),
});
step("webhook ->", `${hook.status} ${await hook.text()}`);

// 3. the browser polls with its own cookie
const poll = await fetch(`${BASE}/api/auth/telegram?code=${code2}`, { headers: { cookie: jar } });
const pollCookie = (poll.headers.getSetCookie?.() ?? []).join("; ");
step("poll ->", await poll.json());
step("session cookie set ->", /auth-token/.test(pollCookie));

// 4. the session actually works
const dash = await fetch(`${BASE}/dashboard`, { headers: { cookie: jar + "; " + pollCookie.split("; ").filter((p) => p.startsWith("sb-")).join("; ") } });
const html = await dash.text();
step("dashboard ->", `${dash.status} as ${/Andi Pratama/.test(html) ? "Andi Pratama" : "?"}`);

step("row ->", (await c.query(`select profile_id, used_at is not null as spent from public.web_login_codes where code=$1`, [code2])).rows[0]);
await c.query(`delete from public.telegram_links where bot='employee' and chat_id=$1`, [CHAT]);
await c.query(`delete from public.web_login_codes`);
await c.end();
