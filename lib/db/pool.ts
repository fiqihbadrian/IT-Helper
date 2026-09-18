import "server-only";

import { Client, Pool, type PoolClient } from "pg";

/**
 * Direct Postgres access, used by the REST API gateway and the Telegram bot.
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
 *
 * Two runtimes, one API:
 *
 *   Node (`next dev` / `next start`) — a module-level `pg.Pool`, so warm
 *   connections survive between requests.
 *
 *   Cloudflare Workers — one `pg.Client` per call, pointed at Hyperdrive.
 *   Workers forbid I/O across request contexts, so a global pool would hand out
 *   sockets that belong to a request that has already finished. Hyperdrive
 *   keeps the real pool on its side, which is what makes a per-call client
 *   cheap.
 *
 * Hyperdrive's query cache is deliberately switched off (`--caching-disabled`).
 * Its cache key is the SQL text plus parameters and nothing else — it does not
 * know about `set local role` or `request.jwt.claims`. Two different users
 * running the same statement would therefore share a cache entry, and since
 * every authorisation rule here lives in that session state, the result would
 * be one user reading another user's rows. Hyperdrive's own docs say as much:
 * keep a cache-disabled config for "authentication, sessions, permissions".
 */

/**
 * OpenNext parks its `{ env, cf, ctx }` context on this well-known symbol in
 * both production and, via `initOpenNextCloudflareForDev`, under `next dev`.
 *
 * Reading the symbol directly rather than importing `@opennextjs/cloudflare`
 * keeps the adapter out of the Node build entirely — it is a devDependency, and
 * it drags in `wrangler` when imported.
 */
const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

interface CloudflareContextLike {
  env?: { HYPERDRIVE?: { connectionString?: string } };
}

function hyperdriveConnectionString(): string | null {
  const context = (globalThis as unknown as Record<symbol, unknown>)[
    CLOUDFLARE_CONTEXT
  ] as CloudflareContextLike | undefined;

  return context?.env?.HYPERDRIVE?.connectionString ?? null;
}

function nodeConnectionString(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url || url.includes("REPLACE_WITH")) {
    throw new Error(
      "No database connection available. On Workers, bind Hyperdrive as HYPERDRIVE; " +
        "otherwise set SUPABASE_DB_URL. The REST API and the Telegram bot both need one.",
    );
  }
  return url;
}

/* -------------------------------------------------------------------------- */
/* Node: one shared pool                                                       */
/* -------------------------------------------------------------------------- */

declare global {
  // eslint-disable-next-line no-var
  var __itHelpdeskPool: Pool | undefined;
}

function nodePool() {
  if (!global.__itHelpdeskPool) {
    global.__itHelpdeskPool = new Pool({
      connectionString: nodeConnectionString(),
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

/* -------------------------------------------------------------------------- */
/* Connection acquisition                                                      */
/* -------------------------------------------------------------------------- */

export type Queryable = Pick<PoolClient, "query">;

/**
 * Which backend the next query would use, for the admin settings page. Reports
 * the host only — never the user, password or database name.
 */
export function describeDatabaseRoute(): {
  kind: "hyperdrive" | "direct";
  host: string;
} {
  const hyperdrive = hyperdriveConnectionString();
  const url = hyperdrive ?? process.env.SUPABASE_DB_URL;

  let host = "not configured";
  if (url) {
    try {
      host = new URL(url).hostname;
    } catch {
      host = "unparseable connection string";
    }
  }

  return { kind: hyperdrive ? "hyperdrive" : "direct", host };
}

/** True when running inside the Cloudflare Workers runtime rather than Node. */
export function isCloudflareRuntime(): boolean {
  return (globalThis as unknown as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT] !== undefined;
}

interface Handle {
  query: PoolClient["query"];
  release: () => Promise<void>;
}

/**
 * Workers cap a single invocation at 6 concurrent outbound connections. We stay
 * under it and fail loudly rather than mysteriously: blowing the cap surfaces
 * as an opaque runtime error, and the usual cause — a nested `asUser` call — is
 * much easier to debug from this message.
 */
const MAX_CONCURRENT = 5;
let inFlight = 0;

async function acquire(): Promise<Handle> {
  const hyperdrive = hyperdriveConnectionString();

  if (hyperdrive) {
    if (inFlight >= MAX_CONCURRENT) {
      throw new Error(
        `Refusing to open more than ${MAX_CONCURRENT} database connections at once. ` +
          "Did something call asUser() from inside asUser()? Pass the `db` you were " +
          "given to any helper that needs to read back what you just wrote.",
      );
    }

    inFlight += 1;
    const client = new Client({ connectionString: hyperdrive });
    try {
      await client.connect();
    } catch (error) {
      inFlight -= 1;
      throw error;
    }

    return {
      query: client.query.bind(client) as PoolClient["query"],
      release: async () => {
        try {
          await client.end();
        } finally {
          inFlight -= 1;
        }
      },
    };
  }

  const client = await nodePool().connect();
  return {
    query: client.query.bind(client) as PoolClient["query"],
    release: async () => {
      client.release();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Run `fn` inside a transaction that is authenticated as `userId`.
 *
 * The role and claim settings are `set local`, so they vanish when the
 * transaction ends — a connection handed to the next request can never inherit
 * the previous caller's identity. The transaction commits on success and rolls
 * back on error, which is also what makes multi-statement writes (ticket + its
 * history + its notifications) atomic.
 *
 * Never nest: calling `asUser` from inside an `asUser` callback opens a
 * *second* connection, which cannot see the first transaction's uncommitted
 * rows. Pass the `db` you were given to any helper that needs to read back what
 * you just wrote.
 *
 * Holding a transaction open costs Hyperdrive a pooled connection, so keep the
 * body short and never make an external HTTP call inside it.
 */
export async function asUser<T>(
  userId: string,
  fn: (db: Queryable) => Promise<T>,
): Promise<T> {
  const db = await acquire();
  try {
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    try {
      await db.query("rollback");
    } catch {
      // the connection may already be gone; releasing it is still correct
    }
    throw error;
  } finally {
    await db.release();
  }
}

/**
 * Administrative escape hatch: runs with the connection's own privileges, i.e.
 * the same rights as the service role. Only for the bot's own bookkeeping
 * (link codes, session state, delivery bookkeeping) — never for ticket reads
 * that should be subject to RLS.
 */
export async function asSystem<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  const db = await acquire();
  try {
    await db.query("begin");
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    try {
      await db.query("rollback");
    } catch {
      // ignore
    }
    throw error;
  } finally {
    await db.release();
  }
}
