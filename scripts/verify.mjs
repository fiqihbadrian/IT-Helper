#!/usr/bin/env node
/**
 * End-to-end checks against the live Supabase project.
 * Verifies that authorisation is enforced by the database, not just the UI.
 *
 *   node scripts/verify.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in .env.local, plus seeded demo users.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const PASSWORD = "Password123!";

const ACCOUNTS = {
  admin: "admin@helpdesk.test",
  support1: "support1@helpdesk.test",
  employee1: "employee1@helpdesk.test",
  employee2: "employee2@helpdesk.test",
};

// The deployed demo rotates every seeded password except `employee1`, so that
// publishing the README does not hand out an admin login. A fresh clone with a
// fresh seed has no VERIFY_PASSWORD, and everything falls back to the seed
// password, so this file keeps working in both places.
//
// Read lazily: loadEnv() runs inside main(), so a module-scope read would
// happen before .env.local has been parsed.
function passwordFor(email) {
  const rotated = process.env.VERIFY_PASSWORD;
  return rotated && email !== ACCOUNTS.employee1 ? rotated : PASSWORD;
}

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function loadEnv() {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (!process.env[key]) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

class Session {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.token = null;
  }

  headers() {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.token ?? this.key}`,
      "Content-Type": "application/json",
    };
  }

  async signIn(email) {
    const response = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: passwordFor(email) }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error_description ?? body.msg ?? "sign-in failed");
    this.token = body.access_token;
    this.userId = body.user.id;
    this.email = email;
    return body;
  }

  async rest(table, query = "select=*") {
    const response = await fetch(`${this.url}/rest/v1/${table}?${query}`, {
      headers: this.headers(),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  async insert(table, row) {
    const response = await fetch(`${this.url}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...this.headers(), Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  async patch(table, query, patch) {
    const response = await fetch(`${this.url}/rest/v1/${table}?${query}`, {
      method: "PATCH",
      headers: { ...this.headers(), Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  async rpc(name, args = {}) {
    const response = await fetch(`${this.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(args),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  async remove(table, query) {
    const response = await fetch(`${this.url}/rest/v1/${table}?${query}`, {
      method: "DELETE",
      headers: { ...this.headers(), Prefer: "return=representation" },
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
}

async function main() {
  await loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / publishable key in .env.local");
    process.exit(1);
  }

  console.log(`Project: ${url}\n`);

  // ---------------------------------------------------------------------------
  console.log("Schema");
  const anon = new Session(url, key);
  const probe = await anon.rest("profiles", "select=id&limit=1");
  if (probe.status === 404 || probe.body?.code === "PGRST205") {
    console.error(
      "  FAIL  schema not applied — public.profiles does not exist.\n" +
        "        Run `npm run db:push` or paste supabase/all_in_one_schema.sql into the SQL editor.",
    );
    process.exit(1);
  }
  check("public.profiles exists", true);
  check("anon cannot read profiles", probe.status >= 400 || (probe.body ?? []).length === 0);

  // ---------------------------------------------------------------------------
  console.log("\nSign-in");
  const sessions = {};
  for (const [label, email] of Object.entries(ACCOUNTS)) {
    const session = new Session(url, key);
    try {
      await session.signIn(email);
      sessions[label] = session;
      check(`${label} signs in`, true);
    } catch (error) {
      check(`${label} signs in`, false, error.message);
    }
  }

  if (Object.keys(sessions).length < 4) {
    console.error("\nSeed data missing. Run `npm run db:push` (includes seed.sql).");
    process.exit(1);
  }

  const { admin, support1, employee1, employee2 } = sessions;

  // ---------------------------------------------------------------------------
  console.log("\nProfile visibility");
  const staffProfiles = await support1.rest("profiles", "select=id&limit=100");
  check("IT support can list profiles", Array.isArray(staffProfiles.body));

  const empProfiles = await employee1.rest(
    "profiles",
    "select=id,role&limit=100",
  );
  const empRows = empProfiles.body ?? [];
  const empIds = empRows.map((row) => row.id);
  check(
    "employee always sees their own profile",
    empIds.includes(employee1.userId),
    `got ${empIds.length} rows`,
  );
  // The extra rows are ticket participants, which the conversation UI needs.
  // What must not happen is a colleague who shares no ticket becoming visible.
  check(
    "employee cannot see an unrelated colleague",
    !empIds.includes(employee2.userId),
    `saw ${empRows.map((r) => r.role).join(", ")}`,
  );
  check(
    "employee sees fewer profiles than the whole directory",
    empIds.length < 5,
    `got ${empIds.length} rows`,
  );

  const emp2Profiles = await employee2.rest("profiles", "select=id&limit=100");
  check(
    "an employee cannot see another employee's profile",
    !(emp2Profiles.body ?? []).map((row) => row.id).includes(employee1.userId),
  );

  // The ticket conversation shows who replied, so the agent who handled a
  // requester's ticket has to be readable by that requester.
  const repliedTickets = await support1.rest(
    "ticket_comments",
    "select=ticket_id,user_id&limit=200",
  );
  const agentId = (repliedTickets.body ?? []).find((row) => row.user_id !== employee1.userId)
    ?.user_id;
  if (agentId) {
    const agentProfile = await employee1.rest("profiles", `select=id&id=eq.${agentId}`);
    check(
      "requester can read the profile of an agent on their ticket",
      (agentProfile.body ?? []).length === 1,
      `got ${(agentProfile.body ?? []).length} rows`,
    );
  }

  // ---------------------------------------------------------------------------
  console.log("\nTicket isolation");
  const allTickets = await support1.rest("tickets", "select=id,ticket_number,created_by&limit=100");
  check("IT support sees all tickets", (allTickets.body ?? []).length > 0);
  const totalForStaff = (allTickets.body ?? []).length;

  const ownTickets = await employee1.rest("tickets", "select=id,created_by&limit=100");
  const ownRows = ownTickets.body ?? [];
  check(
    "employee sees only their own tickets",
    ownRows.length > 0 && ownRows.every((row) => row.created_by === employee1.userId),
    `${ownRows.length} rows`,
  );

  const emp2Tickets = await employee2.rest("tickets", "select=id,created_by&limit=100");
  const emp2Rows = emp2Tickets.body ?? [];
  check(
    "second employee sees a disjoint set",
    emp2Rows.length > 0 &&
      emp2Rows.every((row) => row.created_by === employee2.userId) &&
      !ownRows.some((row) => emp2Rows.some((other) => other.id === row.id)),
  );

  check(
    "employee sees fewer tickets than staff",
    ownRows.length < totalForStaff,
    `employee ${ownRows.length} vs staff ${totalForStaff}`,
  );

  // direct id access, the URL-tampering path
  const foreign = emp2Rows.find((row) => row.created_by !== employee1.userId);
  if (foreign) {
    const direct = await employee1.rest("tickets", `select=id&id=eq.${foreign.id}`);
    check(
      "employee cannot fetch another employee's ticket by id",
      (direct.body ?? []).length === 0,
      `got ${(direct.body ?? []).length} rows`,
    );

    const comments = await employee1.rest(
      "ticket_comments",
      `select=id&ticket_id=eq.${foreign.id}`,
    );
    check(
      "employee cannot read comments of a foreign ticket",
      (comments.body ?? []).length === 0,
    );

    const history = await employee1.rest(
      "ticket_history",
      `select=id&ticket_id=eq.${foreign.id}`,
    );
    check(
      "employee cannot read history of a foreign ticket",
      (history.body ?? []).length === 0,
    );
  }

  // ---------------------------------------------------------------------------
  console.log("\nWrite permissions");
  const categoryId = (await support1.rest("categories", "select=id&is_active=eq.true&limit=1"))
    .body?.[0]?.id;

  const created = await employee1.insert("tickets", {
    title: "Verification ticket (safe to delete)",
    description: "Created by scripts/verify.mjs to check insert policies and triggers.",
    category_id: categoryId,
    priority: "LOW",
    created_by: employee1.userId,
  });
  check("employee can create a ticket", created.status === 201, `status ${created.status}`);

  const newTicket = created.body?.[0];
  if (newTicket) {
    check(
      "ticket_number is human readable",
      /^IT-\d{6}$/.test(newTicket.ticket_number ?? ""),
      newTicket.ticket_number,
    );
    check("ticket starts as OPEN", newTicket.status === "OPEN", newTicket.status);

    const history = await employee1.rest(
      "ticket_history",
      `select=action&ticket_id=eq.${newTicket.id}`,
    );
    check(
      "creation writes a ticket_history row",
      (history.body ?? []).some((row) => row.action === "CREATED"),
    );

    const forged = await employee1.insert("tickets", {
      title: "Forged ownership",
      description: "Attempting to create a ticket on behalf of another employee.",
      category_id: categoryId,
      priority: "LOW",
      created_by: employee2.userId,
    });
    check(
      "employee cannot create a ticket for someone else",
      forged.status >= 400,
      `status ${forged.status}`,
    );

    const empUpdate = await employee1.patch(
      "tickets",
      `id=eq.${newTicket.id}`,
      { status: "CLOSED" },
    );
    check(
      "employee cannot change ticket status",
      (empUpdate.body ?? []).length === 0,
      `updated ${(empUpdate.body ?? []).length}`,
    );

    const staffUpdate = await support1.patch(
      "tickets",
      `id=eq.${newTicket.id}`,
      { priority: "HIGH" },
    );
    check("IT support can change priority", (staffUpdate.body ?? []).length === 1);

    const escalation = await employee1.rest(
      "ticket_history",
      `select=action,old_value,new_value&ticket_id=eq.${newTicket.id}&action=eq.PRIORITY_CHANGED`,
    );
    check(
      "priority change is recorded in history",
      (escalation.body ?? []).length === 1 &&
        escalation.body[0].old_value === "LOW" &&
        escalation.body[0].new_value === "HIGH",
    );

    const notify = await employee1.rest(
      "notifications",
      `select=id&ticket_id=eq.${newTicket.id}`,
    );
    check(
      "requester is notified about the priority change",
      (notify.body ?? []).length > 0,
    );

    const comment = await employee1.insert("ticket_comments", {
      ticket_id: newTicket.id,
      user_id: employee1.userId,
      message: "Verification comment.",
    });
    check("employee can comment on their own ticket", comment.status === 201);

    const foreignComment = await employee1.insert("ticket_comments", {
      ticket_id: foreign?.id ?? newTicket.id,
      user_id: employee1.userId,
      message: "Attempting to comment on a foreign ticket.",
    });
    if (foreign) {
      check(
        "employee cannot comment on a foreign ticket",
        foreignComment.status >= 400,
        `status ${foreignComment.status}`,
      );
    }

    const forgedHistory = await employee1.insert("ticket_history", {
      ticket_id: newTicket.id,
      user_id: employee1.userId,
      action: "STATUS_CHANGED",
      old_value: "OPEN",
      new_value: "CLOSED",
    });
    check(
      "clients cannot forge ticket_history rows",
      forgedHistory.status >= 400,
      `status ${forgedHistory.status}`,
    );

    // The ticket exists only to exercise the policies above, so remove it rather
    // than leaving a stray row in the demo data. Deleting is admin-only, which is
    // itself worth asserting.
    const employeeDelete = await employee1.remove("tickets", `id=eq.${newTicket.id}`);
    check(
      "employee cannot delete a ticket",
      (employeeDelete.body ?? []).length === 0,
      `status ${employeeDelete.status}`,
    );

    const adminDelete = await admin.remove("tickets", `id=eq.${newTicket.id}`);
    check(
      "admin can delete a ticket",
      (adminDelete.body ?? []).length === 1,
      `status ${adminDelete.status}`,
    );
  }

  // ---------------------------------------------------------------------------
  console.log("\nPrivilege escalation");
  const escalate = await employee1.patch(
    "profiles",
    `id=eq.${employee1.userId}`,
    { role: "admin" },
  );
  const promoted = (escalate.body ?? [])[0]?.role;
  check(
    "employee cannot promote themselves to admin",
    promoted !== "admin",
    `role is now ${promoted ?? "unchanged"}`,
  );

  const selfDeactivate = await employee1.patch(
    "profiles",
    `id=eq.${employee1.userId}`,
    { is_active: false },
  );
  check(
    "employee cannot deactivate themselves",
    (selfDeactivate.body ?? [])[0]?.is_active !== false,
  );

  const adminCanRead = await admin.rest("profiles", "select=id&limit=200");
  check("admin can list all profiles", (adminCanRead.body ?? []).length >= 5);

  // ---------------------------------------------------------------------------
  console.log("\nAPI keys");
  const keyName = `verify ${Date.now()}`;
  const keyCreated = await employee1.rpc("create_api_key", { p_name: keyName });
  const plaintext = keyCreated.body?.[0]?.api_key;
  check(
    "user can mint an API key",
    keyCreated.status === 200 && typeof plaintext === "string" && plaintext.startsWith("itk_"),
    `status ${keyCreated.status}`,
  );

  if (plaintext) {
    const verified = await support1.rpc("verify_api_key", { p_key: plaintext });
    check(
      "verify_api_key resolves the owner",
      verified.body?.[0]?.email === employee1.email,
      JSON.stringify(verified.body)?.slice(0, 120),
    );
    check(
      "verify_api_key reports the key name",
      verified.body?.[0]?.key_name === keyName,
      `got ${verified.body?.[0]?.key_name}`,
    );

    const wrong = await employee1.rpc("verify_api_key", { p_key: "itk_not-a-real-key" });
    check(
      "verify_api_key rejects an unknown key",
      (wrong.body ?? []).length === 0,
      JSON.stringify(wrong.body)?.slice(0, 120),
    );

    const keyId = keyCreated.body[0].id;
    const employee2Saw = await employee2.rest(
      "api_keys",
      `select=id&id=eq.${keyId}`,
    );
    check(
      "another user cannot see your API key",
      (employee2Saw.body ?? []).length === 0,
      JSON.stringify(employee2Saw.body)?.slice(0, 120),
    );

    const employeeRevoke = await employee1.rpc("revoke_api_key", { p_id: keyId });
    check("owner can revoke their own key", employeeRevoke.body === true);

    const afterRevoke = await employee1.rpc("verify_api_key", { p_key: plaintext });
    check(
      "a revoked key stops working",
      (afterRevoke.body ?? []).length === 0,
      JSON.stringify(afterRevoke.body)?.slice(0, 120),
    );

    // Revoking keeps the row for the audit trail, but a verification run should
    // not leave keys behind either.
    const swept = await admin.remove("api_keys", `id=eq.${keyId}`);
    check("admin can delete an api key row", (swept.body ?? []).length === 1);
  }

  const adminKey = await admin.rpc("create_api_key", { p_name: `verify admin ${Date.now()}` });
  const adminPlain = adminKey.body?.[0]?.api_key;
  if (adminPlain) {
    const foreignRevoke = await employee1.rpc("revoke_api_key", {
      p_id: adminKey.body[0].id,
    });
    check("employee cannot revoke someone else's key", foreignRevoke.body === false);
    await admin.rpc("revoke_api_key", { p_id: adminKey.body[0].id });
    await admin.remove("api_keys", `id=eq.${adminKey.body[0].id}`);
  }

  // ---------------------------------------------------------------------------
  console.log("\nTelegram linking (two bots)");
  const chatId = 990000000 + Math.floor(Math.random() * 9999);
  const staffChatId = chatId + 1;
  const mintedCodes = [];

  const empCodeRes = await employee1.rpc("create_telegram_link_code", { p_bot: "employee" });
  const code = empCodeRes.body?.[0]?.code;
  if (code) mintedCodes.push(code);
  check(
    "an employee can request an employee-bot link code",
    typeof code === "string" && code.length === 6,
    JSON.stringify(empCodeRes.body)?.slice(0, 120),
  );

  if (code) {
    const redeemed = await employee1.rpc("redeem_telegram_code", {
      p_code: code.toLowerCase(),
      p_bot: "employee",
      p_chat_id: chatId,
    });
    check(
      "a valid code links the chat to the account",
      redeemed.body?.[0]?.user_id === employee1.userId,
      JSON.stringify(redeemed.body)?.slice(0, 160),
    );

    const replay = await employee1.rpc("redeem_telegram_code", {
      p_code: code,
      p_bot: "employee",
      p_chat_id: chatId + 1,
    });
    check("a code cannot be redeemed twice", (replay.body ?? []).length === 0);

    const lookup = await employee1.rpc("profile_for_telegram_chat", {
      p_bot: "employee",
      p_chat_id: chatId,
    });
    check(
      "the linked chat resolves back to the profile",
      lookup.body?.[0]?.email === employee1.email,
      JSON.stringify(lookup.body)?.slice(0, 160),
    );

    // The same human has the same private chat id on both bots, so a link has
    // to be keyed by (bot, chat_id) — never by chat_id alone.
    const wrongBot = await employee1.rpc("profile_for_telegram_chat", {
      p_bot: "staff",
      p_chat_id: chatId,
    });
    check(
      "the same chat id does not resolve on the other bot",
      (wrongBot.body ?? []).length === 0,
      JSON.stringify(wrongBot.body)?.slice(0, 160),
    );

    const crossBot = await employee1.rpc("redeem_telegram_code", {
      p_code: "ZZZZZZ",
      p_bot: "staff",
      p_chat_id: chatId,
    });
    check("an unknown code is rejected", (crossBot.body ?? []).length === 0);

    const unlinked = await employee1.rpc("unlink_telegram", {
      p_bot: "employee",
      p_chat_id: chatId,
    });
    check("unlinking clears the chat", unlinked.body === true);

    const afterUnlink = await employee1.rpc("profile_for_telegram_chat", {
      p_bot: "employee",
      p_chat_id: chatId,
    });
    check("an unlinked chat resolves to nothing", (afterUnlink.body ?? []).length === 0);
  }

  // The staff bot is not a preference, it is a boundary: an employee must not be
  // able to mint a staff-bot code at all. The bot's refusal to show the commands
  // is presentation; this is the gate.
  const empStaffCode = await employee1.rpc("create_telegram_link_code", { p_bot: "staff" });
  check(
    "an employee cannot mint a staff-bot link code",
    empStaffCode.status >= 400 || (empStaffCode.body ?? []).length === 0,
    `${empStaffCode.status} ${JSON.stringify(empStaffCode.body)?.slice(0, 120)}`,
  );

  const staffCodeRes = await support1.rpc("create_telegram_link_code", { p_bot: "staff" });
  const staffCode = staffCodeRes.body?.[0]?.code;
  if (staffCode) mintedCodes.push(staffCode);
  check(
    "IT support can request a staff-bot link code",
    typeof staffCode === "string" && staffCode.length === 6,
    JSON.stringify(staffCodeRes.body)?.slice(0, 120),
  );

  if (staffCode) {
    // A code minted for one bot must be inert on the other.
    const onEmployeeBot = await support1.rpc("redeem_telegram_code", {
      p_code: staffCode,
      p_bot: "employee",
      p_chat_id: staffChatId,
    });
    check(
      "a staff-bot code does not work on the employee bot",
      (onEmployeeBot.body ?? []).length === 0,
      JSON.stringify(onEmployeeBot.body)?.slice(0, 160),
    );

    const staffRedeem = await support1.rpc("redeem_telegram_code", {
      p_code: staffCode,
      p_bot: "staff",
      p_chat_id: staffChatId,
    });
    check(
      "IT support can link the staff bot",
      staffRedeem.body?.[0]?.user_id === support1.userId,
      JSON.stringify(staffRedeem.body)?.slice(0, 160),
    );

    const staffLookup = await support1.rpc("profile_for_telegram_chat", {
      p_bot: "staff",
      p_chat_id: staffChatId,
    });
    check(
      "the staff chat resolves to the staff profile",
      staffLookup.body?.[0]?.email === support1.email,
      JSON.stringify(staffLookup.body)?.slice(0, 160),
    );

    await support1.rpc("unlink_telegram", { p_bot: "staff", p_chat_id: staffChatId });
    const staffGone = await support1.rpc("profile_for_telegram_chat", {
      p_bot: "staff",
      p_chat_id: staffChatId,
    });
    check("unlinking the staff bot clears the chat", (staffGone.body ?? []).length === 0);
  }

  // Leave no link codes behind. `telegram_link_codes` has no delete policy on
  // purpose — nothing in the app should ever remove one — so the cleanup goes
  // through a direct connection instead of widening RLS for a test.
  if (mintedCodes.length) {
    const { default: pg } = await import("pg");
    const sweep = new pg.Client({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await sweep.connect();
    await sweep.query("delete from public.telegram_link_codes where code = any($1::text[])", [
      mintedCodes,
    ]);
    await sweep.end();
  }

  const anonKey = await anon.rpc("create_api_key", { p_name: "anonymous" });
  check(
    "an unauthenticated caller cannot mint a key",
    anonKey.status >= 400 || (anonKey.body ?? []).length === 0,
    `status ${anonKey.status}`,
  );

  const anonCode = await anon.rpc("create_telegram_link_code", { p_bot: "employee" });
  check(
    "an unauthenticated caller cannot mint a Telegram link code",
    anonCode.status >= 400 || (anonCode.body ?? []).length === 0,
    `status ${anonCode.status}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\nAdmin surface");
  const catCreate = await admin.insert("categories", {
    name: `Verify ${Date.now()}`,
    description: "Created by scripts/verify.mjs",
    is_active: true,
  });
  check("admin can create a category", catCreate.status === 201);
  if (catCreate.body?.[0]?.id) {
    await admin.remove("categories", `id=eq.${catCreate.body[0].id}`);
  }

  const empCatCreate = await employee1.insert("categories", {
    name: `Nope ${Date.now()}`,
    is_active: true,
  });
  check("employee cannot create a category", empCatCreate.status >= 400);

  const stats = await support1.rpc("ticket_stats");
  check(
    "ticket_stats() returns aggregates",
    stats.status === 200 && typeof stats.body?.total === "number",
    JSON.stringify(stats.body)?.slice(0, 120),
  );

  const empStats = await employee1.rpc("ticket_stats");
  check(
    "employee stats are scoped to their own tickets",
    empStats.status === 200 &&
      empStats.body.total <= (stats.body?.total ?? 0),
    `employee ${empStats.body?.total} / staff ${stats.body?.total}`,
  );

  // ---------------------------------------------------------------------------
  // The Telegram bot and the REST API write tickets through lib/db/pool.ts,
  // which opens a transaction, impersonates the user, and then reads the row
  // back on the *same* connection. PostgREST cannot exercise that path (one
  // statement per request), so it gets its own check here.
  //
  // This guards a real bug: folding the INSERT and the read-back SELECT into a
  // single data-modifying CTE looks correct but returns zero rows, because the
  // sub-statements of a WITH share the snapshot taken when the statement began
  // and therefore cannot see the row the CTE just inserted. The bot reported
  // "Gagal membuat tiket" while the ticket had in fact been committed.
  console.log("\nRead-your-own-write inside a transaction");
  const { default: pg } = await import("pg");
  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    check("SUPABASE_DB_URL is configured", false, "skipping the pool checks");
  } else {
    const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: employee1.userId, role: "authenticated" }),
      ]);

      const inserted = await client.query(
        `insert into public.tickets (title, description, priority, created_by)
         values ($1, $2, $3, $4) returning id`,
        ["Verify read-your-own-write", "Created and read back inside one transaction.", "LOW", employee1.userId],
      );
      const readBack = await client.query(
        `select t.ticket_number, t.title,
                (select p.full_name from public.profiles p where p.id = t.created_by) as requester
           from public.tickets t where t.id = $1`,
        [inserted.rows[0].id],
      );
      check(
        "a ticket inserted in a transaction is readable back in the same transaction",
        readBack.rowCount === 1 && readBack.rows[0].requester === "Budi Santoso",
        `rows ${readBack.rowCount}`,
      );

      // The same trap catches anyone who opens a second connection from inside
      // asUser: the uncommitted row is invisible to it.
      const other = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      await other.connect();
      const invisible = await other.query("select count(*)::int n from public.tickets where id = $1", [
        inserted.rows[0].id,
      ]);
      await other.end();
      check(
        "an uncommitted ticket stays invisible to other connections",
        invisible.rows[0].n === 0,
        `saw ${invisible.rows[0].n}`,
      );
    } finally {
      await client.query("rollback");
      await client.end();
    }

    const leaked = await employee1.rest(
      "tickets",
      "select=ticket_number&title=eq.Verify%20read-your-own-write",
    );
    check("the rolled-back ticket left nothing behind", (leaked.body ?? []).length === 0);

    // -------------------------------------------------------------------------
    // Which bot carries a notification is decided when the notification is
    // created (`notifications.audience`), not guessed at delivery time. A staff
    // member is both a requester and bench, so "who is this person" cannot answer
    // it — only "what is this notification about" can.
    console.log("\nNotification audience routing");
    const router = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await router.connect();
    const empChat = 991100001;
    const staffChat = 991100002;
    const created = [];
    try {
      await router.query(
        `insert into public.telegram_links (profile_id, bot, chat_id)
         values ($1, 'employee', $2), ($3, 'staff', $4)
         on conflict do nothing`,
        [employee1.userId, empChat, support1.userId, staffChat],
      );

      const channelsFor = async (userId, audience) => {
        const { rows } = await router.query(
          `insert into public.notifications (user_id, title, message, audience)
           values ($1, 'Verify audience routing', 'scripts/verify.mjs', $2)
           returning id`,
          [userId, audience],
        );
        created.push(rows[0].id);
        const { rows: queued } = await router.query(
          `select channel, status from public.notification_deliveries
            where notification_id = $1 order by channel`,
          [rows[0].id],
        );
        return queued.map((row) => `${row.channel}/${row.status}`).join(" ");
      };

      const empOwn = await channelsFor(employee1.userId, "requester");
      check(
        "an employee's own notification goes to the employee bot",
        empOwn === "telegram/PENDING web/SENT",
        empOwn,
      );

      const empBench = await channelsFor(employee1.userId, "staff");
      check(
        "a bench notification does not use an employee's employee-bot link",
        empBench === "web/SENT",
        empBench,
      );

      const staffBench = await channelsFor(support1.userId, "staff");
      check(
        "a bench notification goes to the staff bot",
        staffBench === "telegram_staff/PENDING web/SENT",
        staffBench,
      );

      const staffOwn = await channelsFor(support1.userId, "requester");
      check(
        "a requester notification does not use a staff member's staff-bot link",
        staffOwn === "web/SENT",
        staffOwn,
      );
    } finally {
      if (created.length) {
        await router.query("delete from public.notifications where id = any($1::uuid[])", [created]);
      }
      await router.query("delete from public.telegram_links where chat_id = any($1::bigint[])", [
        [empChat, staffChat],
      ]);
      await router.end();
    }
  }

  // ---------------------------------------------------------------------------
  // The widget files a visitor's conversation as an ordinary ticket, written by
  // the channel's machine profile. Everything below is about the parts of that
  // arrangement that can go quietly wrong: an orphan profile, a source that
  // disagrees with its channel, a machine account that collects notifications,
  // and the one policy that lets a machine profile write anything at all.
  console.log("\nWidget channels");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const widget = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await widget.connect();

  const suffix = Date.now().toString(36);
  let systemUserId = null;
  let channelId = null;

  try {
    // A channel owns one machine profile and a profile needs an auth user:
    // profiles.id is a real foreign key into auth.users, which is why channel
    // creation goes through the admin API and why the password is never shown.
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `verify-widget-${suffix}@widget.local`,
        password: `verify-${suffix}-${suffix}`,
        email_confirm: true,
        user_metadata: { full_name: `Verify widget ${suffix}`, role: "employee" },
      }),
    });
    const authUser = await created.json();
    check(
      "a channel's machine profile can be created",
      created.ok && !!authUser.id,
      `status ${created.status}`,
    );
    systemUserId = authUser.id;

    await widget.query(
      `update public.profiles set is_system = true, is_active = true, role = 'employee' where id = $1`,
      [systemUserId],
    );

    const { rows: channelRows } = await widget.query(
      `insert into public.channels
         (name, slug, public_key, allowed_origins, default_priority, system_profile_id)
       values ($1, $2, $3, $4, 'MEDIUM', $5)
       returning id`,
      [
        `Verify widget ${suffix}`,
        `verify-widget-${suffix}`,
        `wk_verify_${suffix}`,
        ["https://example.com"],
        systemUserId,
      ],
    );
    channelId = channelRows[0].id;
    check("a channel can be created", !!channelId);

    const rejects = async (sql, params) =>
      widget.query(sql, params).then(
        () => null,
        (error) => error,
      );

    // `source` and `channel_id` are redundant for widget tickets, so the CHECK
    // constraint is what stops the redundancy from drifting.
    const noChannel = await rejects(
      `insert into public.tickets (title, description, created_by, source)
       values ('x', 'x', $1, 'widget')`,
      [systemUserId],
    );
    check("a widget ticket without a channel is rejected", noChannel?.code === "23514", noChannel?.code);

    const strayChannel = await rejects(
      `insert into public.tickets (title, description, created_by, source, channel_id)
       values ('x', 'x', $1, 'web', $2)`,
      [systemUserId, channelId],
    );
    check("a channel id on a web ticket is rejected", strayChannel?.code === "23514", strayChannel?.code);

    const badSource = await rejects(
      `insert into public.tickets (title, description, created_by, source)
       values ('x', 'x', $1, 'carrier-pigeon')`,
      [systemUserId],
    );
    check("an unknown ticket source is rejected", badSource?.code === "23514", badSource?.code);

    const { rows: ticketRows } = await widget.query(
      `insert into public.tickets
         (title, description, created_by, source, channel_id, priority)
       values ('Verify widget ticket', 'Filed by scripts/verify.mjs', $1, 'widget', $2, 'MEDIUM')
       returning id`,
      [systemUserId, channelId],
    );
    const widgetTicket = ticketRows[0].id;

    await widget.query(
      `insert into public.ticket_contacts (ticket_id, visitor_ref, name, email, visitor_ip)
       values ($1, 'v-verify', 'Verify Visitor', 'visitor@example.com', '203.0.113.7')`,
      [widgetTicket],
    );

    // Machine profiles cannot sign in, so a notification addressed to one is a
    // row nobody will ever read. `notify()` skips them.
    const toMachine = await widget.query(
      `select count(*)::int n from public.notifications where user_id = $1`,
      [systemUserId],
    );
    check(
      "no notification is ever addressed to a machine profile",
      toMachine.rows[0].n === 0,
      `saw ${toMachine.rows[0].n}`,
    );

    const toBench = await widget.query(
      `select count(*)::int n from public.notifications
        where ticket_id = $1 and audience = 'staff'`,
      [widgetTicket],
    );
    check("a widget ticket still notifies the bench", toBench.rows[0].n > 0, `saw ${toBench.rows[0].n}`);

    // The whole point of `ticket_contacts`: the timeline names the visitor, not
    // the machine account that happens to own the row.
    const visitorActor = await widget.query(`select public.ticket_actor_name($1, $2) as name`, [
      widgetTicket,
      systemUserId,
    ]);
    check(
      "a widget ticket is attributed to the visitor",
      visitorActor.rows[0].name === "Visitor — Verify Visitor",
      visitorActor.rows[0].name,
    );

    const staffActor = await widget.query(`select public.ticket_actor_name($1, $2) as name`, [
      widgetTicket,
      support1.userId,
    ]);
    check(
      "a staff reply is attributed to the staff member",
      staffActor.rows[0].name === "IT Support — Fiqih Ramadhan",
      staffActor.rows[0].name,
    );

    // -------------------------------------------------------------------------
    // The machine profile is an ordinary `employee` as far as RLS is concerned,
    // so it needs one narrow policy to file the contact row. This is the check
    // that catches its absence: without it POST /session fails with 42501 and
    // the widget cannot start a conversation at all.
    const asMachine = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await asMachine.connect();
    try {
      await asMachine.query("begin");
      await asMachine.query("set local role authenticated");
      await asMachine.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: systemUserId, role: "authenticated" }),
      ]);

      const { rows: ownRows } = await asMachine.query(
        `insert into public.tickets (title, description, created_by, source, channel_id)
         values ('Verify widget ticket 2', 'x', $1, 'widget', $2) returning id`,
        [systemUserId, channelId],
      );
      const filed = await asMachine.query(
        `insert into public.ticket_contacts (ticket_id, visitor_ref, name, email)
         values ($1, 'v-verify-2', 'Second Visitor', 'second@example.com') returning ticket_id`,
        [ownRows[0].id],
      );
      check(
        "a machine profile can file the contact row for its own ticket",
        filed.rowCount === 1,
        `rows ${filed.rowCount}`,
      );
    } finally {
      await asMachine.query("rollback");
      await asMachine.end();
    }

    // ...and nothing wider than that. An employee who cannot even see the ticket
    // must not be able to staple a stranger's name onto it.
    const forged = await employee1.insert("ticket_contacts", {
      ticket_id: widgetTicket,
      visitor_ref: "v-forged",
      name: "Forged",
      email: "forged@example.com",
    });
    check(
      "an employee cannot attach a contact row to someone else's ticket",
      forged.status >= 400,
      `status ${forged.status}`,
    );

    // -------------------------------------------------------------------------
    // Read access. `widget_sessions` is the authorisation binding for a live
    // conversation, so it has RLS on and no policies: the API reads it as the
    // service role and nobody else can read it at all.
    const staffSees = await support1.rest(
      "ticket_contacts",
      `select=name&ticket_id=eq.${widgetTicket}`,
    );
    check(
      "staff can read a visitor's contact details",
      staffSees.body?.[0]?.name === "Verify Visitor",
      JSON.stringify(staffSees.body)?.slice(0, 80),
    );

    const outsider = await employee2.rest(
      "ticket_contacts",
      `select=name&ticket_id=eq.${widgetTicket}`,
    );
    check(
      "an uninvolved employee cannot read a visitor's contact details",
      (outsider.body ?? []).length === 0,
      JSON.stringify(outsider.body)?.slice(0, 80),
    );

    const staffSessions = await support1.rest("widget_sessions", "select=id&limit=1");
    check(
      "widget sessions are unreadable even for staff",
      staffSessions.status >= 400 || (staffSessions.body ?? []).length === 0,
      `status ${staffSessions.status}`,
    );

    const anonSessions = await anon.rest("widget_sessions", "select=id&limit=1");
    check(
      "widget sessions are unreadable for anon",
      anonSessions.status >= 400 || (anonSessions.body ?? []).length === 0,
      `status ${anonSessions.status}`,
    );

    const empChannels = await employee1.rest("channels", "select=name&limit=1");
    check(
      "an employee cannot list channels",
      (empChannels.body ?? []).length === 0,
      `status ${empChannels.status}`,
    );

    const staffChannels = await support1.rest("channels", "select=name&limit=1");
    check(
      "staff can list channels",
      (staffChannels.body ?? []).length > 0,
      `status ${staffChannels.status}`,
    );

    // A channel is switched off, never deleted, once it has history: erasing it
    // would leave conversations attributed to nobody.
    const blocked = await widget
      .query(`delete from public.channels where id = $1`, [channelId])
      .then(
        () => null,
        (error) => error,
      );
    check("a channel with tickets cannot be deleted", blocked?.code === "23503", blocked?.code);
  } finally {
    // Tickets first: they are what holds the channel and the profile in place.
    if (systemUserId) await widget.query(`delete from public.tickets where created_by = $1`, [systemUserId]);
    if (channelId) await widget.query(`delete from public.channels where id = $1`, [channelId]);
    if (systemUserId) {
      await widget.query(`delete from public.profiles where id = $1`, [systemUserId]);
      await fetch(`${url}/auth/v1/admin/users/${systemUserId}`, {
        method: "DELETE",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
    }
    await widget.end();
  }

  // ---------------------------------------------------------------------------
  console.log("\nTelegram web sign-in");

  // The handshake is two halves that have to stay in step: the bot binds a code
  // to the profile behind the chat, the browser spends it with the cookie it was
  // issued. Both are SECURITY DEFINER functions on a service-role-only table, so
  // they are exercised through a direct connection rather than through RLS.
  const login = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await login.connect();

  try {
    const EMPLOYEE = "44444444-4444-4444-8444-444444444444";
    const OTHER = "55555555-5555-4555-8555-555555555555";
    const CODE = "VERIFY01";
    const TOKEN = "verify-browser-token";

    await login.query(
      `insert into public.web_login_codes (code, browser_token, expires_at)
       values ($1, $2, now() + interval '10 minutes')`,
      [CODE, TOKEN],
    );

    const claim = (code, uid) =>
      login
        .query(`select public.redeem_web_login_code($1, $2) as ok`, [code, uid])
        .then((result) => result.rows[0].ok);

    const spend = (code, token) =>
      login
        .query(`select public.consume_web_login_code($1, $2) as profile_id`, [code, token])
        .then((result) => result.rows[0].profile_id);

    check("an unknown sign-in code is refused", (await claim("NOPE1234", EMPLOYEE)) === false);
    check("a null profile cannot claim a code", (await claim(CODE, null)) === false);
    check("a linked chat can claim a sign-in code", (await claim(CODE, EMPLOYEE)) === true);

    // First claim wins, so a second chat cannot point a live code at itself.
    check("a second chat cannot re-claim a code", (await claim(CODE, OTHER)) === false);

    check(
      "the wrong browser cookie cannot spend a code",
      (await spend(CODE, "some-other-browser")) === null,
    );
    check(
      "the right browser cookie yields the claiming profile",
      (await spend(CODE, TOKEN)) === EMPLOYEE,
    );
    check("a code is single use", (await spend(CODE, TOKEN)) === null);

    // An expired code is a dead code, claim or spend.
    await login.query(
      `insert into public.web_login_codes (code, browser_token, profile_id, expires_at)
       values ('VERIFY02', 'verify-browser-token', $1, now() - interval '1 minute')`,
      [EMPLOYEE],
    );
        check("an expired code cannot be spent", (await spend("VERIFY02", TOKEN)) === null);
    check("an expired code cannot be claimed", (await claim("VERIFY02", EMPLOYEE)) === false);

    // Nobody signed in may spend a handshake, and nothing at all may read the
    // table: it is service-role only, with no policies and no grants.
    const staffRead = await support1.rest("web_login_codes", "select=code&limit=1");
    check(
      "a signed-in user cannot read pending sign-in codes",
      staffRead.status >= 400,
      `status ${staffRead.status}`,
    );

    const anonRead = await anon.rest("web_login_codes", "select=code&limit=1");
    check(
      "an anonymous caller cannot read pending sign-in codes",
      anonRead.status >= 400,
      `status ${anonRead.status}`,
    );

    const anonClaim = await anon.rpc("redeem_web_login_code", {
      p_code: "VERIFY03",
      p_profile_id: EMPLOYEE,
    });
    check(
      "an anonymous caller cannot claim a sign-in code",
      anonClaim.status >= 400,
      `status ${anonClaim.status}`,
    );

    const staffClaim = await support1.rpc("consume_web_login_code", {
      p_code: CODE,
      p_browser_token: TOKEN,
    });
    check(
      "a signed-in user cannot spend a sign-in code",
      staffClaim.status >= 400,
      `status ${staffClaim.status}`,
    );
  } finally {
    await login.query(`delete from public.web_login_codes where code like 'VERIFY%'`);
    await login.end();
  }

  // ---------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
