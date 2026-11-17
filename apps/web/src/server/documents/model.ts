import "server-only";
import {
  DEFAULT_EXEMPTION_NOTES,
  amountDue,
  countryName,
  epcQrPayload,
  formatDate,
  formatIban,
  formatMoney,
  isCurrencyCode,
  isValidIban,
  minorUnitExponent,
  divRound,
  pow10,
  normalizeDecimal,
  parseDecimal,
  formatDecimal,
  type Address,
  type CurrencyCode,
} from "@pti/core";
import type { IssuedSnapshot } from "@pti/db";
import type { InvoiceDetail } from "../services/invoices";
import { readBank } from "../services/business-profiles";
import { labelsFor, localeFor, type DocLabels } from "./labels";

export interface DocRow {
  label: string;
  value: string;
}

/**
 * A fully formatted, render-ready invoice. The HTML preview, the PDF and the
 * public page all render from this one structure, so they can't disagree.
 */
export interface InvoiceDocModel {
  labels: DocLabels;
  locale: string;
  currency: CurrencyCode;
  kind: "invoice" | "credit_note" | "quote";
  title: string;
  number: string;
  stamp: "draft" | "paid" | "void" | null;
  accent: string;
  logoFileId: string | null;
  seller: { name: string; lines: string[]; ids: DocRow[]; contact: string[] };
  buyer: { name: string; lines: string[]; ids: DocRow[] };
  meta: DocRow[];
  lines: {
    description: string;
    quantity: string;
    unitPrice: string;
    tax: string;
    amount: string;
  }[];
  totals: { label: string; value: string; strong?: boolean }[];
  taxSummary: { label: string; taxable: string; tax: string }[];
  taxNotes: string[];
  notes: string;
  terms: string;
  footer: string;
  payment: {
    holder: string | null;
    iban: string | null;
    bic: string | null;
    bankName: string | null;
    epcPayload: string | null;
    remittance: string;
    payUrl: string | null;
    due: string;
    dueMinor: number;
  } | null;
}

type Profile = Parameters<typeof readBank>[0] & {
  legalName: string;
  tradingName: string | null;
  address: Address;
  vatId: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoFileId: string | null;
  branding: { accentColor?: string; footer?: string };
  vatExempt: boolean;
  vatExemptNote: string | null;
};

function addressLines(a: Address | null | undefined, locale: string): string[] {
  if (!a) return [];
  const cityLine =
    a.country === "US" || a.country === "CA"
      ? [a.city, [a.region, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")
      : [a.postalCode, a.city].filter(Boolean).join(" ");
  return [
    a.line1,
    a.line2,
    cityLine,
    a.country ? countryName(a.country, locale.slice(0, 2)) : "",
  ].filter((x) => x.trim().length > 0);
}

/** "10.0000" -> "10", "1.5000" -> "1.5", formatted with locale grouping. */
function qty(q: string, locale: string): string {
  const d = normalizeDecimal(parseDecimal(q));
  const [int, frac] = formatDecimal(d).split(".");
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(int ?? "0"));
  const sep = new Intl.NumberFormat(locale).format(1.5).charAt(1);
  return frac ? `${n}${sep}${frac}` : n;
}

const unitPriceFmt = new Map<string, Intl.NumberFormat>();

/** Unit prices keep up to 6 decimals (e.g. €0.0125 per API call), never rounded for display. */
function unitPrice(v: string, currency: CurrencyCode, locale: string): string {
  const key = `${locale}|${currency}`;
  let f = unitPriceFmt.get(key);
  if (!f) {
    const digits = minorUnitExponent(currency);
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: 6,
    });
    unitPriceFmt.set(key, f);
  }
  return f.format(formatDecimal(normalizeDecimal(parseDecimal(v))) as unknown as number);
}

