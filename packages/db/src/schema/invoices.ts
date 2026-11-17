import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Address, InvoiceStatus, TaxBreakdownEntry } from "@pti/core";
import { createdAt, id, money, orgId, updatedAt } from "./_shared";
import { businessProfiles, catalogItems, clients, numberSeries } from "./business";
import { users } from "./auth";

/** Seller/buyer details frozen at issue time; the PDF and XML are rendered from this. */
export interface IssuedSnapshot {
  seller: {
    legalName: string;
    tradingName: string | null;
    address: Address;
    vatId: string | null;
    taxId: string | null;
    registrationNumber: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    bank: { accountHolder?: string; iban?: string; bic?: string; bankName?: string } | null;
    logoFileId: string | null;
  };
  buyer: {
    name: string;
    contactName: string | null;
    address: Address | null;
    vatId: string | null;
    taxId: string | null;
    email: string | null;
    buyerReference: string | null;
  };
}

export type InvoiceSource = "manual" | "ai" | "recurring" | "api" | "duplicate" | "credit";

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    orgId: orgId(),
    businessProfileId: uuid("business_profile_id")
      .notNull()
      .references(() => businessProfiles.id),
    clientId: uuid("client_id").references(() => clients.id),
    docType: text("doc_type").$type<"invoice" | "credit_note">().notNull().default("invoice"),
    status: text("status").$type<InvoiceStatus>().notNull().default("draft"),
    number: text("number"),
    seriesId: uuid("series_id").references(() => numberSeries.id),
    issueDate: date("issue_date").notNull(),
    supplyDate: date("supply_date"),
    dueDate: date("due_date"),
    currency: text("currency").notNull(),
    language: text("language").notNull().default("en"),
    reference: text("reference").notNull().default(""),
    discountType: text("discount_type").$type<"percent" | "amount">(),
    discountValue: numeric("discount_value", { precision: 20, scale: 6 }),

    lineNetTotal: money("line_net_total").notNull().default(0),
    discountTotal: money("discount_total").notNull().default(0),
    taxExclusive: money("tax_exclusive").notNull().default(0),
    taxTotal: money("tax_total").notNull().default(0),
    total: money("total").notNull().default(0),
    amountPaid: money("amount_paid").notNull().default(0),
    taxBreakdown: jsonb("tax_breakdown").$type<TaxBreakdownEntry[]>().notNull().default([]),
    /** Optional amount in the seller's accounting currency (EU VAT rule for foreign-currency invoices). */
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    fxCurrency: text("fx_currency"),

    notes: text("notes").notNull().default(""),
    terms: text("terms").notNull().default(""),
    taxNote: text("tax_note").notNull().default(""),

    correctsInvoiceId: uuid("corrects_invoice_id"),
    source: text("source").$type<InvoiceSource>().notNull().default("manual"),
    aiDraftId: uuid("ai_draft_id"),
    recurringScheduleId: uuid("recurring_schedule_id"),

    issuedSnapshot: jsonb("issued_snapshot").$type<IssuedSnapshot>(),
    pdfFileId: uuid("pdf_file_id"),
    pdfSha256: text("pdf_sha256"),
    einvoiceFileId: uuid("einvoice_file_id"),
    publicToken: text("public_token"),

    issuedAt: timestamp("issued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    reminderCount: integer("reminder_count").notNull().default(0),

    /** Optimistic concurrency token; bumped on every write. */
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_number_uq")
      .on(t.businessProfileId, t.docType, t.number)
      .where(sql`${t.number} is not null`),
    uniqueIndex("invoices_public_token_uq").on(t.publicToken),
    index("invoices_org_status_due_idx").on(t.orgId, t.status, t.dueDate),
    index("invoices_org_issue_idx").on(t.orgId, t.issueDate.desc(), t.id.desc()),
    index("invoices_client_idx").on(t.clientId, t.issueDate.desc()),
    index("invoices_corrects_idx").on(t.correctsInvoiceId),
    index("invoices_number_trgm_idx").using("gin", sql`${t.number} gin_trgm_ops`),
    check("invoices_status_chk", sql`${t.status} in ('draft','open','paid','void')`),
    check(
      "invoices_issued_has_number_chk",
      sql`(${t.status} = 'draft') = (${t.number} is null)`,
    ),
    check("invoices_paid_nonneg_chk", sql`${t.amountPaid} >= 0`),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    unit: text("unit").notNull().default(""),
    unitPrice: numeric("unit_price", { precision: 20, scale: 6 }).notNull(),
    discountPercent: numeric("discount_percent", { precision: 7, scale: 4 }),
    taxCategory: text("tax_category").notNull(),
    taxRate: numeric("tax_rate", { precision: 7, scale: 4 }).notNull(),
    gross: money("gross").notNull(),
    lineDiscount: money("line_discount").notNull(),
    net: money("net").notNull(),
    catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("invoice_lines_position_uq").on(t.invoiceId, t.position)],
);

export const PAYMENT_METHODS = ["stripe", "bank_transfer", "cash", "check", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    method: text("method").$type<PaymentMethod>().notNull(),
    reference: text("reference").notNull().default(""),
    receivedOn: date("received_on").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeChargeId: text("stripe_charge_id"),
    /** Stripe fee in minor units when known (for net reporting). */
    feeAmount: money("fee_amount"),
    refundedAmount: money("refunded_amount").notNull().default(0),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_invoice_idx").on(t.invoiceId),
    index("payments_org_received_idx").on(t.orgId, t.receivedOn.desc()),
    uniqueIndex("payments_stripe_pi_uq").on(t.stripePaymentIntentId),
    check("payments_amount_pos_chk", sql`${t.amount} > 0`),
    check("payments_refund_chk", sql`${t.refundedAmount} between 0 and ${t.amount}`),
  ],
);

export type InvoiceEventType =
  | "created"
  | "updated"
  | "issued"
  | "sent"
  | "viewed"
  | "reminder_sent"
  | "payment_recorded"
  | "payment_refunded"
  | "paid"
  | "voided"
  | "credited"
  | "email_bounced"
  | "pdf_rendered"
  | "comment";

/** Human-facing timeline of an invoice. Append-only. */
export const invoiceEvents = pgTable(
  "invoice_events",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    type: text("type").$type<InvoiceEventType>().notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_events_invoice_idx").on(t.invoiceId, t.createdAt)],
);

export const recurringSchedules = pgTable(
  "recurring_schedules",
  {
    id: id(),
    orgId: orgId(),
    templateInvoiceId: uuid("template_invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    intervalUnit: text("interval_unit").$type<"week" | "month" | "year">().notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    nextRunOn: date("next_run_on").notNull(),
    endsOn: date("ends_on"),
    remainingRuns: integer("remaining_runs"),
    autoIssue: text("auto_issue").$type<"draft" | "issue" | "issue_and_send">().notNull().default("issue_and_send"),
    status: text("status").$type<"active" | "paused" | "ended">().notNull().default("active"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastInvoiceId: uuid("last_invoice_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("recurring_due_idx").on(t.nextRunOn).where(sql`${t.status} = 'active'`),
    index("recurring_org_idx").on(t.orgId),
    check("recurring_interval_chk", sql`${t.intervalCount} between 1 and 36`),
  ],
);
