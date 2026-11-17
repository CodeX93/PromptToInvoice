import { sql } from "drizzle-orm";
import { formatDocumentNumber, resetPeriodKey, type ResetPolicy } from "@pti/core";
import type { Tx } from "./client";

export interface AllocatedNumber {
  number: string;
  sequence: number;
  periodKey: string;
}

/**
 * Atomically allocate the next document number for a series.
 *
 * The upsert takes a row lock on the (series, period) counter that is held
 * until the surrounding transaction commits. Concurrent issuers queue on that
 * lock, so numbers are strictly sequential; if the transaction rolls back,
 * the increment rolls back too and no gap is left behind.
 */
export async function allocateNumber(
  tx: Tx,
  args: { orgId: string; seriesId: string; pattern: string; resetPolicy: ResetPolicy; issueDate: string },
): Promise<AllocatedNumber> {
  const periodKey = resetPeriodKey(args.resetPolicy, args.issueDate);
  const rows = await tx.execute<{ last_value: string | number }>(sql`
    insert into number_counters (series_id, org_id, period_key, last_value)
    values (${args.seriesId}, ${args.orgId}, ${periodKey}, 1)
    on conflict (series_id, period_key)
    do update set last_value = number_counters.last_value + 1
    returning last_value
  `);
  const sequence = Number(rows[0]?.last_value);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Counter allocation failed");
  return { number: formatDocumentNumber(args.pattern, sequence, args.issueDate), sequence, periodKey };
}
