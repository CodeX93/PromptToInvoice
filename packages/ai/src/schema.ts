import { z } from "zod";

/**
 * What the model returns. Deliberately loose types (strings for numbers,
 * nullable everything): structured outputs guarantee the *shape*; the
 * server then validates every value and never trusts a number it can't parse.
 */
export const TAX_HINTS = ["standard", "reduced", "zero", "exempt", "reverse_charge", "outside_scope"] as const;

export const draftLineSchema = z.object({
  description: z.string().describe("What was delivered, written as it should appear on the invoice. Concise, professional, no prices."),
  quantity: z.string().describe('Decimal string, e.g. "10", "1.5". Use "1" for flat fees.'),
  unit: z.string().nullable().describe('Short unit if natural: "h", "days", "pcs", "months". Null for flat fees.'),
  unitPrice: z
    .string()
    .nullable()
    .describe('Price per unit in major currency units as a plain decimal string, e.g. "120" or "1200.50". Null if the user did not state it.'),
  discountPercent: z.string().nullable().describe("Line discount percentage if stated, else null."),
  taxHint: z.enum(TAX_HINTS).nullable().describe("Only if the user mentions tax treatment for this line explicitly, else null."),
});

export const draftOutputSchema = z.object({
  client: z.object({
    matchedClientId: z.string().nullable().describe("The id of an existing client from the provided list if the prompt clearly refers to one, else null."),
    name: z.string().nullable().describe("Client name as written by the user, if any."),
    email: z.string().nullable(),
    country: z.string().nullable().describe("ISO 3166-1 alpha-2 country code if stated or obvious from the name (e.g. GmbH → DE is NOT obvious; only use explicit cues)."),
    vatId: z.string().nullable(),
  }),
  currency: z.string().nullable().describe("ISO 4217 code if stated or implied by a currency symbol (€ → EUR, $ → USD, £ → GBP), else null."),
  issueDate: z.string().nullable().describe("YYYY-MM-DD if the user specifies an invoice date, else null."),
  supplyDate: z.string().nullable().describe("YYYY-MM-DD of delivery/service period end, only if stated."),
  dueDate: z.string().nullable().describe("YYYY-MM-DD if an explicit due date is given."),
  paymentTermsDays: z.number().int().nullable().describe('Number of days if given as a term ("net 30", "due in 14 days").'),
  reference: z.string().nullable().describe("PO number or project reference if mentioned."),
  language: z.enum(["en", "de", "fr", "es", "nl", "it"]).nullable().describe("Invoice language only if the user asks for one."),
  lines: z.array(draftLineSchema),
  discount: z
    .object({ type: z.enum(["percent", "amount"]), value: z.string() })
    .nullable()
    .describe("Invoice-level discount if stated."),
  notes: z.string().nullable().describe("A note to print on the invoice only if the user dictated one."),
  copyFromPrevious: z.boolean().describe('True if the user asks to repeat a previous invoice ("same as last month", "like last time").'),
  uncertainFields: z
    .array(z.string())
    .describe('Paths of values you inferred rather than read, e.g. "client", "currency", "lines.0.unitPrice".'),
  assumptions: z.array(z.string()).describe("Short, plain sentences explaining any inference, for the user to check. Empty if none."),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;
export type DraftLineOutput = z.infer<typeof draftLineSchema>;
export type TaxHint = (typeof TAX_HINTS)[number];
