import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId, updatedAt } from "./_shared";
import { users } from "./auth";
import { invoices } from "./invoices";

/** Metadata for objects in blob storage (logos, PDFs, e-invoices, exports). */
export const files = pgTable(
  "files",
  {
    id: id(),
    orgId: orgId(),
    kind: text("kind")
      .$type<"logo" | "invoice_pdf" | "einvoice_xml" | "export" | "attachment">()
      .notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    fileName: text("file_name").notNull(),
    /** Retention: legal hold (issued invoices) blocks deletion until this date. */
    retainUntil: timestamp("retain_until", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("files_storage_key_uq").on(t.storageKey),
    index("files_org_kind_idx").on(t.orgId, t.kind),
  ],
);

/** Outbound email log with provider delivery status. */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    kind: text("kind").$type<"invoice" | "reminder" | "receipt" | "credit_note">().notNull(),
    to: text("to").array().notNull(),
    cc: text("cc")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    subject: text("subject").notNull(),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    status: text("status")
      .$type<"queued" | "sent" | "delivered" | "opened" | "bounced" | "complained" | "failed">()
      .notNull()
      .default("queued"),
    error: text("error"),
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("email_messages_invoice_idx").on(t.invoiceId),
    uniqueIndex("email_messages_provider_uq").on(t.provider, t.providerMessageId),
  ],
);

/** Append-only audit trail for security- and compliance-relevant actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    orgId: uuid("org_id"),
    actorId: uuid("actor_id"),
    actorType: text("actor_type")
      .$type<"user" | "system" | "api_key" | "webhook">()
      .notNull()
      .default("user"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    diff: jsonb("diff").$type<Record<string, unknown>>(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_org_time_idx").on(t.orgId, t.createdAt.desc()),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Every AI draft request — powers quality metrics, cost tracking and debugging. */
export const aiDrafts = pgTable(
  "ai_drafts",
  {
    id: id(),
    orgId: orgId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    prompt: text("prompt").notNull(),
    model: text("model").notNull(),
    requestId: text("request_id"),
    output: jsonb("output").$type<Record<string, unknown>>(),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    status: text("status").$type<"ok" | "invalid" | "refused" | "error">().notNull(),
    error: text("error"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    /** Set when the user saved the draft; editDistance measures how much they changed. */
    acceptedInvoiceId: uuid("accepted_invoice_id"),
    editedFields: jsonb("edited_fields").$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_drafts_org_time_idx").on(t.orgId, t.createdAt.desc())],
);

/** Monthly usage counters for plan quotas. */
export const usageCounters = pgTable(
  "usage_counters",
  {
    orgId: orgId(),
    /** "2026-11" */
    period: text("period").notNull(),
    invoicesIssued: integer("invoices_issued").notNull().default(0),
    aiDrafts: integer("ai_drafts").notNull().default(0),
    emailsSent: integer("emails_sent").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.period] })],
);

/** Our own SaaS subscription state, mirrored from Stripe webhooks. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    orgId: uuid("org_id").primaryKey(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    plan: text("plan").notNull().default("starter"),
    status: text("status").notNull().default("inactive"),
    interval: text("interval").$type<"month" | "year">(),
    extraSeats: integer("extra_seats").notNull().default(0),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("subscriptions_customer_uq").on(t.stripeCustomerId),
    uniqueIndex("subscriptions_sub_uq").on(t.stripeSubscriptionId),
  ],
);

/** Webhook idempotency: an event id is processed at most once. */
export const processedWebhooks = pgTable("processed_webhooks", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Fixed-window rate limiting without Redis. Rows are tiny and pruned by a job. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/** Idempotency keys for mutating API requests. */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    orgId: orgId(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);
