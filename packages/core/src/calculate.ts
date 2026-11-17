import { type CurrencyCode, minorUnitExponent } from "./currency";
import { type RoundingMode, divRound, parseDecimal, pow10 } from "./decimal";
import { type Minor, allocate, toSafeMinor } from "./money";
import { type TaxCategory, isZeroRateCategory } from "./tax";

/** Max precision accepted for user input, matching the DB column scales. */
export const QUANTITY_SCALE = 4;
export const UNIT_PRICE_SCALE = 6;
export const PERCENT_SCALE = 4;

export interface LineInput {
  /** Decimal string, e.g. "1.5". May be negative only on credit notes. */
  quantity: string;
  /** Unit price in major units as a decimal string, e.g. "120.00". */
  unitPrice: string;
  /** Optional line discount percentage, e.g. "10". */
  discountPercent?: string | null;
  taxCategory: TaxCategory;
  /** VAT/sales tax percentage, e.g. "19" or "25.5". */
  taxRate: string;
}

export type DocumentDiscount =
  { type: "percent"; value: string } | { type: "amount"; value: string } | null | undefined;

export interface CalculationInput {
  currency: CurrencyCode;
  lines: readonly LineInput[];
  discount?: DocumentDiscount;
  rounding?: RoundingMode;
}

export interface LineResult {
  /** quantity × unit price before the line discount. */
  gross: Minor;
  lineDiscount: Minor;
  /** Line net amount (EN 16931 BT-131). */
  net: Minor;
}

export interface TaxBreakdownEntry {
  category: TaxCategory;
  rate: string;
  /** Sum of line nets in this group, before document discount. */
  lineNet: Minor;
  /** Share of the document discount allocated to this group. */
  discount: Minor;
  /** Taxable amount (EN 16931 BT-116). */
  taxable: Minor;
  /** Tax amount (EN 16931 BT-117), rounded once per group. */
  tax: Minor;
}

export interface CalculationResult {
  currency: CurrencyCode;
  lines: LineResult[];
  breakdown: TaxBreakdownEntry[];
  /** Σ line nets (BT-106). */
  lineNetTotal: Minor;
  /** Document-level discount (BT-107). */
  discountTotal: Minor;
  /** Total without tax (BT-109). */
  taxExclusive: Minor;
  /** Total tax (BT-110). */
  taxTotal: Minor;
  /** Total with tax (BT-112). */
  taxInclusive: Minor;
}

export class CalculationError extends Error {
  override readonly name = "CalculationError";
  constructor(
    message: string,
    readonly path: (string | number)[] = [],
  ) {
    super(message);
  }
}

const HUNDRED = 100n;

/**
 * Compute invoice totals exactly as EN 16931 prescribes:
 *  1. each line net is rounded to the currency's minor unit;
 *  2. lines are grouped by (tax category, rate);
 *  3. the document discount is allocated across groups without loss;
 *  4. tax is computed once per group on the taxable amount and rounded.
 *
 * Pure, allocation-light and O(n) in the number of lines.
 */
