import "server-only";
import { hasFeature } from "@pti/core";
import { eq, schema, withOrg } from "@pti/db";
import { db } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import type { OrgContext } from "../session";
import { getInvoice, type InvoiceDetail } from "../services/invoices";
import { readBlob, storeFile } from "../storage";
import { buildDocModel, type InvoiceDocModel } from "./model";
import { renderInvoicePdf, type PdfAttachment } from "./pdf";

/** Years to retain issued documents (max across our markets: FR/DE 10). */
const RETENTION_YEARS = 10;

export function fileNameFor(m: Pick<InvoiceDocModel, "title" | "number">): string {
  return `${m.title}-${m.number}`.replace(/[^\w.-]+/g, "_") + ".pdf";
}

async function loadProfile(orgId: string, profileId: string) {
  const [p] = await withOrg(db, orgId, (tx) =>
    tx.select().from(schema.businessProfiles).where(eq(schema.businessProfiles.id, profileId)),
  );
  if (!p) throw new Error("profile missing");
  return p;
}

async function loadLogo(orgId: string, fileId: string | null): Promise<Buffer | null> {
  if (!fileId) return null;
  const [f] = await withOrg(db, orgId, (tx) =>
    tx
      .select({ key: schema.files.storageKey })
      .from(schema.files)
      .where(eq(schema.files.id, fileId)),
  );
  return f ? readBlob(f.key).catch(() => null) : null;
}

export function publicUrl(token: string | null): string | null {
  return token ? `${env.APP_URL}/i/${token}` : null;
}

export async function modelFor(ctx: OrgContext, detail: InvoiceDetail): Promise<InvoiceDocModel> {
  const profile = await loadProfile(ctx.org.id, detail.invoice.businessProfileId);
  return buildDocModel(detail, profile, { payUrl: publicUrl(detail.invoice.publicToken), customBranding: hasFeature(ctx.org.plan, "custom_branding") });
}

/** Hook for the e-invoice module to add XML + XMP to the archived PDF (set in M8). */
export type EinvoiceDecorator = (
  detail: InvoiceDetail,
  model: InvoiceDocModel,
) => Promise<{ attachments: PdfAttachment[]; xmpExtension?: string } | null>;
let decorate: EinvoiceDecorator | null = null;
export function registerEinvoiceDecorator(fn: EinvoiceDecorator): void {
  decorate = fn;
}

export async function renderFor(
  ctx: OrgContext,
  detail: InvoiceDetail,
): Promise<{ pdf: Buffer; model: InvoiceDocModel }> {
  const model = await modelFor(ctx, detail);
  const extra =
    detail.invoice.status !== "draft" && decorate ? await decorate(detail, model) : null;
  const pdf = await renderInvoicePdf(model, {
    logo: await loadLogo(ctx.org.id, model.logoFileId),
    paper: detail.invoice.issuedSnapshot?.seller.address.country === "US" ? "LETTER" : "A4",
    attachments: extra?.attachments,
    xmpExtension: extra?.xmpExtension,
  });
  return { pdf, model };
}

/**
 * Render and archive the PDF of an issued document. Idempotent: the DB
 * trigger lets pdf_sha256 be set once, so a second call is a no-op.
 */
export async function archivePdf(ctx: OrgContext, invoiceId: string): Promise<void> {
  const detail = await getInvoice(ctx, invoiceId);
  if (detail.invoice.status === "draft" || detail.invoice.pdfSha256) return;
  const { pdf, model } = await renderFor(ctx, detail);
  const retainUntil = new Date();
  retainUntil.setFullYear(retainUntil.getFullYear() + RETENTION_YEARS);
  await withOrg(db, ctx.org.id, async (tx) => {
    const stored = await storeFile(tx, {
      orgId: ctx.org.id,
      kind: "invoice_pdf",
      body: pdf,
      contentType: "application/pdf",
      fileName: fileNameFor(model),
      retainUntil,
    });
    await tx
      .update(schema.invoices)
      .set({ pdfFileId: stored.id, pdfSha256: stored.sha256 })
      .where(eq(schema.invoices.id, invoiceId));
    await tx.insert(schema.invoiceEvents).values({
      orgId: ctx.org.id,
      invoiceId,
      type: "pdf_rendered",
      data: { sha256: stored.sha256, bytes: stored.size },
    });
  });
  logger.info({ invoiceId, bytes: pdf.length }, "invoice PDF archived");
}

/**
 * The PDF for download/attachment. Issued documents always serve the
 * archived bytes (what the client received); drafts render on demand.
 */
export async function pdfFor(
  ctx: OrgContext,
  invoiceId: string,
): Promise<{ pdf: Buffer; fileName: string }> {
  let detail = await getInvoice(ctx, invoiceId);
  if (detail.invoice.status !== "draft" && !detail.invoice.pdfFileId) {
    await archivePdf(ctx, invoiceId);
    detail = await getInvoice(ctx, invoiceId);
  }
  if (detail.invoice.pdfFileId) {
    const [f] = await withOrg(db, ctx.org.id, (tx) =>
      tx
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, detail.invoice.pdfFileId ?? "")),
    );
    if (f) return { pdf: await readBlob(f.storageKey), fileName: f.fileName };
  }
  const { pdf, model } = await renderFor(ctx, detail);
  return { pdf, fileName: fileNameFor(model) };
}
