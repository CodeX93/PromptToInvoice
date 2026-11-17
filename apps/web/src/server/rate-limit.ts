import "server-only";
import { sql } from "@pti/db";
import { sysDb } from "./db";
import { RateLimitedError } from "./errors";

export interface RateLimitRule {
  /** Max requests per window. */
  limit: number;
  windowSeconds: number;
}

export const RULES = {
  signIn: { limit: 10, windowSeconds: 60 },
  signUp: { limit: 5, windowSeconds: 3600 },
  aiDraft: { limit: 20, windowSeconds: 60 },
  sendEmail: { limit: 60, windowSeconds: 3600 },
  publicInvoice: { limit: 120, windowSeconds: 60 },
  api: { limit: 600, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter in Postgres: one upsert per check, no extra
 * infrastructure. Good for thousands of req/s; swap for Redis if a single
 * key ever becomes hot.
 */
export async function hit(
  key: string,
  rule: RateLimitRule,
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStartSec = nowSec - (nowSec % rule.windowSeconds);
  const rows = await sysDb.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, to_timestamp(${windowStartSec}), 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count
  `);
  const count = rows[0]?.count ?? 1;
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetIn: windowStartSec + rule.windowSeconds - nowSec,
  };
}

export async function enforce(key: string, rule: RateLimitRule): Promise<void> {
  const r = await hit(key, rule);
  if (!r.allowed) throw new RateLimitedError(r.resetIn);
}
