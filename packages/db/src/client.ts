import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;
/** A transaction handle; same query API as Database. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

export interface CreateDbOptions {
  url: string;
  /** Pool size per process. Keep small on serverless; PgBouncer does the rest. */
  max?: number;
  /** Disable prepared statements when running behind a transaction-mode pooler. */
  prepare?: boolean;
  applicationName?: string;
}

export function createDb(opts: CreateDbOptions): { db: Database; client: postgres.Sql } {
  const client = postgres(opts.url, {
    max: opts.max ?? 10,
    prepare: opts.prepare ?? true,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
    connection: { application_name: opts.applicationName ?? "prompttoinvoice" },
    // Money columns use bigint(mode:number); keep numeric as string for exact decimals.
    types: {},
    onnotice: () => undefined,
  });
  return { db: drizzle(client, { schema, casing: "snake_case" }), client };
}

/**
 * Run `fn` in a transaction scoped to one organisation. `SET LOCAL` (via
 * set_config(..., true)) confines the setting to this transaction, which is
 * safe with connection pooling; RLS policies read it through app_current_org().
 */
export async function withOrg<T>(
  db: Database,
  orgId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/** Postgres error codes we map to domain errors. */
export const PG = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  serializationFailure: "40001",
  deadlockDetected: "40P01",
  raiseException: "P0001",
} as const;

export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  // Drizzle wraps driver errors in `cause`.
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e === "object" && "code" in e && typeof e.code === "string") return e.code;
    e = typeof e === "object" && "cause" in e ? e.cause : undefined;
  }
  return undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e === "object" && "constraint_name" in e && typeof e.constraint_name === "string") {
      return e.constraint_name;
    }
    e = typeof e === "object" && "cause" in e ? e.cause : undefined;
  }
  return undefined;
}

/** Retry a transaction on serialization failures / deadlocks with jittered backoff. */
export async function retryTx<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = pgErrorCode(err);
      if (i >= attempts || (code !== PG.serializationFailure && code !== PG.deadlockDetected))
        throw err;
      await new Promise((r) => setTimeout(r, 10 * 2 ** i + Math.random() * 10));
    }
  }
}

export class NotFoundError extends Error {
  override readonly name = "NotFoundError";
}

/** First row of a result, or throw. Pairs with `.returning()` and single-row lookups. */
export function one<T>(rows: readonly T[], what = "row"): T {
  const row = rows[0];
  if (row === undefined) throw new NotFoundError(`${what} not found`);
  return row;
}
