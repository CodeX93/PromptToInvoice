import "server-only";
import { z } from "zod";
import {
  amountDue,
  assertCan,
  diffDays,
  emailSchema,
  formatDate,
  formatMoney,
  isCurrencyCode,
  todayIn,
} from "@pti/core";
import { eq, schema, sql, withOrg } from "@pti/db";
import { db } from "../db";
import { env } from "../env";
import { audit } from "../audit";
import { ValidationError } from "../errors";
import { enforce, RULES } from "../rate-limit";
import { authorize, type OrgContext } from "../session";
import { sendEmail } from "../email/transport";
import {
  invoiceEmail,
  receiptEmail,
  reminderEmail,
  type InvoiceEmailArgs,
} from "../email/templates";
import { enqueue } from "../jobs/queue";
import { pdfFor, publicUrl } from "../documents/service";
import { labelsFor, localeFor } from "../documents/labels";
import { getInvoice } from "./invoices";
import { consume } from "./usage";

export const sendSchema = z.object({
  to: z.array(emailSchema).min(1, "Add at least one recipient.").max(5),
  cc: z.array(emailSchema).max(5).default([]),
  message: z.string().trim().max(2000).default(""),
});
export type SendInput = z.input<typeof sendSchema>;

/**
 * Queue an invoice email. Writes an outbox row first (so the UI shows
 * "queued" immediately and nothing is lost if the process dies), then
 * enqueues delivery. Idempotent per email row.
 */
export async function queueInvoiceEmail(
  ctx: OrgContext,
  invoiceId: string,
  raw: SendInput,
): Promise<{ emailId: string }> {
  authorize(ctx, "invoice:send");
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      "Check the recipients.",
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
    );
  const input = parsed.data;
  await enforce(`send:${ctx.org.id}`, RULES.sendEmail);
  const d = await getInvoice(ctx, invoiceId);
  assertCan(d.invoice, "send");

  const emailId = crypto.randomUUID();
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx.insert(schema.emailMessages).values({
      id: emailId,
      orgId: ctx.org.id,
      invoiceId,
      kind: d.invoice.docType === "credit_note" ? "credit_note" : "invoice",
      to: input.to,
      cc: input.cc,
      subject: `${d.invoice.docType === "credit_note" ? "Credit note" : "Invoice"} ${d.invoice.number ?? ""}`,
      provider: env.EMAIL_PROVIDER,
      status: "queued",
      sentBy: ctx.user.id,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "invoice.send_queued",
      entityType: "invoice",
      entityId: invoiceId,
      diff: { to: input.to, cc: input.cc },
    });
  });
  await enqueue(
    "invoice.send",
    {
      orgId: ctx.org.id,
      invoiceId,
      actorId: ctx.user.id,
      to: input.to,
      cc: input.cc,
      message: input.message,
      emailId,
    },
    { singletonKey: emailId },
  );
  return { emailId };
}

async function senderInfo(orgId: string, profileId: string) {
  const [p] = await withOrg(db, orgId, (tx) =>
    tx
      .select({
        name: sql<string>`coalesce(${schema.businessProfiles.tradingName}, ${schema.businessProfiles.legalName})`,
        email: schema.businessProfiles.email,
      })
      .from(schema.businessProfiles)
      .where(eq(schema.businessProfiles.id, profileId)),
  );
  return p ?? { name: "", email: null };
}

function emailArgs(
  d: Awaited<ReturnType<typeof getInvoice>>,
  seller: { name: string; email: string | null },
  message: string,
): InvoiceEmailArgs {
  const inv = d.invoice;
  const currency = isCurrencyCode(inv.currency) ? inv.currency : "EUR";
  const locale = localeFor(inv.language, inv.issuedSnapshot?.seller.address.country);
  const L = labelsFor(inv.language);
  const due = inv.docType === "invoice" ? amountDue(inv) : Math.abs(inv.total);
  return {
    businessName: seller.name,
    clientName:
      inv.issuedSnapshot?.buyer.contactName ??
      inv.issuedSnapshot?.buyer.name ??
      d.client?.name ??
      "",
    docLabel: inv.docType === "credit_note" ? "Credit note" : "Invoice",
    number: inv.number ?? L.draft,
    amount: formatMoney(due, currency, locale),
    dueDate: inv.dueDate ? formatDate(inv.dueDate, locale) : null,
    url: publicUrl(inv.publicToken) ?? env.APP_URL,
    message,
    replyTo: seller.email,
  };
}

