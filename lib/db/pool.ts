import "server-only";

import { Pool, type PoolClient } from "pg";

/**
 * Direct Postgres access, used only by the API gateway.
 *
 * Why not supabase-js: an API key is not a JWT, so PostgREST has no idea who
 * the caller is. Rather than re-implement every authorisation rule in
 * TypeScript (which would inevitably drift from 0003_rls.sql), we open a
 * transaction and impersonate the user at the database level:
 *
 *   set local role authenticated;
 *   set local config request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
 *
 * auth.uid() reads request.jwt.claims, so every existing RLS policy applies
 * verbatim. An API key issued to an employee can no more read another
 * employee's ticket than their browser session can.
 */

declare global {
  // eslint-disable-next-line no-var
  var __itHelpdeskPool: Pool | undefined;
}

function connectionString() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url || url.includes("REPLACE_WITH")) {
    throw new Error(
      "SUPABASE_DB_URL is not configured. The REST API and the Telegram bot both need it.",
    );
  }
  return url;
}

export function getPool() {
  if (!global.__itHelpdeskPool) {
    global.__itHelpdeskPool = new Pool({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Supabase's pooler terminates idle server-side sessions; keep the client
      // from handing out a socket that is already dead.
      allowExitOnIdle: true,
    });
  }
  return global.__itHelpdeskPool;
}

export type Queryable = Pick<PoolClient, "query">;

/**
 * Run `fn` inside a transaction that is authenticated as `userId`.
 *
 * The role and claim settings are `set local`, so they vanish when the
 * transaction ends — a pooled connection handed to the next request can never
 * inherit the previous caller's identity. The transaction commits on success
 * and rolls back on error, which is also what makes multi-statement writes
 * (ticket + its history + its notifications) atomic.
 *
 * Never nest: calling `asUser` from inside an `asUser` callback checks out a
 * second pooled connection, which cannot see the first transaction's
 * uncommitted rows. Pass the `db` you were given to any helper that needs to
 * read back what you just wrote.
 */
export async function asUser<T>(
  userId: string,
  fn: (db: Queryable) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // the connection may already be gone; releasing it is still correct
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Administrative escape hatch: runs with the connection's own privileges, i.e.
 * the same rights as the service role. Only for the bot's own bookkeeping
 * (link codes, session state, delivery bookkeeping) — never for ticket reads
 * that should be subject to RLS.
 */
export async function asSystem<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }
}
