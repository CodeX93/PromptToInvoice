/**
 * RFC 4180 CSV with spreadsheet formula-injection protection: cells that
 * start with = + - @ (or tab/CR) are prefixed with a quote so Excel/Sheets
 * treat them as text. Numbers are emitted unquoted.
 */
export type Cell = string | number | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== v ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  // BOM so Excel opens UTF-8 (umlauts, €) correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