/** Worker side of "invoice.send": render, attach, deliver, record. */
export async function deliverInvoiceEmail(
  ctx: OrgContext,
  p: { invoiceId: string; to: string[]; cc: string[]; message: string; emailId: string },
): Promise<void> {
  const [row] = await withOrg(db, ctx.org.id, (tx) =>
    tx
      .select({ status: schema.emailMessages.status })
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.id, p.emailId)),
  );
  if (row && row.status !== "queued" && row.status !== "failed") return; // already delivered (retry after success)
  const d = await getInvoice(ctx, p.invoiceId);
  const seller = await senderInfo(ctx.org.id, d.invoice.businessProfileId);
  const { pdf, fileName } = await pdfFor(ctx, p.invoiceId);
  const t = invoiceEmail(emailArgs(d, seller, p.message));
  try {
    const res = await sendEmail({
      to: p.to,
      cc: p.cc,
      replyTo: seller.email ?? undefined,
      ...t,
      attachments: [{ filename: fileName, content: pdf, contentType: "application/pdf" }],
      messageId: p.emailId,
      tag: "invoice",
    });
    await withOrg(db, ctx.org.id, async (tx) => {
      await tx
        .update(schema.emailMessages)
        .set({
          status: "sent",
          provider: res.provider,
          providerMessageId: res.providerMessageId,
          subject: t.subject,
          error: null,
        })
        .where(eq(schema.emailMessages.id, p.emailId));
      await tx
        .update(schema.invoices)
        .set({ sentAt: sql`coalesce(${schema.invoices.sentAt}, now())` })
        .where(eq(schema.invoices.id, p.invoiceId));
      await tx
        .insert(schema.invoiceEvents)
        .values({
          orgId: ctx.org.id,
          invoiceId: p.invoiceId,
          type: "sent",
          actorId: ctx.user.id,
          data: { to: p.to, cc: p.cc, emailId: p.emailId },
        });
      await consume(tx, ctx.org.id, ctx.org.plan, "emails_sent");
    });
  } catch (err) {
    await withOrg(db, ctx.org.id, (tx) =>
      tx
        .update(schema.emailMessages)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message.slice(0, 500) : "send failed",
        })
        .where(eq(schema.emailMessages.id, p.emailId)),
    );
    throw err; // let the queue retry with backoff
  }
}

/** Payment reminder for an open invoice (worker side). Returns false if no longer applicable. */
export async function deliverReminder(
  ctx: OrgContext,
  invoiceId: string,
  offset: number,
): Promise<boolean> {
  const d = await getInvoice(ctx, invoiceId);
  const inv = d.invoice;
  const to = d.client?.emails ?? [];
  if (inv.status !== "open" || inv.docType !== "invoice" || !inv.dueDate || to.length === 0)
    return false;
  if (
    d.events.some(
      (e) => e.type === "reminder_sent" && (e.data as { offset?: number }).offset === offset,
    )
  )
    return false;
  const seller = await senderInfo(ctx.org.id, inv.businessProfileId);
  const today = todayIn(ctx.org.timeZone);
  const t = reminderEmail({
    ...emailArgs(d, seller, ""),
    daysOverdue: Math.max(0, diffDays(today, inv.dueDate)),
  });
  const { pdf, fileName } = await pdfFor(ctx, invoiceId);
  const res = await sendEmail({
    to,
    replyTo: seller.email ?? undefined,
    ...t,
    attachments: [{ filename: fileName, content: pdf, contentType: "application/pdf" }],
    tag: "reminder",
  });
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx
      .insert(schema.emailMessages)
      .values({
        orgId: ctx.org.id,
        invoiceId,
        kind: "reminder",
        to,
        subject: t.subject,
        provider: res.provider,
        providerMessageId: res.providerMessageId,
        status: "sent",
        sentBy: null,
      });
    await tx
      .update(schema.invoices)
      .set({ lastReminderAt: new Date(), reminderCount: sql`${schema.invoices.reminderCount} + 1` })
      .where(eq(schema.invoices.id, invoiceId));
    await tx
      .insert(schema.invoiceEvents)
      .values({ orgId: ctx.org.id, invoiceId, type: "reminder_sent", data: { offset, to } });
    await consume(tx, ctx.org.id, ctx.org.plan, "emails_sent");
  });
  return true;
}

/** Receipt to the client after an online payment. Best effort. */
export async function deliverReceipt(
  ctx: OrgContext,
  invoiceId: string,
  amountMinor: number,
): Promise<void> {
  const d = await getInvoice(ctx, invoiceId);
  const to = d.client?.emails ?? [];
  if (!to.length) return;
  const seller = await senderInfo(ctx.org.id, d.invoice.businessProfileId);
  const currency = isCurrencyCode(d.invoice.currency) ? d.invoice.currency : "EUR";
  const t = receiptEmail({
    businessName: seller.name,
    clientName: d.client?.name ?? "",
    number: d.invoice.number ?? "",
    amount: formatMoney(amountMinor, currency, localeFor(d.invoice.language)),
    url: publicUrl(d.invoice.publicToken) ?? env.APP_URL,
  });
  await sendEmail({ to, replyTo: seller.email ?? undefined, ...t, tag: "receipt" });
}

/** For invoices delivered outside the app (client portal, by hand): record the send without emailing. */
export async function markSent(ctx: OrgContext, invoiceId: string): Promise<void> {
  authorize(ctx, "invoice:send");
  const d = await getInvoice(ctx, invoiceId);
  assertCan(d.invoice, "send");
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx
      .update(schema.invoices)
      .set({ sentAt: sql`coalesce(${schema.invoices.sentAt}, now())` })
      .where(eq(schema.invoices.id, invoiceId));
    await tx
      .insert(schema.invoiceEvents)
      .values({
        orgId: ctx.org.id,
        invoiceId,
        type: "sent",
        actorId: ctx.user.id,
        data: { manual: true },
      });
  });
}
