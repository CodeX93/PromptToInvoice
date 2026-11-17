import { describe, expect, it } from "vitest";
import { resolvePeriod } from "./periods";
import { csvCell, toCsv } from "./csv";

describe("resolvePeriod", () => {
  it.each([
    ["this-month", "2026-11-01", "2026-11-30"],
    ["last-month", "2026-10-01", "2026-10-31"],
    ["this-quarter", "2026-10-01", "2026-12-31"],
    ["last-quarter", "2026-07-01", "2026-09-30"],
    ["this-year", "2026-01-01", "2026-12-31"],
    ["last-year", "2025-01-01", "2025-12-31"],
  ])("%s", (key, from, to) => {
    expect(resolvePeriod("2026-11-17", key)).toMatchObject({ from, to, key });
  });

  it("handles quarter boundaries and February", () => {
    expect(resolvePeriod("2026-03-31", "last-month")).toMatchObject({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(resolvePeriod("2026-01-05", "last-quarter")).toMatchObject({
      from: "2025-10-01",
      to: "2025-12-31",
    });
  });

  it("accepts valid custom ranges and rejects bad ones", () => {
    expect(resolvePeriod("2026-11-17", undefined, "2026-01-01", "2026-03-31").key).toBe("custom");
    expect(resolvePeriod("2026-11-17", undefined, "2026-04-01", "2026-03-31").key).toBe(
      "this-month",
    );
  });
});

describe("csv", () => {
  it("escapes and neutralises formulas", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("-5")).toBe(`"'-5"`);
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
  });

  it("writes a BOM and CRLF rows", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("﻿a,b\r\n1,x\r\n");
  });
});
