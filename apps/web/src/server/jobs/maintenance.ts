import "server-only";
import { sql } from "@pti/db";
import { sysDb } from "../db";

/** Daily housekeeping: bounded tables stay bounded, and retention promises are kept. */
export async function purge(): Promise<Record<string, number>> {
  const run = async (q: ReturnType<typeof sql>) => (await sysDb.execute(q)).count;
  return {
    rateLimits: await run(
      sql`delete from rate_limits where window_start < now() - interval '1 day'`,
    ),
    webhooks: await run(
      sql`delete from processed_webhooks where processed_at < now() - interval '60 days'`,
    ),
    idempotency: await run(
      sql`delete from idempotency_keys where created_at < now() - interval '1 day'`,
    ),
    // Prompt text is kept 90 days for quality review, then reduced to a fingerprint.
    aiPrompts: await run(sql`
      update ai_drafts set prompt = 'sha256:' || encode(sha256(convert_to(prompt, 'UTF8')), 'hex')
      where created_at < now() - interval '90 days' and prompt not like 'sha256:%'
    `),
    sessions: await run(sql`delete from sessions where expires_at < now() - interval '7 days'`),
    verifications: await run(
      sql`delete from verifications where expires_at < now() - interval '1 day'`,
    ),
  };
}
