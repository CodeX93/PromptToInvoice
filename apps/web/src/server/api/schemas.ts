import "server-only";
import {
  currencySchema,
  emailSchema,
  isoDateSchema,
  percentSchema,
  quantitySchema,
  taxCategorySchema,
  unitPriceSchema,
} from "@pti/core";
import { z } from "zod";

/**
 * Public API request schemas (snake_case, like the responses). They are the
 * single source for both validation and the published OpenAPI document, so
 * docs can't drift from behaviour.
 */

export const apiLine = z.object({
  description: z.string().trim().min(1).max(2000).describe("What was delivered."),
  quantity: quantitySchema.describe('Decimal string, e.g. "1.5".'),
  unit: z.string().trim().max(20).default("").describe('Free text, e.g. "hour" or "day".'),
  unit_price: unitPriceSchema.describe('Net price per unit as a decimal string, e.g. "650.00".'),
  discount_percent: percentSchema.nullish(),
  tax_category: taxCategorySchema
    .optional()
    .describe("EN 16931 VAT category (S, Z, E, AE, K, G, O). Defaults to the org's default rate."),
  tax_rate: percentSchema.optional().describe('Percent as a decimal string, e.g. "19".'),
});

export const apiInvoiceCreate = z.object({
  client_id: z.uuid().nullish(),
  business_profile_id: z.uuid().optional().describe("Defaults to the organisation's profile."),
  currency: currencySchema
    .optional()
    .describe("Defaults to the client's or the profile's currency."),
  issue_date: isoDateSchema.optional(),
  supply_date: isoDateSchema.nullish(),
  due_date: isoDateSchema.nullish().describe("Defaults to the client's payment terms."),
  language: z.string().min(2).max(10).optional(),
  reference: z.string().trim().max(100).default(""),
  notes: z.string().trim().max(4000).optional(),
  terms: z.string().trim().max(4000).optional(),
  discount: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("percent"), value: percentSchema }),
      z.object({ type: z.literal("amount"), value: unitPriceSchema }),
    ])
    .nullish(),
  lines: z.array(apiLine).min(1).max(500),
});
export type ApiInvoiceCreate = z.infer<typeof apiInvoiceCreate>;

export const apiInvoiceList = z.object({
  status: z
    .enum(["all", "draft", "outstanding", "overdue", "paid", "void", "quotes"])
    .default("all"),
  client_id: z.uuid().optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const apiSend = z.object({
  to: z.array(emailSchema).min(1).max(5).optional().describe("Defaults to the client's emails."),
  cc: z.array(emailSchema).max(5).default([]),
  message: z.string().trim().max(2000).default(""),
});

export const apiClientCreate = z.object({
  name: z.string().trim().min(1).max(160),
  contact_name: z.string().trim().max(120).nullish(),
  emails: z.array(emailSchema).max(5).default([]),
  phone: z.string().trim().max(40).nullish(),
  address: z
    .object({
      line1: z.string().max(200),
      line2: z.string().max(200).optional(),
      city: z.string().max(100),
      postal_code: z.string().max(20).optional(),
      region: z.string().max(100).optional(),
      country: z.string().length(2).describe("ISO 3166-1 alpha-2."),
    })
    .nullish(),
  is_business: z.boolean().default(true),
  vat_id: z.string().trim().max(40).nullish(),
  tax_id: z.string().trim().max(40).nullish(),
  currency: currencySchema.nullish(),
  payment_terms_days: z.number().int().min(0).max(365).nullish(),
  language: z.string().max(10).nullish(),
  buyer_reference: z.string().max(100).nullish(),
});

export const apiClientList = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(["active", "archived"]).default("active"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const apiDraftCreate = z.object({
  prompt: z
    .string()
    .trim()
    .min(3)
    .max(4000)
    .describe(
      'Plain-language description, e.g. "3 days of design for Acme GmbH at €650/day, net 14".',
    ),
});

export function queryOf(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams);
}
