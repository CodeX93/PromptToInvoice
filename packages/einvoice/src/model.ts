import type { CurrencyCode, TaxCategory } from "@pti/core";

/**
 * Syntax-neutral EN 16931 invoice. Amounts are integers in minor units;
 * quantities and unit prices are decimal strings. Credit notes carry
 * positive amounts with type code 381, as EN 16931 requires.
 */
export interface EParty {
  name: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    postalCode: string;
    region: string;
    country: string;
  };
  vatId?: string | null;
  taxId?: string | null;
  registration?: string | null;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
}

export interface ELine {
  id: string;
  name: string;
  quantity: string;
  /** UN/ECE Recommendation 20 code (HUR, DAY, C62, …). */
  unitCode: string;
  /** Price per unit before line allowances (BT-146), major units, decimal string. */
  netPrice: string;
  /** Line allowance (BT-136), minor units. */
  allowance: number;
  /** Line net amount (BT-131), minor units. */
  lineTotal: number;
  taxCategory: TaxCategory;
  taxRate: string;
}

export interface EAllowance {
  amount: number;
  base: number;
  reason: string;
  taxCategory: TaxCategory;
  taxRate: string;
}

export interface ETaxBreakdown {
  category: TaxCategory;
  rate: string;
  taxable: number;
  tax: number;
  exemptionReason?: string | null;
}

export interface EInvoice {
  number: string;
  typeCode: "380" | "381";
  issueDate: string;
  supplyDate?: string | null;
  dueDate?: string | null;
  currency: CurrencyCode;
  buyerReference?: string | null;
  orderReference?: string | null;
  preceding?: { number: string; issueDate?: string | null } | null;
  notes: string[];
  paymentTerms?: string | null;
  seller: EParty;
  buyer: EParty;
  payment?: {
    iban: string;
    bic?: string | null;
    accountName?: string | null;
    reference: string;
  } | null;
  lines: ELine[];
  allowances: EAllowance[];
  breakdown: ETaxBreakdown[];
  totals: {
    lineTotal: number;
    allowanceTotal: number;
    taxBasis: number;
    taxTotal: number;
    grandTotal: number;
    prepaid: number;
    duePayable: number;
  };
}

const UNIT_CODES: Record<string, string> = {
  h: "HUR",
  hr: "HUR",
  hrs: "HUR",
  hour: "HUR",
  hours: "HUR",
  std: "HUR",
  "std.": "HUR",
  stunden: "HUR",
  d: "DAY",
  day: "DAY",
  days: "DAY",
  tag: "DAY",
  tage: "DAY",
  jour: "DAY",
  jours: "DAY",
  min: "MIN",
  minute: "MIN",
  minutes: "MIN",
  week: "WEE",
  weeks: "WEE",
  wk: "WEE",
  month: "MON",
  months: "MON",
  mo: "MON",
  monat: "MON",
  year: "ANN",
  years: "ANN",
  km: "KMT",
  kg: "KGM",
  m: "MTR",
  m2: "MTK",
  l: "LTR",
  pcs: "H87",
  pc: "H87",
  piece: "H87",
  pieces: "H87",
  stk: "H87",
  "stk.": "H87",
  stück: "H87",
  item: "H87",
  items: "H87",
};

/** Map a free-text unit to a UN/ECE Rec. 20 code; C62 ("one") for anything unknown or blank. */
export function unitCode(unit: string): string {
  return UNIT_CODES[unit.trim().toLowerCase()] ?? "C62";
}
