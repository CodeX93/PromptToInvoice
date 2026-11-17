import "server-only";
import { addDays, hasFeature, isPlanId, todayIn } from "@pti/core";
import { schema, sql } from "@pti/db";
import { sysDb } from "../db";
import { orgSettingsSchema } from "./org-settings";

export interface DueReminder {
  orgId: string;
  invoiceId: string;
  offset: number;
}

/**
 * Find invoices that need a reminder today, across all organisations.
 * Each (invoice, offset) is sent at most once (checked again on delivery),
 * and each org's own time zone and schedule decide what "today" means.
 */
export async function findDueReminders(now = new Date()): Promise<DueReminder[]> {
  const orgs = await sysDb
    .select({
      id: schema.organizations.id,
      plan: schema.organizations.plan,
      tz: schema.organizations.timeZone,
      settings: schema.organizations.settings,
    })
    .from(schema.organizations);
  const out: DueReminder[] = [];
  for (const o of orgs) {
    if (!isPlanId(o.plan) || !hasFeature(o.plan, "reminders")) continue;
    const s = orgSettingsSchema.safeParse(o.settings ?? {});
    const cfg = s.success ? s.data.reminders : { enabled: true, offsets: [-3, 3, 10] };
    if (!cfg.enabled || cfg.offsets.length === 0) continue;
    const today = todayIn(o.tz, now);
    // An invoice is due for offset k when due_date = today - k.
    const dueDates = cfg.offsets.map((k) => addDays(today, -k));
    const rows = await sysDb.execute<{ id: string; due_date: string }>(sql`
      select i.id, i.due_date::text as due_date
      from invoices i
      join clients c on c.id = i.client_id
      where i.org_id = ${o.id}
        and i.status = 'open' and i.doc_type = 'invoice'
        and i.due_date in (${sql.join(
          dueDates.map((d) => sql`${d}::date`),
          sql`, `,
        )})
        and cardinality(c.emails) > 0
    `);
    for (const r of rows) {
      const k = cfg.offsets.find((off) => addDays(today, -off) === r.due_date);
      if (k !== undefined) out.push({ orgId: o.id, invoiceId: r.id, offset: k });
    }
  }
  return out;
}
