#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql then supabase/seed.sql against the project
 * database. Requires SUPABASE_DB_URL in .env.local
 * (Supabase dashboard -> Project Settings -> Database -> Connection string -> URI).
 *
 * Usage:
 *   node scripts/db-push.mjs            # migrations + seed
 *   node scripts/db-push.mjs --schema   # migrations only
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

const root = path.resolve(import.meta.dirname, "..");

async function loadEnv() {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return;

  const content = await readFile(file, "utf8");
  for (const line of content.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  await loadEnv();

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString || connectionString.includes("PASSWORD")) {
    console.error(
      "Missing SUPABASE_DB_URL.\n" +
        "Supabase dashboard -> Project Settings -> Database -> Connection string -> URI\n" +
        "Add it to .env.local as SUPABASE_DB_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres",
    );
    process.exit(1);
  }

  const schemaOnly = process.argv.includes("--schema");
  const migrationsDir = path.join(root, "supabase", "migrations");
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log(`Connected. Applying ${files.length} migration(s)…`);

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    process.stdout.write(`  → ${file} … `);
    try {
      await client.query(sql);
      console.log("ok");
    } catch (error) {
      console.log("FAILED");
      console.error(error.message);
      await client.end();
      process.exit(1);
    }
  }

  if (!schemaOnly) {
    const seedPath = path.join(root, "supabase", "seed.sql");
    if (existsSync(seedPath)) {
      process.stdout.write("  → seed.sql … ");
      try {
        await client.query(await readFile(seedPath, "utf8"));
        console.log("ok");
      } catch (error) {
        console.log("FAILED");
        console.error(error.message);
        await client.end();
        process.exit(1);
      }
    }
  }

  await client.end();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
