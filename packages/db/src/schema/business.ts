import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Address } from "@pti/core";
import { createdAt, id, orgId, updatedAt } from "./_shared";

export interface BankDetails {
  accountHolder?: string;
  iban?: string;
  bic?: string;
  /** US ACH */
  routingNumber?: string;
  accountNumber?: string;
  bankName?: string;
}

export interface Branding {
  accentColor?: string;
  template?: "ledger" | "classic" | "modern";
  showLogo?: boolean;
  footer?: string;
}

/** A legal entity that issues invoices. One org can own several (agencies). */
export const businessProfiles = pgTable(
  "business_profiles",
  {
    id: id(),
    orgId: orgId(),
    legalName: text("legal_name").notNull(),
    tradingName: text("trading_name"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    address: jsonb("address").$type<Address>().notNull(),
    vatId: text("vat_id"),
    taxId: text("tax_id"),
    registrationNumber: text("registration_number"),
    /** Small-business VAT exemption (e.g. DE §19 UStG). */
    vatExempt: boolean("vat_exempt").notNull().default(false),
    vatExemptNote: text("vat_exempt_note"),
    defaultCurrency: text("default_currency").notNull().default("EUR"),
    defaultPaymentTermsDays: integer("default_payment_terms_days").notNull().default(14),
    defaultNotes: text("default_notes").notNull().default(""),
    defaultTerms: text("default_terms").notNull().default(""),
    locale: text("locale").notNull().default("en"),
    logoFileId: uuid("logo_file_id"),
    /** Encrypted at the application layer (envelope encryption); never queried. */
    bankDetailsEncrypted: text("bank_details_encrypted"),
    branding: jsonb("branding").$type<Branding>().notNull().default({}),
    stripeAccountId: text("stripe_account_id"),
    stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("business_profiles_org_idx").on(t.orgId),
    uniqueIndex("business_profiles_one_default_uq")
      .on(t.orgId)
      .where(sql`${t.isDefault} and ${t.archivedAt} is null`),
    uniqueIndex("business_profiles_stripe_uq").on(t.stripeAccountId),
  ],
);

export const DOC_TYPES = ["invoice", "credit_note", "quote"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Per profile and document type: the number pattern and reset policy. */
export const numberSeries = pgTable(
  "number_series",
  {
    id: id(),
    orgId: orgId(),
    businessProfileId: uuid("business_profile_id")
      .notNull()
      .references(() => businessProfiles.id, { onDelete: "cascade" }),
    docType: text("doc_type").$type<DocType>().notNull(),
    pattern: text("pattern").notNull(),
    resetPolicy: text("reset_policy").$type<"never" | "yearly" | "monthly">().notNull().default("yearly"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("number_series_profile_type_uq").on(t.businessProfileId, t.docType)],
);

/**
 * Counter rows per series and reset period. Allocation takes a row lock
 * (`UPDATE … RETURNING`) in the same transaction that issues the document, so
 * numbers are gap-free and never reused.
 */
export const numberCounters = pgTable(
  "number_counters",
  {
    seriesId: uuid("series_id")
      .notNull()
      .references(() => numberSeries.id, { onDelete: "cascade" }),
    orgId: orgId(),
    periodKey: text("period_key").notNull(),
    lastValue: bigint("last_value", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.periodKey] }),
    check("number_counters_nonneg", sql`${t.lastValue} >= 0`),
  ],
);

export const clients = pgTable(
  "clients",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    /** Primary contact person, printed as "Attn:". */
    contactName: text("contact_name"),
    emails: text("emails").array().notNull().default(sql`'{}'::text[]`),
    phone: text("phone"),
    address: jsonb("address").$type<Address>(),
    isBusiness: boolean("is_business").notNull().default(true),
    vatId: text("vat_id"),
    vatIdVerifiedAt: timestamp("vat_id_verified_at", { withTimezone: true }),
    vatIdVerifiedName: text("vat_id_verified_name"),
    taxId: text("tax_id"),
    currency: text("currency"),
    paymentTermsDays: integer("payment_terms_days"),
    language: text("language"),
    /** Buyer reference / PO / Leitweg-ID for XRechnung. */
    buyerReference: text("buyer_reference"),
    notes: text("notes").notNull().default(""),
    status: text("status").$type<"active" | "pending" | "archived">().notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("clients_org_name_idx").on(t.orgId, t.name),
    // Trigram index for fuzzy matching ("acme" -> "ACME Corp GmbH") used by the AI resolver and search.
    index("clients_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

export const taxRates = pgTable(
  "tax_rates",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    rate: numeric("rate", { precision: 7, scale: 4 }).notNull(),
    country: text("country"),
    note: text("note"),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tax_rates_org_idx").on(t.orgId)],
);

/** Saved products/services; also feeds the AI with the user's usual rates. */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    unit: text("unit").notNull().default(""),
    unitPrice: numeric("unit_price", { precision: 20, scale: 6 }).notNull(),
    currency: text("currency").notNull(),
    taxRateId: uuid("tax_rate_id").references(() => taxRates.id, { onDelete: "set null" }),
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("catalog_items_org_idx").on(t.orgId, t.lastUsedAt),
    index("catalog_items_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);
