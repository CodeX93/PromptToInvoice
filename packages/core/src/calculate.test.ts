import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CalculationError, calculate, type LineInput } from "./calculate";

const line = (over: Partial<LineInput> = {}): LineInput => ({
  quantity: "1",
  unitPrice: "100",
  taxCategory: "S",
  taxRate: "19",
  ...over,
});

describe("calculate", () => {
  it("handles the canonical consulting example", () => {
    const r = calculate({
      currency: "USD",
      lines: [line({ quantity: "10", unitPrice: "120", taxCategory: "O", taxRate: "0" })],
    });
    expect(r.taxExclusive).toBe(120000);
    expect(r.taxTotal).toBe(0);
    expect(r.taxInclusive).toBe(120000);
  });

  it("rounds each line once and taxes per group", () => {
    const r = calculate({
      currency: "EUR",
      lines: [
        line({ quantity: "3", unitPrice: "0.333" }), // 0.999 -> 1.00
        line({ quantity: "1", unitPrice: "0.335" }), // 0.335 -> 0.34
      ],
    });
    expect(r.lines.map((l) => l.net)).toEqual([100, 34]);
    expect(r.breakdown).toHaveLength(1);
    // 1.34 × 19% = 0.2546 -> 0.25 (group-level rounding, not per line)
    expect(r.taxTotal).toBe(25);
    expect(r.taxInclusive).toBe(159);
  });

  it("applies line discounts without double rounding", () => {
    const r = calculate({
      currency: "EUR",
      lines: [line({ quantity: "1", unitPrice: "9.99", discountPercent: "33.33" })],
    });
    // 9.99 × 0.6667 = 6.660333 -> 6.66
    expect(r.lines[0]).toEqual({ gross: 999, lineDiscount: 333, net: 666 });
  });

  it("groups by category and rate and sorts the breakdown", () => {
    const r = calculate({
      currency: "EUR",
      lines: [
        line({ taxRate: "7" }),
        line({ taxCategory: "AE", taxRate: "0" }),
        line({ taxRate: "19.0" }),
        line({ taxRate: "19" }),
      ],
    });
    expect(r.breakdown.map((b) => [b.category, b.rate, b.taxable, b.tax])).toEqual([
      ["S", "19", 20000, 3800],
      ["S", "7", 10000, 700],
      ["AE", "0", 10000, 0],
    ]);
  });

  it("allocates a document discount across tax groups", () => {
    const r = calculate({
      currency: "EUR",
      lines: [line({ unitPrice: "300" }), line({ unitPrice: "100", taxRate: "7" })],
      discount: { type: "percent", value: "10" },
    });
    expect(r.discountTotal).toBe(4000);
    expect(r.breakdown.map((b) => [b.discount, b.taxable, b.tax])).toEqual([
      [3000, 27000, 5130],
      [1000, 9000, 630],
    ]);
    expect(r.taxExclusive).toBe(36000);
    expect(r.taxInclusive).toBe(41760);
  });

  it("supports fixed-amount discounts", () => {
    const r = calculate({
      currency: "USD",
      lines: [line({ taxCategory: "O", taxRate: "0" })],
      discount: { type: "amount", value: "15.50" },
    });
    expect(r.taxExclusive).toBe(8450);
  });

  it("supports zero-decimal currencies", () => {
    const r = calculate({
      currency: "JPY",
      lines: [line({ quantity: "3", unitPrice: "333.4", taxRate: "10" })],
    });
    expect(r.taxExclusive).toBe(1000);
    expect(r.taxTotal).toBe(100);
  });

  it("applies discounts to credit notes with the subtotal's sign", () => {
    const pct = calculate({
      currency: "EUR",
      lines: [line({ quantity: "-2" })],
      discount: { type: "percent", value: "5" },
    });
    expect(pct.discountTotal).toBe(-1000);
    expect(pct.taxExclusive).toBe(-19000);
    const amt = calculate({
      currency: "EUR",
      lines: [line({ quantity: "-2" })],
      discount: { type: "amount", value: "10" },
    });
    expect(amt.taxExclusive).toBe(-19000);
  });

  it("supports negative quantities for credit notes", () => {
    const r = calculate({ currency: "EUR", lines: [line({ quantity: "-2" })] });
    expect(r.taxExclusive).toBe(-20000);
    expect(r.taxTotal).toBe(-3800);
  });

  it.each([
    [{ taxCategory: "AE", taxRate: "19" }, /requires a 0% rate/],
    [{ taxCategory: "S", taxRate: "0" }, /above 0%/],
    [{ taxRate: "101" }, /between 0 and 100/],
    [{ discountPercent: "120" }, /between 0 and 100/],
    [{ quantity: "1.23456" }, /Too many decimal places/],
    [{ unitPrice: "abc" }, /Invalid decimal/],
  ] as const)("rejects invalid line %j", (over, msg) => {
    expect(() => calculate({ currency: "EUR", lines: [line(over as Partial<LineInput>)] })).toThrow(
      msg,
    );
  });

  it("reports the failing field path", () => {
    try {
      calculate({ currency: "EUR", lines: [line(), line({ quantity: "x" })] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CalculationError);
      expect((e as CalculationError).path).toEqual(["lines", 1, "quantity"]);
    }
  });

  it("rejects discounts above the subtotal", () => {
    expect(() =>
      calculate({ currency: "EUR", lines: [line()], discount: { type: "amount", value: "200" } }),
    ).toThrow(/exceed/);
  });

  describe("invariants", () => {
    const arbLine = fc.record({
      quantity: fc.integer({ min: 0, max: 100000 }).map((n) => (n / 100).toFixed(2)),
      unitPrice: fc.integer({ min: 0, max: 10_000_000 }).map((n) => (n / 1000).toFixed(3)),
      discountPercent: fc.option(fc.integer({ min: 0, max: 100 }).map(String), { nil: null }),
      taxCategory: fc.constant("S" as const),
      taxRate: fc.constantFrom("19", "7", "20", "25.5", "5.5"),
    });

    it("totals are internally consistent", () => {
      fc.assert(
        fc.property(
          fc.array(arbLine, { minLength: 1, maxLength: 25 }),
          fc.integer({ min: 0, max: 100 }),
          (lines, pct) => {
            const r = calculate({
              currency: "EUR",
              lines,
              discount: { type: "percent", value: String(pct) },
            });
            const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
            expect(sum(r.lines.map((l) => l.net))).toBe(r.lineNetTotal);
            expect(sum(r.breakdown.map((b) => b.discount))).toBe(r.discountTotal);
            expect(sum(r.breakdown.map((b) => b.taxable))).toBe(r.taxExclusive);
            expect(sum(r.breakdown.map((b) => b.tax))).toBe(r.taxTotal);
            expect(r.taxInclusive).toBe(r.taxExclusive + r.taxTotal);
            expect(r.taxExclusive).toBeGreaterThanOrEqual(0);
            for (const l of r.lines) expect(l.gross - l.lineDiscount).toBe(l.net);
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});
