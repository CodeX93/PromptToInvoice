import {
  CalculationError,
  addDays,
  calculate,
  diffDays,
  suggestTaxTreatment,
  type CalculationResult,
  type CurrencyCode,
  type TaxCategory,
  type TaxTreatment,
} from "@pti/core";
import type { ClientOption } from "@/app/app/clients/actions";
import { normalizeNumberInput } from "./number-input";

/**
 * Pure state for the invoice editor. The component is a thin view over
 * these functions, which keeps the logic testable without a DOM.
 */

export interface EditorLine {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPercent: string;
  taxCategory: TaxCategory;
  taxRate: string;
}

export interface EditorState {
  businessProfileId: string;
  client: ClientOption | null;
  currency: CurrencyCode;
  issueDate: string;
  supplyDate: string;
  dueDate: string;
  language: string;
  reference: string;
  lines: EditorLine[];
  discount: { type: "percent" | "amount"; value: string } | null;
  notes: string;
  terms: string;
  taxNote: string;
}

export interface SellerContext {
  country: string;
  vatExempt: boolean;
}

let seq = 0;
export const newKey = (): string => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function blankLine(taxCategory: TaxCategory, taxRate: string): EditorLine {
  return { key: newKey(), description: "", quantity: "1", unit: "", unitPrice: "", discountPercent: "", taxCategory, taxRate };
}

const isBlank = (l: EditorLine) => !l.description.trim() && !l.unitPrice.trim();

/** Numbers as the server expects them; invalid input is passed through so validation can point at it. */
function num(v: string): string {
  return normalizeNumberInput(v) ?? v.trim();
}

export function toPayload(s: EditorState) {
  return {
    businessProfileId: s.businessProfileId,
    clientId: s.client?.id ?? null,
    currency: s.currency,
    issueDate: s.issueDate,
    supplyDate: s.supplyDate || null,
    dueDate: s.dueDate || null,
    language: s.language,
    reference: s.reference,
    lines: s.lines.filter((l) => !isBlank(l)).map((l) => ({
      description: l.description,
      quantity: num(l.quantity),
      unit: l.unit,
      unitPrice: num(l.unitPrice || "0"),
      discountPercent: l.discountPercent.trim() ? num(l.discountPercent) : null,
      taxCategory: l.taxCategory,
      taxRate: num(l.taxRate),
    })),
    discount: s.discount?.value.trim() ? { type: s.discount.type, value: num(s.discount.value) } : null,
    notes: s.notes,
    terms: s.terms,
    taxNote: s.taxNote,
  };
}

export type Totals = { ok: true; result: CalculationResult } | { ok: false; message: string; lineIndex: number | null };

/** Live totals with the exact engine the server uses. */
export function computeTotals(s: EditorState): Totals {
  const p = toPayload(s);
  if (p.lines.length === 0) {
    return { ok: true, result: { currency: s.currency, lines: [], breakdown: [], lineNetTotal: 0, discountTotal: 0, taxExclusive: 0, taxTotal: 0, taxInclusive: 0 } };
  }
  try {
    return { ok: true, result: calculate({ currency: s.currency, lines: p.lines, discount: p.discount }) };
  } catch (e) {
    if (e instanceof CalculationError) {
      const idx = e.path[0] === "lines" && typeof e.path[1] === "number" ? e.path[1] : null;
      return { ok: false, message: e.message, lineIndex: idx };
    }
    throw e;
  }
}

/** Suggested tax treatment for the chosen client, or null if lines already match it. */
export function taxSuggestion(s: EditorState, seller: SellerContext): TaxTreatment | null {
  if (!s.client) return null;
  const t = suggestTaxTreatment({
    sellerCountry: seller.country,
    buyerCountry: s.client.country,
    buyerIsBusiness: s.client.isBusiness,
    buyerVatIdValid: s.client.vatIdValid,
    sellerVatExempt: seller.vatExempt,
    supply: "services",
  });
  const lines = s.lines.filter((l) => !isBlank(l));
  const matches = lines.length > 0 && lines.every((l) => l.taxCategory === t.category && (t.category !== "S" || Number(l.taxRate) === Number(t.rate)));
  if (matches || t.reason === "non-eu-seller") return null;
  return t;
}

export function applyTaxTreatment(s: EditorState, t: TaxTreatment): EditorState {
  return {
    ...s,
    lines: s.lines.map((l) => ({ ...l, taxCategory: t.category, taxRate: t.category === "S" ? t.rate : "0" })),
    taxNote: t.note ?? "",
  };
}

/** Choosing a client adopts their currency and payment terms (keeping the same term length if they have none). */
export function withClient(s: EditorState, c: ClientOption | null, defaultTermsDays: number): EditorState {
  if (!c) return { ...s, client: null };
  const terms = c.paymentTermsDays ?? (s.dueDate ? diffDays(s.dueDate, s.issueDate) : defaultTermsDays);
  return {
    ...s,
    client: c,
    currency: (c.currency as CurrencyCode | null) ?? s.currency,
    dueDate: addDays(s.issueDate, Math.max(0, terms)),
  };
}

export function moveLine(lines: EditorLine[], from: number, to: number): EditorLine[] {
  if (to < 0 || to >= lines.length || from === to) return lines;
  const next = lines.slice();
  const [item] = next.splice(from, 1);
  if (item) next.splice(to, 0, item);
  return next;
}
