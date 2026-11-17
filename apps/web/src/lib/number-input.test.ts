import { describe, expect, it } from "vitest";
import { normalizeNumberInput } from "./number-input";

describe("normalizeNumberInput", () => {
  it.each([
    ["1200", "1200"],
    ["1,200.50", "1200.50"],
    ["1.200,50", "1200.50"],
    ["1 200,5", "1200.5"],
    ["12,5", "12.5"],
    ["€ 99", "99"],
    ["$1,000,000", "1000000"],
    ["1.000.000", "1000000"],
    ["-3", "-3"],
    ["0,75", "0.75"],
    ["120 €", "120"],
    ["1,200", "1200"],
    ["1,5", "1.5"],
  ])("%s -> %s", (raw, out) => {
    expect(normalizeNumberInput(raw)).toBe(out);
  });

  it.each(["", "abc", "1.2.3,4,5x", "--"])("rejects %j", (raw) => {
    expect(normalizeNumberInput(raw)).toBeNull();
  });
});
