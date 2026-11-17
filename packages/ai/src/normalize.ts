import {
  addDays,
  isCurrencyCode,
  isDecimalString,
  isIsoDate,
  normalizeVatId,
  type TaxCategory,
} from "@pti/core";
import type { DraftOutput, TaxHint } from "./schema";

export interface HistoryItem {
  description: string;
  unit: string;
  unitPrice: string;
  currency: string;
  clientId: string | null;
}

export interface TaxRateRef {
  category: TaxCategory;
  rate: string;
  isDefault: boolean;
}

export interface NormalizeContext {
  today: string;
  knownClientIds: ReadonlySet<string>;
  history: readonly HistoryItem[];
  taxRates: readonly TaxRateRef[];
}

export interface NormalizedLine {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPercent: string | null;
  tax: { category: TaxCategory; rate: string } | null;
}

export interface NormalizedDraft {
  clientId: string | null;
  /** Name to fuzzy-match or create when no known id was returned. */
  clientName: string | null;
  clientHints: { email: string | null; country: string | null; vatId: string | null };
  currency: string | null;
  issueDate: string;
  supplyDate: string | null;
  dueDate: string | null;
  termsDays: number | null;
  reference: string;
  language: string | null;
  lines: NormalizedLine[];
  discount: { type: "percent" | "amount"; value: string } | null;
  notes: string | null;
  copyFromPrevious: boolean;
  /** Paths filled from the prompt; the editor highlights them until edited. */
  aiFields: string[];
  /** Plain-language notes for the user (model assumptions + our own fills). */
  notesForUser: string[];
}

const plainDecimal = (v: string | null | undefined, scale: number): string | null => {
  if (v == null) return null;
  const s = v.trim().replace(/[\s,](?=\d{3}(\D|$))/g, "");
  return isDecimalString(s, scale) ? s : null;
};

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Best previous price for a line: same client first, then anyone; same currency when known. */
export function suggestPrice(
  description: string,
  unit: string,
  clientId: string | null,
  currency: string | null,
  history: readonly HistoryItem[],
): HistoryItem | null {
  let best: { item: HistoryItem; score: number } | null = null;
  for (const h of history) {
    if (currency && h.currency !== currency) continue;
    let score = similarity(description, h.description);
    if (unit && h.unit && unit.toLowerCase() === h.unit.toLowerCase()) score += 0.15;
    if (clientId && h.clientId === clientId) score += 0.2;
    if (score > (best?.score ?? 0)) best = { item: h, score };
  }
  return best && best.score >= 0.45 ? best.item : null;
}

/** Map an explicit tax hint to one of the seller's configured rates. */
export function mapTaxHint(
  hint: TaxHint | null,
  rates: readonly TaxRateRef[],
): { category: TaxCategory; rate: string } | null {
  if (!hint) return null;
  const standard = rates
    .filter((r) => r.category === "S")
    .sort((a, b) => Number(b.rate) - Number(a.rate));
  switch (hint) {
    case "standard":
      return standard[0] ? { category: "S", rate: standard[0].rate } : null;
    case "reduced":
      return standard.length > 1 && standard.at(-1)
        ? { category: "S", rate: standard.at(-1)?.rate ?? "0" }
        : null;
    case "zero":
      return { category: "Z", rate: "0" };
    case "exempt":
      return { category: "E", rate: "0" };
    case "reverse_charge":
      return { category: "AE", rate: "0" };
    case "outside_scope":
      return { category: "O", rate: "0" };
  }
}

/**
 * Turn raw model output into a safe draft: unknown ids are dropped, bad
 * numbers and dates are discarded (and reported), missing prices are filled
 * from the user's own history, and every value that came from the prompt is
 * recorded so the UI can mark it.
 */
