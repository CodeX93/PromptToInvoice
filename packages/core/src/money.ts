import { type CurrencyCode, minorUnitExponent } from "./currency";
import { type Decimal, type RoundingMode, formatDecimal, parseDecimal, rescale } from "./decimal";

/**
 * Money amounts are integers in the currency's minor unit (cents for USD/EUR).
 * We use `number` at rest because every realistic invoice amount is far below
 * Number.MAX_SAFE_INTEGER (≈ 90 trillion USD), which keeps JSON, Postgres
 * bigint (mode: number) and React rendering cheap. All intermediate products
 * are computed in bigint and checked back into the safe range.
 */
export type Minor = number;

export class MoneyOverflowError extends RangeError {
  override readonly name = "MoneyOverflowError";
}

export function toSafeMinor(value: bigint): Minor {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyOverflowError(`Amount out of range: ${value}`);
  }
  return Number(value);
}

/** Convert a major-unit decimal ("12.34") to minor units for a currency. */
export function toMinor(
  amount: string | number | Decimal,
  currency: CurrencyCode,
  mode: RoundingMode = "half-up",
): Minor {
  const d = typeof amount === "object" ? amount : parseDecimal(amount);
  return toSafeMinor(rescale(d, minorUnitExponent(currency), mode));
}

/** Minor units -> canonical decimal string ("1234.50"). Never localised. */
export function fromMinor(minor: Minor, currency: CurrencyCode): string {
  return formatDecimal({ coef: BigInt(minor), scale: minorUnitExponent(currency) });
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: CurrencyCode, display: "symbol" | "code") {
  const key = `${locale}|${currency}|${display}`;
  let f = formatterCache.get(key);
  if (!f) {
    const digits = minorUnitExponent(currency);
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: display === "symbol" ? "narrowSymbol" : "code",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * Locale-aware display. Formatting goes through a decimal string rather than
 * minor / 100 to avoid float artefacts on large values.
 */
export function formatMoney(
  minor: Minor,
  currency: CurrencyCode,
  locale = "en-US",
  display: "symbol" | "code" = "symbol",
): string {
  const text = fromMinor(minor, currency);
  // Intl.NumberFormat accepts numeric strings exactly (ES2023 "string decimal").
  return formatter(locale, currency, display).format(text as unknown as number);
}

export function sumMinor(values: Iterable<Minor>): Minor {
  let total = 0n;
  for (const v of values) total += BigInt(v);
  return toSafeMinor(total);
}

/**
 * Split an amount into parts proportional to `weights` with no rounding loss
 * (largest-remainder method). Used for proportional document-level discounts.
 */
export function allocate(total: Minor, weights: readonly Minor[]): Minor[] {
  if (weights.length === 0) return [];
  const sumW = weights.reduce((a, w) => a + BigInt(w), 0n);
  if (sumW === 0n) {
    return weights.map((_, i) => (i === 0 ? total : 0));
  }
  const t = BigInt(total);
  const parts = weights.map((w) => (t * BigInt(w)) / sumW);
  const remainders = weights.map((w, i) => ({ i, r: (t * BigInt(w)) % sumW }));
  let leftover = t - parts.reduce((a, p) => a + p, 0n);
  const step = leftover >= 0n ? 1n : -1n;
  remainders.sort((a, b) => {
    const ra = a.r < 0n ? -a.r : a.r;
    const rb = b.r < 0n ? -b.r : b.r;
    return rb > ra ? 1 : rb < ra ? -1 : a.i - b.i;
  });
  for (let k = 0; leftover !== 0n; k = (k + 1) % parts.length) {
    const idx = remainders[k]?.i ?? 0;
    parts[idx] = (parts[idx] ?? 0n) + step;
    leftover -= step;
  }
  return parts.map(toSafeMinor);
}
