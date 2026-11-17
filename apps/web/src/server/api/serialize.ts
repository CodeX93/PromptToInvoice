import "server-only";
import { normalizeDecimal, parseDecimal, formatDecimal } from "@pti/core";
import type { ClientRow } from "../services/clients";
import type { InvoiceDetail, InvoiceListItem } from "../services/invoices";

/**
 * Public API representations. Deliberately decoupled from table columns so
 * the schema can evolve without breaking integrations. Money is always an
 * integer in minor units alongside its ISO currency; decimals are strings.
 */

const dec = (v: string | null) =>
  v === null ? null : formatDecimal(normalizeDecimal(parseDecimal(v)));
const iso = (d: Date | null) => d?.toISOString() ?? null;

export function invoiceSummary(i: InvoiceListItem) {
  return {
    object: "invoice" as const,
    id: i.id,
    type: i.docType,
    number: i.number,
    status: i.status,
    client_name: i.clientName,
    issue_date: i.issueDate,
    due_date: i.dueDate,
    currency: i.currency,
    total: i.total,
    amount_due: i.amountDue,
  };
}

export function invoiceResource(d: InvoiceDetail) {
  const i = d.invoice;
  return {
    object: "invoice" as const,
    id: i.id,
    type: i.docType,
    number: i.number,
    status: d.status,
    client_id: i.clientId,
    business_profile_id: i.businessProfileId,
    issue_date: i.issueDate,
    supply_date: i.supplyDate,
    due_date: i.dueDate,
    currency: i.currency,
    language: i.language,
    reference: i.reference,
    lines: d.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: dec(l.quantity),
      unit: l.unit,
      unit_price: dec(l.unitPrice),
      discount_percent: dec(l.discountPercent),
      tax_category: l.taxCategory,
      tax_rate: dec(l.taxRate),
      net: l.net,
    })),
    subtotal: i.lineNetTotal,
    discount_total: i.discountTotal,
    tax_total: i.taxTotal,
    total: i.total,
    amount_paid: i.amountPaid,
    amount_credited: i.creditedAmount,
    amount_due: i.status === "open" ? Math.max(0, i.total - i.amountPaid - i.creditedAmount) : 0,
    tax_breakdown: i.taxBreakdown,
    notes: i.notes,
    terms: i.terms,
    corrects_invoice_id: i.correctsInvoiceId,
    payments: d.payments.map((p) => ({
      id: p.id,
      amount: p.amount - p.refundedAmount,
      currency: p.currency,
      method: p.method,
      received_on: p.receivedOn,
    })),
    issued_at: iso(i.issuedAt),
    sent_at: iso(i.sentAt),
    viewed_at: iso(i.viewedAt),
    paid_at: iso(i.paidAt),
    created_at: iso(i.createdAt),
  };
}

export function clientResource(c: ClientRow) {
  return {
    object: "client" as const,
    id: c.id,
    name: c.name,
    contact_name: c.contactName,
    emails: c.emails,
    phone: c.phone,
    address: c.address,
    is_business: c.isBusiness,
    vat_id: c.vatId,
    vat_id_verified: c.vatIdVerifiedAt !== null,
    tax_id: c.taxId,
    currency: c.currency,
    payment_terms_days: c.paymentTermsDays,
    language: c.language,
    buyer_reference: c.buyerReference,
    status: c.status,
    created_at: iso(c.createdAt),
  };
}
