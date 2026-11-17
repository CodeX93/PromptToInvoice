/**
 * Calendar-date helpers. Invoice dates are plain calendar dates (no time, no
 * zone) stored as "YYYY-MM-DD"; arithmetic is done in UTC to stay DST-proof.
 */

export type IsoDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: string): value is IsoDate {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().startsWith(value);
}

function toUtcMs(date: IsoDate): number {
  if (!isIsoDate(date)) throw new RangeError(`Invalid ISO date: ${String(date)}`);
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(a) - toUtcMs(b)) / DAY_MS);
}

const tzFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** The current calendar date in an IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  let f = tzFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    tzFormatterCache.set(timeZone, f);
  }
  return f.format(now);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: readonly AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

export function agingBucket(dueDate: IsoDate | null, today: IsoDate): AgingBucket {
  if (dueDate === null) return "current";
  const late = diffDays(today, dueDate);
  if (late <= 0) return "current";
  if (late <= 30) return "1-30";
  if (late <= 60) return "31-60";
  if (late <= 90) return "61-90";
  return "90+";
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

export function formatDate(
  date: IsoDate,
  locale = "en-US",
  style: "medium" | "long" | "short" = "medium",
): string {
  const key = `${locale}|${style}`;
  let f = dateFormatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: "UTC" });
    dateFormatterCache.set(key, f);
  }
  return f.format(new Date(toUtcMs(date)));
}
