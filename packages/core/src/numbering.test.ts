import { describe, expect, it } from "vitest";
import { formatDocumentNumber, resetPeriodKey, validateNumberPattern } from "./numbering";

describe("validateNumberPattern", () => {
  it.each(["INV-{YYYY}-{SEQ:4}", "{SEQ}", "RE/{YY}{MM}/{SEQ:6}", "#{SEQ:3}"])("accepts %s", (p) => {
    expect(validateNumberPattern(p)).toBeNull();
  });

  it.each([
    ["", /1–40/],
    ["INV-{YYYY}", /exactly one/],
    ["{SEQ}-{SEQ}", /exactly one/],
    ["INV {SEQ}", /Only letters/],
    ["{SEQ:0}", /between 1 and 12/],
    ["{SEQ:13}", /between 1 and 12/],
  ])("rejects %j", (p, msg) => {
    expect(validateNumberPattern(p)?.message).toMatch(msg);
  });
});

describe("formatDocumentNumber", () => {
  it("formats tokens", () => {
    expect(formatDocumentNumber("INV-{YYYY}-{SEQ:4}", 7, "2026-03-15")).toBe("INV-2026-0007");
    expect(formatDocumentNumber("RE/{YY}{MM}/{SEQ}", 1234, "2026-11-02")).toBe("RE/2611/1234");
  });

  it("does not truncate when the sequence exceeds the width", () => {
    expect(formatDocumentNumber("{SEQ:2}", 12345, "2026-01-01")).toBe("12345");
  });

  it("rejects invalid sequences", () => {
    expect(() => formatDocumentNumber("{SEQ}", 0, "2026-01-01")).toThrow();
  });
});

describe("resetPeriodKey", () => {
  it("derives the period", () => {
    expect(resetPeriodKey("never", "2026-05-01")).toBe("all");
    expect(resetPeriodKey("yearly", "2026-05-01")).toBe("2026");
    expect(resetPeriodKey("monthly", "2026-05-01")).toBe("2026-05");
  });
});
