import "server-only";
import { and, eq, schema, sql } from "@pti/db";
import { sysDb } from "../db";
import { systemContext } from "../jobs/system-context";
import type { OrgContext } from "../session";
import { getInvoice, type InvoiceDetail } from "./invoices";

const TOKEN_RE = /^[\w-]{20,40}$/;

/**
 * Resolve a public invoice link. Tokens are 144-bit random values; drafts
 * never have one. Returns null for anything that doesn't resolve.
 */
export async function loadPublicInvoice(token: string): Promise<{ ctx: OrgContext; detail: InvoiceDetail; stripeReady: boolean } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await sysDb
    .select({ id: schema.invoices.id, orgId: schema.invoices.orgId, enabled: schema.businessProfiles.stripeChargesEnabled })
    .from(schema.invoices)
    .innerJoin(schema.businessProfiles, eq(schema.businessProfiles.id, schema.invoices.businessProfileId))
    .where(and(eq(schema.invoices.publicToken, token), sql`${schema.invoices.status} <> 'draft'`))
    .limit(1);
  if (!row) return null;
  const ctx = await systemContext(row.orgId);
  return { ctx, detail: await getInvoice(ctx, row.id), stripeReady: row.enabled };
}

/** First view by someone outside the organisation marks the invoice as viewed. */
export async function recordPublicView(orgId: string, invoiceId: string, viewerUserId: string | null): Promise<void> {
  if (viewerUserId) {
    const [m] = await sysDb.select({ id: schema.members.id }).from(schema.members).where(and(eq(schema.members.organizationId, orgId), eq(schema.members.userId, viewerUserId))).limit(1);
    if (m) return;
  }
  const updated = await sysDb
    .update(schema.invoices)
    .set({ viewedAt: new Date() })
    .where(and(eq(schema.invoices.id, invoiceId), sql`${schema.invoices.viewedAt} is null`))
    .returning({ id: schema.invoices.id });
  if (updated.length) await sysDb.insert(schema.invoiceEvents).values({ orgId, invoiceId, type: "viewed", data: {} });
}
