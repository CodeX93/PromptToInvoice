/**
 * Normalise a number typed by a person into a canonical decimal string.
 * Handles "1,200.50", "1.200,50", "1 200,5", "€ 99", "12,5" (decimal comma).
 * Returns null for anything that isn't a number.
 */
export function normalizeNumberInput(raw: string): string | null {
  let s = raw
    .trim()
    .replace(/[\s\u00a0\u202f'\u2019]/g, "")
    .replace(/^[^\d+-]+|[^\d.,]+$/g, "");
  if (!s) return null;
  const neg = s.startsWith("-");
  s = s.replace(/^[+-]/, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const grp = dec === "." ? "," : ".";
    s = s.split(grp).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    const parts = s.split(",");
    // Several commas, or one comma before exactly three digits ("1,200"), are thousands separators;
    // otherwise it's a decimal comma ("12,5", "0,75").
    const grouping = parts.length > 2 || parts[1]?.length === 3;
    s = grouping ? parts.join("") : parts.join(".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.split(".").join("");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return (neg ? "-" : "") + s;
}
