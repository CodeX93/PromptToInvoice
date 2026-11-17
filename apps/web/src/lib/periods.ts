import { addDays, addMonths, isIsoDate } from "@pti/core";

export const PERIODS = ["this-month", "last-month", "this-quarter", "last-quarter", "this-year", "last-year"] as const;
export type PeriodKey = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "this-quarter": "This quarter",
  "last-quarter": "Last quarter",
  "this-year": "This year",
  "last-year": "Last year",
};

/** Resolve a named period (or explicit from/to) to an inclusive ISO date range. */
export function resolvePeriod(today: string, key?: string, from?: string, to?: string): { from: string; to: string; key: PeriodKey | "custom" } {
  if (from && to && isIsoDate(from) && isIsoDate(to) && from <= to) return { from, to, key: "custom" };
  const k: PeriodKey = (PERIODS as readonly string[]).includes(key ?? "") ? (key as PeriodKey) : "this-month";
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const qStart = `${y}-${String(qStartMonth).padStart(2, "0")}-01`;
  const end = (start: string, months: number) => addDays(addMonths(start, months), -1);
  switch (k) {
    case "this-month":
      return { from: monthStart, to: end(monthStart, 1), key: k };
    case "last-month": {
      const s = addMonths(monthStart, -1);
      return { from: s, to: end(s, 1), key: k };
    }
    case "this-quarter":
      return { from: qStart, to: end(qStart, 3), key: k };
    case "last-quarter": {
      const s = addMonths(qStart, -3);
      return { from: s, to: end(s, 3), key: k };
    }
    case "this-year":
      return { from: `${y}-01-01`, to: `${y}-12-31`, key: k };
    case "last-year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, key: k };
  }
}
