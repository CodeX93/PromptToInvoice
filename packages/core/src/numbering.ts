/**
 * Invoice number patterns.
 *
 * Tokens:
 *   {YYYY} {YY} {MM}   issue date parts
 *   {SEQ} {SEQ:n}      sequence value, zero-padded to n digits
 *
 * A pattern must contain exactly one {SEQ} token so numbers are unique within
 * a series. Literal text is limited to a safe charset because numbers end up
 * in file names, e-invoice XML and URLs.
 */

const TOKEN_RE = /\{(YYYY|YY|MM|SEQ(?::(\d{1,2}))?)\}/g;
const LITERAL_RE = /^[A-Za-z0-9\-_/.#]*$/;

export interface NumberPatternIssue {
  message: string;
}

export function validateNumberPattern(pattern: string): NumberPatternIssue | null {
  if (pattern.length === 0 || pattern.length > 40)
    return { message: "Pattern must be 1–40 characters." };
  let seqCount = 0;
  let literal = "";
  let last = 0;
  for (const m of pattern.matchAll(TOKEN_RE)) {
    literal += pattern.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1]?.startsWith("SEQ")) {
      seqCount++;
      const width = m[2] ? Number(m[2]) : 1;
      if (width < 1 || width > 12) return { message: "Sequence width must be between 1 and 12." };
    }
  }
  literal += pattern.slice(last);
  if (seqCount !== 1) return { message: "Pattern must contain exactly one {SEQ} token." };
  if (!LITERAL_RE.test(literal)) {
    return { message: "Only letters, digits and - _ / . # are allowed outside tokens." };
  }
  return null;
}

/** `issueDate` is an ISO calendar date (YYYY-MM-DD); invoices have no time zone. */
export function formatDocumentNumber(pattern: string, seq: number, issueDate: string): string {
  if (!Number.isSafeInteger(seq) || seq < 1)
    throw new RangeError("Sequence must be a positive integer");
  const yyyy = issueDate.slice(0, 4);
  const mm = issueDate.slice(5, 7);
  return pattern.replace(TOKEN_RE, (_, token: string, width?: string) => {
    switch (token) {
      case "YYYY":
        return yyyy;
      case "YY":
        return yyyy.slice(2);
      case "MM":
        return mm;
      default:
        return String(seq).padStart(width ? Number(width) : 1, "0");
    }
  });
}

/** Key that resets the counter, e.g. yearly series reset on Jan 1st. */
export type ResetPolicy = "never" | "yearly" | "monthly";

export function resetPeriodKey(policy: ResetPolicy, issueDate: string): string {
  switch (policy) {
    case "never":
      return "all";
    case "yearly":
      return issueDate.slice(0, 4);
    case "monthly":
      return issueDate.slice(0, 7);
  }
}

export const DEFAULT_PATTERNS = {
  invoice: "INV-{YYYY}-{SEQ:4}",
  credit_note: "CN-{YYYY}-{SEQ:4}",
  quote: "Q-{YYYY}-{SEQ:4}",
} as const;
