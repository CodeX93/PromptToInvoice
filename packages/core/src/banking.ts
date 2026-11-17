/** IBAN validation (ISO 13616 mod-97) and EPC069-12 "GiroCode" QR payloads. */

const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BR: 29,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  TN: 24,
  TR: 26,
  UA: 29,
  VG: 24,
  XK: 20,
};

export function normalizeIban(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

/** mod-97 over the rearranged IBAN, streamed in chunks so it never needs bigint. */
function mod97(input: string): number {
  let rem = 0;
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 ? String(code - 55) : ch; // A=10 … Z=35
    for (const d of digits) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem;
}

export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected !== undefined && iban.length !== expected) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}

/** Group in blocks of four for display: DE89 3704 0044 0532 0130 00 */
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})(?=.)/g, "$1 ");
}

export function isValidBic(raw: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(raw.toUpperCase().replace(/\s/g, ""));
}

export interface EpcQrInput {
  name: string;
  iban: string;
  bic?: string | null;
  /** Amount in EUR cents. Must be between 1 and 99999999999. */
  amountCents: number;
  /** Unstructured remittance text (max 140 chars), usually the invoice number. */
  remittance: string;
}

/**
 * Build an EPC QR code payload (version 002, UTF-8, SEPA credit transfer).
 * Banking apps in the EU scan this to pre-fill a transfer.
 */
export function epcQrPayload(input: EpcQrInput): string {
  if (!isValidIban(input.iban)) throw new RangeError("Invalid IBAN");
  if (
    !Number.isInteger(input.amountCents) ||
    input.amountCents < 1 ||
    input.amountCents > 99_999_999_999
  ) {
    throw new RangeError("EPC amount out of range");
  }
  const amount = `EUR${Math.floor(input.amountCents / 100)}.${String(input.amountCents % 100).padStart(2, "0")}`;
  const clean = (s: string, max: number) =>
    s
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, max);
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    input.bic ? input.bic.toUpperCase().replace(/\s/g, "") : "",
    clean(input.name, 70),
    normalizeIban(input.iban),
    amount,
    "",
    "",
    clean(input.remittance, 140),
  ].join("\n");
}
