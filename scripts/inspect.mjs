#!/usr/bin/env node
/** Ad-hoc DB inspection helper. node scripts/inspect.mjs "select ..." */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

const root = path.resolve(import.meta.dirname, "..");
for (const line of (await readFile(path.join(root, ".env.local"), "utf8")).split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const sql = process.argv.slice(2).join(" ") || "select 1";
const { rows } = await client.query(sql);
console.log(JSON.stringify(rows, null, 2));
await client.end();
