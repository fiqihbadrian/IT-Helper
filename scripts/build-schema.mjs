#!/usr/bin/env node
/**
 * Concatenates supabase/migrations/*.sql (in filename order) plus seed.sql into
 * a single file that can be pasted into the Supabase SQL editor when a direct
 * Postgres connection is not available.
 *
 *   npm run db:bundle
 *
 * The bundle is a build artifact of the migrations, never the source of truth.
 * Regenerate it after touching any migration so the two cannot drift apart.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const seedFile = path.join(root, "supabase", "seed.sql");
const outFile = path.join(root, "supabase", "all_in_one_schema.sql");

const files = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (!files.length) {
  console.error(`No .sql files found in ${migrationsDir}`);
  process.exit(1);
}

const banner = (label) =>
  [
    "",
    "-- =============================================================================",
    `-- ${label}`,
    "-- =============================================================================",
    "",
  ].join("\n");

const chunks = [
  [
    "-- =============================================================================",
    "-- IT Helpdesk — complete schema",
    "--",
    "-- GENERATED FILE — do not edit by hand.",
    "-- Source: supabase/migrations/*.sql and supabase/seed.sql",
    "-- Rebuild with: npm run db:bundle",
    "--",
    "-- Paste this whole file into the Supabase SQL editor to create the database",
    "-- from scratch. It is idempotent, so re-running it is safe.",
    "-- =============================================================================",
    "",
  ].join("\n"),
];

for (const name of files) {
  const sql = await readFile(path.join(migrationsDir, name), "utf8");
  chunks.push(banner(name), sql.trimEnd(), "\n");
}

chunks.push(banner("seed.sql"), (await readFile(seedFile, "utf8")).trimEnd(), "\n");

await writeFile(outFile, chunks.join("\n"), "utf8");

const lines = chunks.join("\n").split("\n").length;
console.log(`Wrote ${path.relative(root, outFile)} — ${files.length} migrations + seed, ${lines} lines.`);
