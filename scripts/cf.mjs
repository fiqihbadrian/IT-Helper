#!/usr/bin/env node
/**
 * Wrapper around the OpenNext CLI.
 *
 * `opennextjs-cloudflare deploy|preview` first spins up a local miniflare
 * instance to read the Worker's bindings from `process.env`. That step needs a
 * real connection string for Hyperdrive, and the only place Wrangler will take
 * one from is `localConnectionString` in wrangler.jsonc or the
 * CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING> variable.
 *
 * The first option would commit the database password to git, so we use the
 * second: read SUPABASE_DB_URL out of .env.local and hand it over in-process.
 * Nothing is written to disk and the deploy itself still uses the Hyperdrive
 * binding, not this string.
 *
 * Usage: node scripts/cf.mjs deploy|preview|build [extra args...]
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function loadEnvLocal() {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return {};

  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^["']|["']$/g, "")]),
  );
}

const [command = "deploy", ...rest] = process.argv.slice(2);
const env = { ...process.env, ...loadEnvLocal() };

if (!env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE && env.SUPABASE_DB_URL) {
  env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = env.SUPABASE_DB_URL;
}

if (!env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE && command !== "build") {
  console.error(
    "Missing SUPABASE_DB_URL in .env.local — `" +
      command +
      "` needs it to emulate the Hyperdrive binding locally.",
  );
  process.exit(1);
}

const child = spawn(
  "opennextjs-cloudflare",
  [command, ...rest],
  { cwd: root, env, stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
