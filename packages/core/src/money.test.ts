import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { allocate, formatMoney, fromMinor, sumMinor, toMinor, toSafeMinor } from "./money";

describe("toMinor / fromMinor", () => {
  it("converts per currency exponent", () => {
    expect(toMinor("12.34", "USD")).toBe(1234);
    expect(toMinor("12.345", "EUR")).toBe(1235);
    expect(toMinor("12.345", "EUR", "half-even")).toBe(1234);
    expect(toMinor("1500", "JPY")).toBe(1500);
    expect(toMinor("1500.5", "JPY")).toBe(1501);
  });

  it("round-trips", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (n) => {
        expect(toMinor(fromMinor(n, "EUR"), "EUR")).toBe(n);
      }),
    );
  });

  it("guards against unsafe integers", () => {
    expect(() => toSafeMinor(2n ** 60n)).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it("formats by locale", () => {
    expect(formatMoney(123456, "USD", "en-US")).toBe("$1,234.56");
    expect(formatMoney(123456, "EUR", "de-DE")).toBe("1.234,56\u00a0€");
    expect(formatMoney(-500, "EUR", "en-IE")).toBe("-€5.00");
    expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500");
  });

  it("does not lose precision on large amounts", () => {
    expect(formatMoney(900719925474099, "USD", "en-US")).toBe("$9,007,199,254,740.99");
  });
});

describe("allocate", () => {
  it("splits without loss", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(5, [0, 0])).toEqual([5, 0]);
  });

  it("always sums to the total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.array(fc.integer({ min: 0, max: 1e7 }), { minLength: 1, maxLength: 30 }),
        (total, weights) => {
          expect(sumMinor(allocate(total, weights))).toBe(total);
        },
      ),
    );
  });
});
