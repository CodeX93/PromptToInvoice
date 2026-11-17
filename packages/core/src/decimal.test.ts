import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  compareDecimal,
  divRound,
  formatDecimal,
  isDecimalString,
  normalizeDecimal,
  parseDecimal,
  rescale,
} from "./decimal";

describe("parseDecimal", () => {
  it.each([
    ["0", 0n, 0],
    ["12.345", 12345n, 3],
    ["-0.5", -5n, 1],
    ["+3", 3n, 0],
    ["  7.10 ", 710n, 2],
  ])("parses %s", (input, coef, scale) => {
    expect(parseDecimal(input)).toEqual({ coef, scale });
  });

  it.each(["", "1,000", "1e5", "abc", "1.", ".5", "--1"])("rejects %j", (input) => {
    expect(() => parseDecimal(input)).toThrow();
  });

  it("accepts insignificant trailing zeros beyond the scale", () => {
    expect(parseDecimal("5.000000", 4)).toEqual({ coef: 5n, scale: 0 });
    expect(parseDecimal("1.250000", 4)).toEqual({ coef: 125n, scale: 2 });
  });

  it("validates like it parses (trailing zeros)", () => {
    expect(isDecimalString("5.000000", 4)).toBe(true);
    expect(isDecimalString("5.000010", 4)).toBe(false);
  });

  it("rejects excessive precision", () => {
    expect(() => parseDecimal("1.123", 2)).toThrow(/Too many/);
  });

  it("parses finite numbers without exponent noise", () => {
    expect(formatDecimal(parseDecimal(0.1))).toBe("0.1");
    expect(formatDecimal(parseDecimal(1e-7))).toBe("0.0000001");
  });
});

describe("divRound", () => {
  it.each([
    [5n, 2n, "half-up", 3n],
    [-5n, 2n, "half-up", -3n],
    [5n, 2n, "half-even", 2n],
    [7n, 2n, "half-even", 4n],
    [9n, 4n, "down", 2n],
    [9n, 4n, "up", 3n],
    [-9n, 4n, "down", -2n],
  ] as const)("%d / %d (%s) = %d", (a, b, mode, expected) => {
    expect(divRound(a, b, mode)).toBe(expected);
  });

  it("is symmetric around zero", () => {
    fc.assert(
      fc.property(fc.bigInt(), fc.bigInt({ min: 1n, max: 10n ** 9n }), (a, b) => {
        expect(divRound(-a, b, "half-up")).toBe(-divRound(a, b, "half-up"));
      }),
    );
  });

  it("never differs from the exact quotient by more than one unit", () => {
    fc.assert(
      fc.property(fc.bigInt(), fc.bigInt({ min: 1n, max: 10n ** 9n }), (a, b) => {
        const q = divRound(a, b, "half-even");
        const diff = a - q * b;
        expect(diff < 0n ? -diff : diff).toBeLessThanOrEqual(b);
      }),
    );
  });
});

describe("rescale / format / normalize", () => {
  it("round-trips through formatDecimal", () => {
    fc.assert(
      fc.property(fc.bigInt(), fc.integer({ min: 0, max: 10 }), (coef, scale) => {
        const d = { coef, scale };
        expect(parseDecimal(formatDecimal(d))).toEqual(d);
      }),
    );
  });

  it("rescales up exactly and down with rounding", () => {
    expect(rescale({ coef: 125n, scale: 2 }, 4)).toBe(12500n);
    expect(rescale({ coef: 125n, scale: 2 }, 1)).toBe(13n);
    expect(rescale({ coef: 125n, scale: 2 }, 1, "half-even")).toBe(12n);
  });

  it("normalises trailing zeros", () => {
    expect(normalizeDecimal({ coef: 15000n, scale: 4 })).toEqual({ coef: 15n, scale: 1 });
    expect(normalizeDecimal({ coef: 0n, scale: 3 })).toEqual({ coef: 0n, scale: 0 });
  });

  it("compares across scales", () => {
    expect(compareDecimal(parseDecimal("1.50"), parseDecimal("1.5"))).toBe(0);
    expect(compareDecimal(parseDecimal("1.49"), parseDecimal("1.5"))).toBe(-1);
  });
});
