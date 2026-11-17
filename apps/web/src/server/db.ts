import "server-only";
import { createDb, type Database } from "@pti/db";
import { env } from "./env";

/**
 * Two pools:
 *  - `db`      app role, row-level security enforced. Use with withOrg().
 *  - `sysDb`   system role, bypasses RLS. Only for webhooks, jobs, auth and
 *              public invoice pages, each through a narrow module.
 * Cached on globalThis so dev hot-reload doesn't leak connections.
 */
interface Pools {
  db: Database;
  sysDb: Database;
}

const g = globalThis as typeof globalThis & { __ptiPools?: Pools };

function init(): Pools {
  const prepare = !env.DATABASE_DISABLE_PREPARE;
  return {
    db: createDb({ url: env.DATABASE_URL, max: env.DATABASE_POOL_MAX, prepare, applicationName: "pti-web" }).db,
    sysDb: createDb({ url: env.SYSTEM_DATABASE_URL, max: Math.max(2, Math.floor(env.DATABASE_POOL_MAX / 2)), prepare, applicationName: "pti-web-sys" }).db,
  };
}

const pools = g.__ptiPools ?? init();
if (env.NODE_ENV !== "production") g.__ptiPools = pools;

export const db = pools.db;
export const sysDb = pools.sysDb;
