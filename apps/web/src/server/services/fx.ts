import "server-only";
import { divRound, formatDecimal, parseDecimal, pow10, normalizeDecimal } from "@pti/core";
import { and, desc, eq, lte, schema, sql } from "@pti/db";
import { sysDb } from "../db";
import { logger } from "../logger";

const ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** Parse the ECB daily reference rates XML (Cube time="…" / Cube currency rate). */
export function parseEcbXml(xml: string): { date: string; rates: Record<string, string> } | null {
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) return null;
  const rates: Record<string, string> = { EUR: "1" };
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    if (m[1] && m[2]) rates[m[1]] = m[2];
  }
  return { date, rates };
}

/** Worker job: fetch and store today's ECB rates (idempotent). */
export async function refreshEcbRates(fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl(ECB_DAILY, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`ECB HTTP ${res.status}`);
  const parsed = parseEcbXml(await res.text());
  if (!parsed) throw new Error("ECB response not understood");
  const rows = Object.entries(parsed.rates).map(([currency, rate]) => ({
    date: parsed.date,
    currency,
    rate,
    source: "ECB",
  }));
  await sysDb.insert(schema.fxRates).values(rows).onConflictDoNothing();
  return rows.length;
}

async function eurRate(
  currency: string,
  onOrBefore: string,
): Promise<{ rate: string; date: string } | null> {
  if (currency === "EUR") return { rate: "1", date: onOrBefore };
  const [r] = await sysDb
    .select()
    .from(schema.fxRates)
    .where(and(eq(schema.fxRates.currency, currency), lte(schema.fxRates.date, onOrBefore)))
    .orderBy(desc(schema.fxRates.date))
    .limit(1);
  return r ? { rate: r.rate, date: r.date } : null;
}

/**
 * Rate to convert 1 unit of `from` into `to`, using the latest ECB fixing on
 * or before `date` (cross rates via EUR). 8 decimal places, as stored.
 */
export async function conversionRate(
  from: string,
  to: string,
  date: string,
): Promise<{ rate: string; date: string } | null> {
  if (from === to) return { rate: "1", date };
  const [a, b] = await Promise.all([eurRate(from, date), eurRate(to, date)]);
  if (!a || !b) return null;
  // 1 from = (1 / a) EUR = (b / a) to
  const A = parseDecimal(a.rate);
  const B = parseDecimal(b.rate);
  const scale = 8;
  const coef = divRound(B.coef * pow10(A.scale + scale), A.coef * pow10(B.scale), "half-even");
  return {
    rate: formatDecimal(normalizeDecimal({ coef, scale })),
    date: a.date < b.date ? a.date : b.date,
  };
}

/** Is any rate stored at all? (Used to surface a setup hint instead of silently skipping.) */
export async function hasRates(): Promise<boolean> {
  const [r] = await sysDb.execute<{ n: number }>(sql`select count(*)::int as n from fx_rates`);
  return (r?.n ?? 0) > 0;
}

export function logFxGap(invoiceId: string, from: string, to: string): void {
  logger.warn({ invoiceId, from, to }, "no FX rate available; national-currency VAT not stated");
}
