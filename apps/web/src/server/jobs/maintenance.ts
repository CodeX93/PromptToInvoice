import "server-only";
import { sql } from "@pti/db";
import { sysDb } from "../db";
import { deleteBlob } from "../storage";

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

/**
 * Remove documents of deleted organisations once every archived file is
 * past its retention date. Runs with app.retention_purge='on' (transaction
 * local), the only way the immutability triggers allow it.
 */
export async function purgeExpiredRetention(now = new Date()): Promise<number> {
  const orgs = await sysDb.execute<{ id: string }>(sql`
    select o.id from organizations o
    where o.deleted_at is not null
      and not exists (select 1 from files f where f.org_id = o.id and (f.retain_until is null or f.retain_until > ${now.toISOString()}::timestamptz))
  `);
  for (const { id } of orgs) {
    const keys = await sysDb.execute<{ storage_key: string }>(sql`select storage_key from files where org_id = ${id}`);
    await sysDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.retention_purge', 'on', true)`);
      // Children before parents (FK order): documents first, then what they reference.
      for (const t of ["payments", "invoice_events", "invoice_lines", "email_messages", "recurring_schedules", "invoices", "number_counters", "number_series", "tax_rates", "catalog_items", "usage_counters", "files", "audit_log", "clients", "business_profiles", "subscriptions"]) {
        await tx.execute(sql`delete from ${sql.identifier(t)} where org_id = ${id}`);
      }
      await tx.execute(sql`delete from organizations where id = ${id}`);
    });
    for (const k of keys) await deleteBlob(k.storage_key).catch(() => undefined);
  }
  return orgs.length;
}