export function normalizeDraft(out: DraftOutput, ctx: NormalizeContext): NormalizedDraft {
  const ai: string[] = [];
  const notes: string[] = [...out.assumptions.filter((a) => a.trim()).slice(0, 8)];

  const clientId =
    out.client.matchedClientId && ctx.knownClientIds.has(out.client.matchedClientId)
      ? out.client.matchedClientId
      : null;
  const clientName = out.client.name?.trim() || null;
  if (clientId || clientName) ai.push("client");

  const currency =
    out.currency && isCurrencyCode(out.currency.toUpperCase()) ? out.currency.toUpperCase() : null;
  if (currency) ai.push("currency");

  const date = (v: string | null, path: string) => {
    if (v && isIsoDate(v)) {
      ai.push(path);
      return v;
    }
    return null;
  };
  const issueDate = date(out.issueDate, "issueDate") ?? ctx.today;
  const supplyDate = date(out.supplyDate, "supplyDate");
  let dueDate = date(out.dueDate, "dueDate");
  const termsDays =
    out.paymentTermsDays !== null && out.paymentTermsDays >= 0 && out.paymentTermsDays <= 365
      ? out.paymentTermsDays
      : null;
  if (!dueDate && termsDays !== null) {
    dueDate = addDays(issueDate, termsDays);
    ai.push("dueDate");
  }
  if (dueDate && dueDate < issueDate) dueDate = null;

  const lines: NormalizedLine[] = [];
  out.lines.slice(0, 100).forEach((l) => {
    const description = l.description.trim().slice(0, 2000);
    if (!description) return;
    const i = lines.length;
    ai.push(`lines.${i}.description`);
    let quantity = plainDecimal(l.quantity, 4);
    if (quantity) ai.push(`lines.${i}.quantity`);
    else {
      quantity = "1";
      notes.push(`Couldn't read the quantity for “${description}”; set to 1.`);
    }
    const unit = (l.unit ?? "").trim().slice(0, 20);
    if (unit) ai.push(`lines.${i}.unit`);
    let unitPrice = plainDecimal(l.unitPrice, 6);
    if (unitPrice) ai.push(`lines.${i}.unitPrice`);
    else {
      const prev = suggestPrice(description, unit, clientId, currency, ctx.history);
      if (prev) {
        unitPrice = prev.unitPrice;
        ai.push(`lines.${i}.unitPrice`);
        notes.push(
          `Used your previous rate of ${prev.unitPrice} ${prev.currency}${prev.unit ? `/${prev.unit}` : ""} for “${description}”.`,
        );
      } else {
        unitPrice = "";
        notes.push(`No price given for “${description}”. Add one before issuing.`);
      }
    }
    const discountPercent = plainDecimal(l.discountPercent, 4);
    if (discountPercent) ai.push(`lines.${i}.discountPercent`);
    lines.push({
      description,
      quantity,
      unit,
      unitPrice,
      discountPercent: discountPercent && Number(discountPercent) <= 100 ? discountPercent : null,
      tax: mapTaxHint(l.taxHint, ctx.taxRates),
    });
  });

  const dv = out.discount
    ? plainDecimal(out.discount.value, out.discount.type === "percent" ? 4 : 6)
    : null;
  const discount =
    out.discount && dv && (out.discount.type === "amount" || Number(dv) <= 100)
      ? { type: out.discount.type, value: dv }
      : null;

  for (const u of out.uncertainFields) {
    // Model-flagged uncertainty is surfaced through `notes`; make sure flagged fields are highlighted too.
    if (
      /^(client|currency|issueDate|dueDate|supplyDate|reference|lines\.\d+\.\w+)$/.test(u) &&
      !ai.includes(u)
    )
      ai.push(u);
  }
  const reference = out.reference?.trim().slice(0, 100) ?? "";
  if (reference) ai.push("reference");
  const note = out.notes?.trim().slice(0, 4000) || null;
  if (note) ai.push("notes");

  return {
    clientId,
    clientName,
    clientHints: {
      email:
        out.client.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.client.email)
          ? out.client.email.toLowerCase()
          : null,
      country:
        out.client.country && /^[A-Za-z]{2}$/.test(out.client.country)
          ? out.client.country.toUpperCase()
          : null,
      vatId: out.client.vatId ? normalizeVatId(out.client.vatId) : null,
    },
    currency,
    issueDate,
    supplyDate,
    dueDate,
    termsDays,
    reference,
    language: out.language,
    lines,
    discount,
    notes: note,
    copyFromPrevious: out.copyFromPrevious,
    aiFields: [...new Set(ai)],
    notesForUser: [...new Set(notes)],
  };
}