function rate(r: string, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(Number(r))}%`;
}

export function buildDocModel(
  d: InvoiceDetail,
  liveProfile: Profile,
  opts: { payUrl?: string | null; customBranding?: boolean } = {},
): InvoiceDocModel {
  const inv = d.invoice;
  const snap: IssuedSnapshot["seller"] | null = inv.issuedSnapshot?.seller ?? null;
  const bank = snap ? snap.bank : readBank(liveProfile);
  const sellerAddr = snap?.address ?? liveProfile.address;
  const L = labelsFor(inv.language);
  const locale = localeFor(inv.language, sellerAddr.country);
  const currency = isCurrencyCode(inv.currency) ? inv.currency : "EUR";
  const m = (minor: number) => formatMoney(minor, currency, locale);
  const date = (iso: string) => formatDate(iso, locale, "medium");

  const seller = snap ?? {
    legalName: liveProfile.legalName,
    tradingName: liveProfile.tradingName,
    address: liveProfile.address,
    vatId: liveProfile.vatId,
    taxId: liveProfile.taxId,
    registrationNumber: liveProfile.registrationNumber,
    email: liveProfile.email,
    phone: liveProfile.phone,
    website: liveProfile.website,
    logoFileId: liveProfile.logoFileId,
  };
  const buyer: IssuedSnapshot["buyer"] | null =
    inv.issuedSnapshot?.buyer ??
    (d.client
      ? {
          name: d.client.name,
          contactName: d.client.contactName,
          address: d.client.address,
          vatId: d.client.vatId,
          taxId: d.client.taxId,
          email: d.client.emails[0] ?? null,
          buyerReference: d.client.buyerReference,
        }
      : null);

  const kind = inv.docType;
  const meta: DocRow[] = [];
  meta.push({ label: L.issueDate, value: date(inv.issueDate) });
  if (inv.supplyDate && inv.supplyDate !== inv.issueDate)
    meta.push({ label: L.supplyDate, value: date(inv.supplyDate) });
  if (kind === "invoice")
    meta.push({ label: L.dueDate, value: inv.dueDate ? date(inv.dueDate) : L.dueOnReceipt });
  if (kind === "quote" && inv.dueDate) meta.push({ label: L.validUntil, value: date(inv.dueDate) });
  if (d.corrects?.number) meta.push({ label: L.correctsInvoice, value: d.corrects.number });
  if (inv.reference && !(kind === "credit_note" && inv.reference === d.corrects?.number))
    meta.push({ label: L.reference, value: inv.reference });
  if (buyer?.buyerReference) meta.push({ label: L.reference, value: buyer.buyerReference });

  const totals: InvoiceDocModel["totals"] = [];
  if (inv.discountTotal !== 0) {
    totals.push({ label: L.subtotal, value: m(inv.lineNetTotal) });
    totals.push({
      label:
        inv.discountType === "percent" && inv.discountValue
          ? `${L.discount} ${rate(inv.discountValue, locale)}`
          : L.discount,
      value: m(-inv.discountTotal),
    });
  }
  const groups = inv.taxBreakdown;
  const hasTax = groups.some((g) => g.tax !== 0);
  if (hasTax || inv.discountTotal !== 0)
    totals.push({ label: L.totalExclTax, value: m(inv.taxExclusive) });
  for (const g of groups)
    if (g.tax !== 0) totals.push({ label: `${L.vat} ${rate(g.rate, locale)}`, value: m(g.tax) });
  totals.push({ label: L.total, value: m(inv.total), strong: true });
  const due = amountDue(inv);
  if (
    inv.status !== "draft" &&
    kind === "invoice" &&
    (inv.amountPaid > 0 || inv.creditedAmount > 0)
  ) {
    if (inv.amountPaid > 0) totals.push({ label: L.amountPaid, value: m(-inv.amountPaid) });
    if (inv.creditedAmount > 0) totals.push({ label: L.creditNote, value: m(-inv.creditedAmount) });
    totals.push({ label: L.amountDue, value: m(due), strong: true });
  }

  const categories = new Set(groups.map((g) => g.category));
  const taxNotes: string[] = [];
  if (inv.taxNote) taxNotes.push(inv.taxNote);
  else {
    for (const c of categories) {
      const note =
        c === "E" && liveProfile.vatExemptNote
          ? liveProfile.vatExemptNote
          : DEFAULT_EXEMPTION_NOTES[c];
      if (c !== "S" && c !== "Z" && note) taxNotes.push(note);
    }
  }

  if (inv.fxRate && inv.fxCurrency && isCurrencyCode(inv.fxCurrency) && inv.taxTotal !== 0) {
    const rate = parseDecimal(inv.fxRate);
    // Same rounding as every other amount (half-up), never truncation.
    const taxNational = Number(
      divRound(BigInt(inv.taxTotal) * rate.coef, pow10(rate.scale), "half-up"),
    );
    taxNotes.push(
      `${L.vat} in ${inv.fxCurrency}: ${formatMoney(taxNational, inv.fxCurrency, locale)} (1 ${currency} = ${formatDecimal(normalizeDecimal(rate))} ${inv.fxCurrency}, ECB reference rate).`,
    );
  }

  const remittance = inv.number ?? "";
  const iban = bank?.iban && isValidIban(bank.iban) ? bank.iban : null;
  const showPayment =
    kind === "invoice" && inv.status !== "paid" && inv.status !== "void" && (iban || opts.payUrl);
  const payment: InvoiceDocModel["payment"] = showPayment
    ? {
        holder: bank?.accountHolder ?? seller.legalName,
        iban: iban ? formatIban(iban) : null,
        bic: bank?.bic ?? null,
        bankName: bank?.bankName ?? null,
        epcPayload:
          iban && currency === "EUR" && (inv.status === "draft" ? inv.total : due) > 0
            ? epcQrPayload({
                name: bank?.accountHolder ?? seller.legalName,
                iban,
                bic: bank?.bic,
                amountCents: inv.status === "draft" ? inv.total : due,
                remittance: remittance || "Invoice",
              })
            : null,
        remittance,
        payUrl: inv.status === "draft" ? null : (opts.payUrl ?? null),
        due: m(inv.status === "draft" ? inv.total : due),
        dueMinor: inv.status === "draft" ? inv.total : due,
      }
    : null;

  return {
    labels: L,
    locale,
    currency,
    kind,
    title: kind === "credit_note" ? L.creditNote : kind === "quote" ? L.quote : L.invoice,
    number: inv.number ?? L.draft,
    stamp:
      inv.status === "draft"
        ? "draft"
        : inv.status === "paid"
          ? "paid"
          : inv.status === "void"
            ? "void"
            : null,
    accent:
      opts.customBranding === false ? "#16140f" : (liveProfile.branding.accentColor ?? "#16140f"),
    logoFileId: seller.logoFileId,
    seller: {
      name: seller.tradingName ?? seller.legalName,
      lines: [
        ...(seller.tradingName ? [seller.legalName] : []),
        ...addressLines(sellerAddr, locale),
      ],
      ids: [
        ...(seller.vatId ? [{ label: L.vatId, value: seller.vatId }] : []),
        ...(seller.taxId ? [{ label: L.taxId, value: seller.taxId }] : []),
        ...(seller.registrationNumber
          ? [{ label: L.registration, value: seller.registrationNumber }]
          : []),
      ],
      contact: [seller.email, seller.phone, seller.website].filter((x): x is string => Boolean(x)),
    },
    buyer: {
      name: buyer?.name ?? "—",
      lines: [
        ...(buyer?.contactName ? [buyer.contactName] : []),
        ...addressLines(buyer?.address, locale),
      ],
      ids: [
        ...(buyer?.vatId ? [{ label: L.vatId, value: buyer.vatId }] : []),
        ...(buyer?.taxId ? [{ label: L.taxId, value: buyer.taxId }] : []),
      ],
    },
    meta,
    lines: d.lines.map((l) => ({
      description: l.description,
      quantity: `${qty(l.quantity, locale)}${l.unit ? ` ${l.unit}` : ""}`,
      unitPrice: unitPrice(l.unitPrice, currency, locale),
      tax: rate(l.taxRate, locale),
      amount: m(l.net),
    })),
    totals,
    taxSummary:
      groups.length > 1 || [...categories].some((c) => c !== "S")
        ? groups.map((g) => ({
            label: `${g.category} · ${rate(g.rate, locale)}`,
            taxable: m(g.taxable),
            tax: m(g.tax),
          }))
        : [],
    taxNotes,
    notes: inv.notes,
    terms: inv.terms,
    footer: liveProfile.branding.footer ?? "",
    payment,
  };
}