export function calculate(input: CalculationInput): CalculationResult {
  const { currency } = input;
  const mode = input.rounding ?? "half-up";
  const exp = minorUnitExponent(currency);

  const lines: LineResult[] = new Array<LineResult>(input.lines.length);
  const groups = new Map<
    string,
    { category: TaxCategory; rate: string; rateCoef: bigint; rateScale: number; net: bigint }
  >();
  let lineNetTotal = 0n;

  input.lines.forEach((line, i) => {
    const qty = parseOrThrow(line.quantity, QUANTITY_SCALE, ["lines", i, "quantity"]);
    const price = parseOrThrow(line.unitPrice, UNIT_PRICE_SCALE, ["lines", i, "unitPrice"]);
    const disc = line.discountPercent
      ? parseOrThrow(line.discountPercent, PERCENT_SCALE, ["lines", i, "discountPercent"])
      : { coef: 0n, scale: 0 };
    if (disc.coef < 0n || disc.coef > HUNDRED * pow10(disc.scale)) {
      throw new CalculationError("Line discount must be between 0 and 100%", [
        "lines",
        i,
        "discountPercent",
      ]);
    }
    const rate = parseOrThrow(line.taxRate, PERCENT_SCALE, ["lines", i, "taxRate"]);
    if (rate.coef < 0n || rate.coef > HUNDRED * pow10(rate.scale)) {
      throw new CalculationError("Tax rate must be between 0 and 100%", ["lines", i, "taxRate"]);
    }
    if (isZeroRateCategory(line.taxCategory) && rate.coef !== 0n) {
      throw new CalculationError(`Category ${line.taxCategory} requires a 0% rate`, [
        "lines",
        i,
        "taxRate",
      ]);
    }
    if (line.taxCategory === "S" && rate.coef === 0n) {
      throw new CalculationError("Standard-rated lines need a rate above 0%", [
        "lines",
        i,
        "taxRate",
      ]);
    }

    // gross (in minor units) = qty × price, both scaled.
    const productScale = qty.scale + price.scale;
    const grossExact = qty.coef * price.coef; // scale: productScale, unit: major
    const gross = divRound(grossExact * pow10(exp), pow10(productScale), mode);

    // net = qty × price × (100 − d) / 100, rounded once to avoid double rounding.
    const keep = HUNDRED * pow10(disc.scale) - disc.coef; // scale: disc.scale, ×100
    const net = divRound(
      grossExact * keep * pow10(exp),
      pow10(productScale + disc.scale) * HUNDRED,
      mode,
    );

    lines[i] = {
      gross: toSafeMinor(gross),
      lineDiscount: toSafeMinor(gross - net),
      net: toSafeMinor(net),
    };
    lineNetTotal += net;

    const normRate = normalizeRate(rate.coef, rate.scale);
    const key = `${line.taxCategory}|${normRate}`;
    const g = groups.get(key);
    if (g) g.net += net;
    else
      groups.set(key, {
        category: line.taxCategory,
        rate: normRate,
        rateCoef: rate.coef,
        rateScale: rate.scale,
        net,
      });
  });

  const discountTotal = documentDiscount(input.discount, lineNetTotal, exp, mode);
  if (discountTotal < 0n || (lineNetTotal >= 0n && discountTotal > lineNetTotal)) {
    throw new CalculationError("Discount cannot exceed the subtotal", ["discount"]);
  }

  const groupList = [...groups.values()];
  const shares = allocate(
    toSafeMinor(discountTotal),
    groupList.map((g) => Math.abs(toSafeMinor(g.net))),
  );

  let taxTotal = 0n;
  const breakdown: TaxBreakdownEntry[] = groupList.map((g, idx) => {
    const share = BigInt(shares[idx] ?? 0);
    const taxable = g.net - share;
    const tax = divRound(taxable * g.rateCoef, pow10(g.rateScale) * HUNDRED, mode);
    taxTotal += tax;
    return {
      category: g.category,
      rate: g.rate,
      lineNet: toSafeMinor(g.net),
      discount: toSafeMinor(share),
      taxable: toSafeMinor(taxable),
      tax: toSafeMinor(tax),
    };
  });
  breakdown.sort(compareBreakdown);

  const taxExclusive = lineNetTotal - discountTotal;
  return {
    currency,
    lines,
    breakdown,
    lineNetTotal: toSafeMinor(lineNetTotal),
    discountTotal: toSafeMinor(discountTotal),
    taxExclusive: toSafeMinor(taxExclusive),
    taxTotal: toSafeMinor(taxTotal),
    taxInclusive: toSafeMinor(taxExclusive + taxTotal),
  };
}

function documentDiscount(
  discount: DocumentDiscount,
  lineNetTotal: bigint,
  exp: number,
  mode: RoundingMode,
): bigint {
  if (!discount) return 0n;
  if (discount.type === "amount") {
    const d = parseOrThrow(discount.value, exp, ["discount", "value"]);
    return d.coef * pow10(exp - d.scale);
  }
  const p = parseOrThrow(discount.value, PERCENT_SCALE, ["discount", "value"]);
  if (p.coef < 0n || p.coef > HUNDRED * pow10(p.scale)) {
    throw new CalculationError("Discount must be between 0 and 100%", ["discount", "value"]);
  }
  return divRound(lineNetTotal * p.coef, pow10(p.scale) * HUNDRED, mode);
}

function parseOrThrow(value: string, maxScale: number, path: (string | number)[]) {
  try {
    return parseDecimal(value, maxScale);
  } catch (err) {
    throw new CalculationError(err instanceof Error ? err.message : "Invalid number", path);
  }
}

function normalizeRate(coef: bigint, scale: number): string {
  let c = coef;
  let s = scale;
  while (s > 0 && c % 10n === 0n) {
    c /= 10n;
    s--;
  }
  if (s === 0) return c.toString();
  const digits = c.toString().padStart(s + 1, "0");
  return `${digits.slice(0, -s)}.${digits.slice(-s)}`;
}

const CATEGORY_ORDER: Record<TaxCategory, number> = { S: 0, Z: 1, E: 2, AE: 3, K: 4, G: 5, O: 6 };

function compareBreakdown(a: TaxBreakdownEntry, b: TaxBreakdownEntry): number {
  return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || Number(b.rate) - Number(a.rate);
}
