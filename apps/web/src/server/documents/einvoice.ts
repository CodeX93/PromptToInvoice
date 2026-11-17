import "server-only";
import {
  DEFAULT_EXEMPTION_NOTES,
  isCurrencyCode,
  isValidIban,
  normalizeIban,
  type TaxCategory,
} from "@pti/core";
import {
  facturXXmp,
  FACTURX_FILENAME,
  toCii,
  unitCode,
  type CiiProfile,
  type EInvoice,
} from "@pti/einvoice";
import type { InvoiceDetail } from "../services/invoices";
import { logger } from "../logger";
import type { PdfAttachment } from "./pdf";

const abs = Math.abs;
const strip = (v: string) => v.replace(/^-/, "");

/**
 * Map an issued document to EN 16931. Returns null when the data can't form
 * a valid e-invoice (e.g. the seller has no tax identifier, BR-CO-26), so
 * we never emit XML that a recipient's validator would reject.
 */
export function toEInvoice(d: InvoiceDetail): EInvoice | null {
  const inv = d.invoice;
  const snap = inv.issuedSnapshot;
  if (!snap || !inv.number || !isCurrencyCode(inv.currency)) return null;
  if (!snap.seller.vatId && !snap.seller.taxId && !snap.seller.registrationNumber) return null;
  const bank = snap.seller.bank;
  const exemption = (c: TaxCategory) => (inv.taxNote || DEFAULT_EXEMPTION_NOTES[c]) ?? null;
  const total = abs(inv.total);
  return {
    number: inv.number,
    typeCode: inv.docType === "credit_note" ? "381" : "380",
    issueDate: inv.issueDate,
    supplyDate: inv.supplyDate,
    dueDate: inv.docType === "invoice" ? inv.dueDate : null,
    currency: inv.currency,
    buyerReference: snap.buyer.buyerReference ?? (inv.reference || null),
    orderReference: inv.reference || null,
    preceding: d.corrects?.number ? { number: d.corrects.number } : null,
    notes: [inv.notes].filter(Boolean),
    paymentTerms: inv.terms || null,
    seller: {
      name: snap.seller.legalName,
      address: snap.seller.address,
      vatId: snap.seller.vatId,
      taxId: snap.seller.taxId,
      registration: snap.seller.registrationNumber,
      email: snap.seller.email,
      phone: snap.seller.phone,
      contactName: snap.seller.tradingName ?? snap.seller.legalName,
    },
    buyer: {
      name: snap.buyer.name,
      address: snap.buyer.address ?? {
        line1: "",
        line2: "",
        city: "",
        postalCode: "",
        region: "",
        country: snap.seller.address.country,
      },
      vatId: snap.buyer.vatId,
      taxId: snap.buyer.taxId,
      email: snap.buyer.email,
      contactName: snap.buyer.contactName,
    },
    payment:
      bank?.iban && isValidIban(bank.iban) && inv.docType === "invoice"
        ? {
            iban: normalizeIban(bank.iban),
            bic: bank.bic ?? null,
            accountName: bank.accountHolder ?? snap.seller.legalName,
            reference: inv.number,
          }
        : null,
    lines: d.lines.map((l, i) => ({
      id: String(i + 1),
      name: l.description,
      quantity: strip(l.quantity),
      unitCode: unitCode(l.unit),
      netPrice: l.unitPrice,
      allowance: abs(l.lineDiscount),
      lineTotal: abs(l.net),
      taxCategory: l.taxCategory as TaxCategory,
      taxRate: l.taxRate,
    })),
    allowances: inv.taxBreakdown
      .filter((b) => b.discount !== 0)
      .map((b) => ({
        amount: abs(b.discount),
        base: abs(b.lineNet),
        reason: "Discount",
        taxCategory: b.category,
        taxRate: b.rate,
      })),
    breakdown: inv.taxBreakdown.map((b) => ({
      category: b.category,
      rate: b.rate,
      taxable: abs(b.taxable),
      tax: abs(b.tax),
      exemptionReason: b.category === "S" || b.category === "Z" ? null : exemption(b.category),
    })),
    totals: {
      lineTotal: abs(inv.lineNetTotal),
      allowanceTotal: abs(inv.discountTotal),
      taxBasis: abs(inv.taxExclusive),
      taxTotal: abs(inv.taxTotal),
      grandTotal: total,
      prepaid: 0,
      duePayable: total,
    },
  };
}

export function einvoiceXml(d: InvoiceDetail, profile: CiiProfile): string | null {
  const e = toEInvoice(d);
  return e ? toCii(e, profile) : null;
}

/** Factur-X/ZUGFeRD attachment + XMP for the archived PDF/A-3. */
export function facturXFor(
  d: InvoiceDetail,
): { attachments: PdfAttachment[]; xmpExtension: string } | null {
  const xml = einvoiceXml(d, "en16931");
  if (!xml) {
    logger.info({ invoiceId: d.invoice.id }, "e-invoice skipped: missing seller tax identifier");
    return null;
  }
  return {
    attachments: [
      {
        name: FACTURX_FILENAME,
        content: Buffer.from(xml, "utf8"),
        mime: "text/xml",
        description: "Factur-X/ZUGFeRD invoice (EN 16931)",
        relationship: "Alternative",
      },
    ],
    xmpExtension: facturXXmp("EN 16931"),
  };
}
