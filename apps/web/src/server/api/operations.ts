import "server-only";
import { createClient, getClient, listClients, type ClientInput } from "../services/clients";
import { draftDefaults, getInvoice, saveDraft } from "../services/invoices";
import type { ApiContext } from "./handler";
import type { z } from "zod";
import type { ApiInvoiceCreate, apiClientCreate } from "./schemas";

/**
 * Map an API create request onto the same draft path the editor uses, so
 * the API gets identical validation, tax and totals logic. Omitted fields
 * take the organisation's defaults (profile, currency, terms, tax rate).
 */
export async function createInvoiceFromApi(ctx: ApiContext, b: ApiInvoiceCreate) {
  const d = await draftDefaults(ctx, b.client_id ?? null);
  const issueDate = b.issue_date ?? d.issueDate;
  const { id } = await saveDraft(
    ctx,
    null,
    {
      businessProfileId: b.business_profile_id ?? d.profile.id,
      clientId: b.client_id ?? null,
      currency: b.currency ?? d.currency,
      issueDate,
      supplyDate: b.supply_date ?? null,
      dueDate:
        b.due_date === undefined ? (issueDate === d.issueDate ? d.dueDate : null) : b.due_date,
      language: b.language ?? d.language,
      reference: b.reference,
      notes: b.notes ?? d.notes,
      terms: b.terms ?? d.terms,
      taxNote: "",
      discount: b.discount ?? null,
      lines: b.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unit_price,
        discountPercent: l.discount_percent ?? null,
        taxCategory: l.tax_category ?? d.taxCategory,
        taxRate:
          l.tax_rate ?? (l.tax_category && l.tax_category !== d.taxCategory ? "0" : d.taxRate),
      })),
    },
    { source: "api" },
  );
  return getInvoice(ctx, id);
}

export async function createClientFromApi(ctx: ApiContext, b: z.infer<typeof apiClientCreate>) {
  const input: ClientInput = {
    name: b.name,
    contactName: b.contact_name ?? null,
    emails: b.emails,
    phone: b.phone ?? null,
    address: b.address
      ? {
          line1: b.address.line1,
          line2: b.address.line2 ?? "",
          city: b.address.city,
          region: b.address.region ?? "",
          postalCode: b.address.postal_code ?? "",
          country: b.address.country.toUpperCase(),
        }
      : null,
    isBusiness: b.is_business,
    vatId: b.vat_id ?? null,
    taxId: b.tax_id ?? null,
    currency: b.currency ?? null,
    paymentTermsDays: b.payment_terms_days ?? null,
    language: b.language ?? null,
    buyerReference: b.buyer_reference ?? null,
    notes: "",
  };
  return createClient(ctx, input);
}

export { getClient, listClients };
