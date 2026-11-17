import { z } from "zod";
import { CURRENCY_CODES, type CurrencyCode } from "./currency";
import { isDecimalString } from "./decimal";
import { isIsoDate } from "./dates";
import { TAX_CATEGORIES } from "./tax";
import { QUANTITY_SCALE, UNIT_PRICE_SCALE, PERCENT_SCALE } from "./calculate";
import { isValidIban, isValidBic, normalizeIban } from "./banking";
import { parseEuVatId, normalizeVatId } from "./countries";

/**
 * Shared Zod schemas. The same schema validates form input in the browser,
 * request bodies on the server and structured output from the AI model, so a
 * field is defined once.
 */

export const currencySchema = z.enum(CURRENCY_CODES as [CurrencyCode, ...CurrencyCode[]]);

export const isoDateSchema = z.string().refine(isIsoDate, "Use a valid date (YYYY-MM-DD).");

const decimal = (maxScale: number, msg = "Enter a valid number.") =>
  z
    .string()
    .trim()
    .refine((v) => isDecimalString(v, maxScale), msg);

export const quantitySchema = decimal(QUANTITY_SCALE, `Up to ${QUANTITY_SCALE} decimal places.`);
export const unitPriceSchema = decimal(
  UNIT_PRICE_SCALE,
  `Up to ${UNIT_PRICE_SCALE} decimal places.`,
);
export const percentSchema = decimal(PERCENT_SCALE).refine((v) => {
  const n = Number(v);
  return n >= 0 && n <= 100;
}, "Must be between 0 and 100.");

export const taxCategorySchema = z.enum(TAX_CATEGORIES);

export const countryCodeSchema = z
  .string()
  .trim()
  .length(2)
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/));

export const addressSchema = z.object({
  line1: z.string().trim().max(200).default(""),
  line2: z.string().trim().max(200).default(""),
  city: z.string().trim().max(120).default(""),
  region: z.string().trim().max(120).default(""),
  postalCode: z.string().trim().max(20).default(""),
  country: countryCodeSchema,
});
export type Address = z.infer<typeof addressSchema>;

export const euVatIdSchema = z
  .string()
  .trim()
  .transform(normalizeVatId)
  .refine((v) => parseEuVatId(v) !== null, "Not a valid EU VAT number format.");

/** VAT/tax IDs: EU IDs are format-checked, others accepted as free text. */
export const taxIdSchema = z
  .string()
  .trim()
  .max(40)
  .transform((v) => (v ? normalizeVatId(v) : v));

export const ibanSchema = z
  .string()
  .trim()
  .transform(normalizeIban)
  .refine(isValidIban, "Invalid IBAN.");
export const bicSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/\s/g, ""))
  .refine(isValidBic, "Invalid BIC/SWIFT code.");

export const emailSchema = z.email("Enter a valid email address.").trim().toLowerCase().max(254);

export const lineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().min(1, "Describe the item.").max(2000),
  quantity: quantitySchema,
  unit: z.string().trim().max(20).default(""),
  unitPrice: unitPriceSchema,
  discountPercent: percentSchema.nullish(),
  taxCategory: taxCategorySchema,
  taxRate: percentSchema,
});
export type LineItemInput = z.infer<typeof lineItemSchema>;

export const documentDiscountSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("percent"), value: percentSchema }),
    z.object({ type: z.literal("amount"), value: unitPriceSchema }),
  ])
  .nullish();

export const invoiceDraftSchema = z
  .object({
    businessProfileId: z.uuid(),
    clientId: z.uuid().nullable(),
    currency: currencySchema,
    issueDate: isoDateSchema,
    supplyDate: isoDateSchema.nullish(),
    dueDate: isoDateSchema.nullish(),
    language: z.string().min(2).max(10).default("en"),
    reference: z.string().trim().max(100).default(""),
    lines: z.array(lineItemSchema).min(1, "Add at least one line item.").max(500),
    discount: documentDiscountSchema,
    notes: z.string().trim().max(4000).default(""),
    terms: z.string().trim().max(4000).default(""),
    taxNote: z.string().trim().max(1000).default(""),
  })
  .refine((d) => !d.dueDate || d.dueDate >= d.issueDate, {
    path: ["dueDate"],
    message: "Due date can't be before the issue date.",
  });
export type InvoiceDraftInput = z.infer<typeof invoiceDraftSchema>;

export const paginationSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
