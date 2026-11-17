import "server-only";
import { parseEuVatId, type TaxCategory } from "@pti/core";
import { can, type OrgContext } from "../session";
import { countryOptions } from "@/lib/countries";
import { blankLine, newKey, type EditorState } from "@/lib/invoice-editor";
import type { InvoiceEditorProps } from "@/components/invoices/invoice-editor";
import type { ClientOption } from "@/app/app/clients/actions";
import { draftDefaults, type InvoiceDetail } from "./invoices";
import { listTaxRates } from "./tax-rates";
import { getClient } from "./clients";

function toOption(c: NonNullable<InvoiceDetail["client"]>): ClientOption {
  return {
    id: c.id,
    name: c.name,
    email: c.emails[0] ?? null,
    country: c.address?.country ?? null,
    vatId: c.vatId,
    isBusiness: c.isBusiness,
    vatIdValid: Boolean(c.vatId && (c.vatIdVerifiedAt || parseEuVatId(c.vatId))),
    currency: c.currency,
    paymentTermsDays: c.paymentTermsDays,
  };
}

const strip = (n: string | null) => (n === null ? "" : String(Number(n)) === "NaN" ? n : n.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""));

/** Everything the editor needs, for a new draft (detail = null) or an existing one. */
export async function editorProps(
  ctx: OrgContext,
  detail: InvoiceDetail | null,
  opts: { clientId?: string | null; overrides?: Partial<EditorState>; aiFields?: string[]; aiNotes?: string[] } = {},
): Promise<InvoiceEditorProps> {
  const [defaults, rates] = await Promise.all([draftDefaults(ctx, detail?.invoice.clientId ?? opts.clientId), listTaxRates(ctx)]);
  const p = defaults.profile;
  const taxRates = rates.map((r) => ({ id: r.id, name: r.name, category: r.category as TaxCategory, rate: String(Number(r.rate)) }));

  let initial: EditorState;
  if (detail) {
    const i = detail.invoice;
    initial = {
      businessProfileId: i.businessProfileId,
      client: detail.client ? toOption(detail.client) : null,
      currency: defaults.currency && i.currency ? (i.currency as EditorState["currency"]) : defaults.currency,
      issueDate: i.issueDate,
      supplyDate: i.supplyDate ?? "",
      dueDate: i.dueDate ?? "",
      language: i.language,
      reference: i.reference,
      lines: detail.lines.map((l) => ({
        key: newKey(),
        description: l.description,
        quantity: strip(l.quantity),
        unit: l.unit,
        unitPrice: strip(l.unitPrice),
        discountPercent: strip(l.discountPercent),
        taxCategory: l.taxCategory as TaxCategory,
        taxRate: strip(l.taxRate),
      })),
      discount: i.discountType && i.discountValue ? { type: i.discountType, value: strip(i.discountValue) } : null,
      notes: i.notes,
      terms: i.terms,
      taxNote: i.taxNote,
    };
  } else {
    const client = opts.clientId ? await getClient(ctx, opts.clientId).catch(() => null) : null;
    initial = {
      businessProfileId: p.id,
      client: client ? toOption(client) : null,
      currency: defaults.currency,
      issueDate: defaults.issueDate,
      supplyDate: "",
      dueDate: defaults.dueDate,
      language: client?.language ?? p.locale,
      reference: "",
      lines: [blankLine(defaults.taxCategory, defaults.taxRate)],
      discount: null,
      notes: defaults.notes,
      terms: defaults.terms,
      taxNote: "",
      ...opts.overrides,
    };
  }

  return {
    id: detail?.invoice.id ?? null,
    version: detail?.invoice.version ?? 0,
    docType: detail?.invoice.docType ?? "invoice",
    initial,
    seller: { name: p.tradingName ?? p.legalName, country: p.address.country, vatExempt: p.vatExempt, defaultTermsDays: p.defaultPaymentTermsDays },
    taxRates,
    countries: countryOptions(),
    aiFields: opts.aiFields,
    aiNotes: opts.aiNotes,
    canIssue: can(ctx, "invoice:issue"),
  };
}
