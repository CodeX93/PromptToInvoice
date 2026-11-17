/**
 * Minimal exact fixed-point decimal arithmetic on bigint.
 *
 * We never use binary floating point for money. Values are represented as an
 * integer coefficient and a base-10 scale: 12.345 => { coef: 12345n, scale: 3 }.
 */

export interface Decimal {
  readonly coef: bigint;
  readonly scale: number;
}

export type RoundingMode = "half-up" | "half-even" | "down" | "up";

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d+))?$/;
const POW10: bigint[] = [];
for (let i = 0n, p = 1n; i <= 38n; i++, p *= 10n) POW10.push(p);

export function pow10(n: number): bigint {
  const cached = POW10[n];
  if (cached !== undefined) return cached;
  return 10n ** BigInt(n);
}

export class DecimalParseError extends Error {
  override readonly name = "DecimalParseError";
}

/**
 * Parse a decimal string. Accepts `1234.56`, `-0.5`, `+3`. Thousand separators
 * and exponent notation are rejected on purpose: user locale input is
 * normalised before it reaches the domain layer.
 */
export function parseDecimal(input: string | number, maxScale = 12): Decimal {
  const text = typeof input === "number" ? numberToPlainString(input) : input.trim();
  const m = DECIMAL_RE.exec(text);
  if (!m) throw new DecimalParseError(`Invalid decimal: "${text}"`);
  const [, sign, int] = m;
  let frac = m[3] ?? "";
  // Trailing zeros carry no value ("5.000000" from a numeric(20,6) column == "5").
  if (frac.length > maxScale) frac = frac.replace(/0+$/, "");
  if (frac.length > maxScale) {
    throw new DecimalParseError(`Too many decimal places (max ${maxScale}): "${text}"`);
  }
  const coef = BigInt((int ?? "0") + frac);
  return { coef: sign === "-" ? -coef : coef, scale: frac.length };
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new DecimalParseError(`Non-finite number: ${n}`);
  // toString may produce exponent notation for very small/large numbers.
  const s = n.toString();
  if (!/e/i.test(s)) return s;
  return n.toFixed(12).replace(/\.?0+$/, "");
}

export function isDecimalString(value: string, maxScale = 12): boolean {
  const m = DECIMAL_RE.exec(value.trim());
  return m !== null && (m[3]?.length ?? 0) <= maxScale;
}

/** Divide with explicit rounding. `divisor` must be positive. */
export function divRound(dividend: bigint, divisor: bigint, mode: RoundingMode): bigint {
  if (divisor <= 0n) throw new RangeError("divisor must be positive");
  const negative = dividend < 0n;
  const abs = negative ? -dividend : dividend;
  let q = abs / divisor;
  const r = abs % divisor;
  if (r !== 0n) {
    const twice = r * 2n;
    switch (mode) {
      case "down":
        break;
      case "up":
        q += 1n;
        break;
      case "half-up":
        if (twice >= divisor) q += 1n;
        break;
      case "half-even":
        if (twice > divisor || (twice === divisor && q % 2n === 1n)) q += 1n;
        break;
    }
  }
  return negative ? -q : q;
}

/** Re-express a decimal at a target scale with rounding. */
export function rescale(d: Decimal, scale: number, mode: RoundingMode = "half-up"): bigint {
  if (scale === d.scale) return d.coef;
  if (scale > d.scale) return d.coef * pow10(scale - d.scale);
  return divRound(d.coef, pow10(d.scale - scale), mode);
}

export function formatDecimal(d: Decimal): string {
  if (d.scale === 0) return d.coef.toString();
  const negative = d.coef < 0n;
  const digits = (negative ? -d.coef : d.coef).toString().padStart(d.scale + 1, "0");
  const cut = digits.length - d.scale;
  return `${negative ? "-" : ""}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

/** Strip trailing zeros from the fractional part: 1.5000 -> 1.5, 2.00 -> 2. */
export function normalizeDecimal(d: Decimal): Decimal {
  let { coef, scale } = d;
  while (scale > 0 && coef % 10n === 0n) {
    coef /= 10n;
    scale--;
  }
  return { coef, scale };
}

export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scale = Math.max(a.scale, b.scale);
  const x = rescale(a, scale);
  const y = rescale(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}
