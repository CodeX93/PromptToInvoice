import { describe, expect, it } from "vitest";
import { addDays, addMonths, agingBucket, diffDays, formatDate, isIsoDate, todayIn } from "./dates";

describe("dates", () => {
  it("validates real calendar dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("26-01-01")).toBe(false);
  });

  it("adds days across DST and year boundaries", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
  });

  it("adds months clamping to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-05-15", -6)).toBe("2025-11-15");
  });

  it("diffs days", () => {
    expect(diffDays("2026-03-01", "2026-02-01")).toBe(28);
  });

  it("computes today in a time zone", () => {
    const instant = new Date("2026-06-30T23:30:00Z");
    expect(todayIn("UTC", instant)).toBe("2026-06-30");
    expect(todayIn("Europe/Berlin", instant)).toBe("2026-07-01");
    expect(todayIn("America/Los_Angeles", instant)).toBe("2026-06-30");
  });

  it.each([
    [null, "current"],
    ["2026-06-15", "current"],
    ["2026-06-14", "1-30"],
    ["2026-05-01", "31-60"],
    ["2026-04-01", "61-90"],
    ["2025-01-01", "90+"],
  ] as const)("aging bucket for due %s", (due, bucket) => {
    expect(agingBucket(due, "2026-06-15")).toBe(bucket);
  });

  it("formats in locale without zone shifts", () => {
    expect(formatDate("2026-01-01", "en-US")).toBe("Jan 1, 2026");
    expect(formatDate("2026-01-01", "de-DE", "long")).toBe("1. Januar 2026");
  });
});
