import "server-only";
import { checkQuota, PLANS, type PlanId } from "@pti/core";
import { sql, type Tx } from "@pti/db";
import { QuotaExceededError } from "../errors";

export type UsageMetric = "invoices_issued" | "ai_drafts" | "emails_sent";

const QUOTA_KEY = { invoices_issued: "invoicesPerMonth", ai_drafts: "aiDraftsPerMonth" } as const;

export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Atomically increment a monthly counter and enforce the plan quota in the
 * same statement: the conditional upsert only applies if the limit is not
 * exceeded, so concurrent requests can't overshoot. Runs inside the caller's
 * transaction so a rolled-back action doesn't consume quota.
 */
export async function consume(
  tx: Tx,
  orgId: string,
  plan: PlanId,
  metric: UsageMetric,
  by = 1,
): Promise<void> {
  const quotaKey = metric === "emails_sent" ? null : QUOTA_KEY[metric];
  const limit = quotaKey ? PLANS[plan].limits[quotaKey] : null;
  const col = sql.identifier(metric);
  const rows = await tx.execute<{ used: number }>(sql`
    insert into usage_counters (org_id, period, ${col}) values (${orgId}, ${currentPeriod()}, ${by})
    on conflict (org_id, period) do update set ${col} = usage_counters.${col} + ${by}
    ${limit === null ? sql`` : sql`where usage_counters.${col} + ${by} <= ${limit}`}
    returning ${col} as used
  `);
  if (rows.length === 0 && quotaKey) {
    const q = checkQuota(plan, quotaKey, limit ?? 0);
    throw new QuotaExceededError(
      metric === "invoices_issued"
        ? `You've issued all ${q.limit ?? 0} invoices included this month. Upgrade to keep invoicing.`
        : `You've used all ${q.limit ?? 0} AI drafts included this month.`,
      { metric, limit: q.limit },
    );
  }
}

export async function usageFor(
  tx: Tx,
  orgId: string,
): Promise<{ invoicesIssued: number; aiDrafts: number; emailsSent: number }> {
  const [r] = await tx.execute<{ invoices_issued: number; ai_drafts: number; emails_sent: number }>(
    sql`select invoices_issued, ai_drafts, emails_sent from usage_counters where org_id = ${orgId} and period = ${currentPeriod()}`,
  );
  return {
    invoicesIssued: r?.invoices_issued ?? 0,
    aiDrafts: r?.ai_drafts ?? 0,
    emailsSent: r?.emails_sent ?? 0,
  };
}
