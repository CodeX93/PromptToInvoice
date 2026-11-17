import "server-only";
import { z } from "zod";
import { addDays, addMonths, hasFeature, isoDateSchema, todayIn } from "@pti/core";
import { and, eq, lte, one, schema, withOrg } from "@pti/db";
import { db, sysDb } from "../db";
import { audit } from "../audit";
import { ForbiddenError, ValidationError } from "../errors";
import { authorize, type OrgContext } from "../session";
import { duplicateInvoice, getInvoice, issueInvoice, saveDraft } from "./invoices";
import { queueInvoiceEmail } from "./emails";

export const scheduleSchema = z.object({
  intervalUnit: z.enum(["week", "month", "year"]),
  intervalCount: z.coerce.number().int().min(1).max(36),
  startOn: isoDateSchema,
  endsOn: isoDateSchema.nullish(),
  remainingRuns: z.coerce.number().int().min(1).max(500).nullish(),
  autoIssue: z.enum(["draft", "issue", "issue_and_send"]),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export function nextRun(from: string, unit: "week" | "month" | "year", count: number): string {
  switch (unit) {
    case "week":
      return addDays(from, 7 * count);
    case "month":
      return addMonths(from, count);
    case "year":
      return addMonths(from, 12 * count);
  }
}

export async function createSchedule(ctx: OrgContext, templateInvoiceId: string, input: ScheduleInput): Promise<string> {
  authorize(ctx, "invoice:write");
  if (!hasFeature(ctx.org.plan, "recurring")) throw new ForbiddenError("Recurring invoices are part of the Professional plan.");
  const today = todayIn(ctx.org.timeZone);
  if (input.startOn < today) throw new ValidationError("Start on today or later.", { startOn: ["Must not be in the past."] });
  const tpl = await getInvoice(ctx, templateInvoiceId);
  if (tpl.invoice.docType !== "invoice" || !tpl.invoice.clientId) throw new ValidationError("Recurring schedules need an invoice with a client.");
  if (input.autoIssue === "issue_and_send" && !(tpl.client?.emails.length ?? 0)) {
    throw new ValidationError("This client has no billing email. Add one, or choose “Create drafts”.", { autoIssue: ["Client has no email."] });
  }
  return withOrg(db, ctx.org.id, async (tx) => {
    const row = one(
      await tx
        .insert(schema.recurringSchedules)
        .values({ orgId: ctx.org.id, templateInvoiceId, intervalUnit: input.intervalUnit, intervalCount: input.intervalCount, nextRunOn: input.startOn, endsOn: input.endsOn ?? null, remainingRuns: input.remainingRuns ?? null, autoIssue: input.autoIssue, createdBy: ctx.user.id })
        .returning({ id: schema.recurringSchedules.id }),
    );
    await audit(tx, { orgId: ctx.org.id, actorId: ctx.user.id, action: "recurring.created", entityType: "recurring_schedule", entityId: row.id, diff: input });
    return row.id;
  });
}

export async function setScheduleStatus(ctx: OrgContext, id: string, status: "active" | "paused" | "ended"): Promise<void> {
  authorize(ctx, "invoice:write");
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx.update(schema.recurringSchedules).set({ status }).where(eq(schema.recurringSchedules.id, id));
    await audit(tx, { orgId: ctx.org.id, actorId: ctx.user.id, action: `recurring.${status}`, entityType: "recurring_schedule", entityId: id });
  });
}

export async function listSchedules(ctx: OrgContext) {
  return withOrg(db, ctx.org.id, (tx) =>
    tx
      .select({ s: schema.recurringSchedules, clientName: schema.clients.name, number: schema.invoices.number, total: schema.invoices.total, currency: schema.invoices.currency })
      .from(schema.recurringSchedules)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.recurringSchedules.templateInvoiceId))
      .leftJoin(schema.clients, eq(schema.clients.id, schema.invoices.clientId))
      .orderBy(schema.recurringSchedules.nextRunOn),
  );
}

/** Schedules due today or earlier (worker scan, all orgs). */
export async function findDueSchedules(now = new Date()): Promise<{ orgId: string; scheduleId: string; runOn: string }[]> {
  const rows = await sysDb
    .select({ id: schema.recurringSchedules.id, orgId: schema.recurringSchedules.orgId, nextRunOn: schema.recurringSchedules.nextRunOn, tz: schema.organizations.timeZone })
    .from(schema.recurringSchedules)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.recurringSchedules.orgId))
    .where(and(eq(schema.recurringSchedules.status, "active"), lte(schema.recurringSchedules.nextRunOn, now.toISOString().slice(0, 10))));
  return rows.filter((r) => r.nextRunOn <= todayIn(r.tz, now)).map((r) => ({ orgId: r.orgId, scheduleId: r.id, runOn: r.nextRunOn }));
}

/**
 * Run one occurrence. Idempotent: the schedule row is locked and only
 * advances if next_run_on still equals the occurrence being run, so a retried
 * job can't produce a second invoice for the same period.
 */
export async function runSchedule(ctx: OrgContext, scheduleId: string, runOn: string): Promise<string | null> {
  const s = await withOrg(db, ctx.org.id, async (tx) => {
    const [row] = await tx.select().from(schema.recurringSchedules).where(eq(schema.recurringSchedules.id, scheduleId)).for("update");
    if (!row || row.status !== "active" || row.nextRunOn !== runOn) return null;
    const next = nextRun(runOn, row.intervalUnit, row.intervalCount);
    const remaining = row.remainingRuns === null ? null : row.remainingRuns - 1;
    const ended = (remaining !== null && remaining <= 0) || (row.endsOn !== null && next > row.endsOn);
    await tx
      .update(schema.recurringSchedules)
      .set({ nextRunOn: next, remainingRuns: remaining, status: ended ? "ended" : "active", lastRunAt: new Date() })
      .where(eq(schema.recurringSchedules.id, scheduleId));
    return row;
  });
  if (!s) return null;

  const draftId = await duplicateInvoice(ctx, s.templateInvoiceId);
  // Re-date: issue on the run date, keep the template's payment term.
  const draft = await getInvoice(ctx, draftId);
  const termDays = draft.invoice.dueDate ? Math.round((Date.parse(draft.invoice.dueDate) - Date.parse(draft.invoice.issueDate)) / 86_400_000) : null;
  await saveDraft(
    ctx,
    draftId,
    {
      businessProfileId: draft.invoice.businessProfileId,
      clientId: draft.invoice.clientId,
      currency: draft.invoice.currency,
      issueDate: runOn,
      dueDate: termDays === null ? null : addDays(runOn, termDays),
      language: draft.invoice.language,
      reference: draft.invoice.reference,
      lines: draft.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxCategory: l.taxCategory, taxRate: l.taxRate })),
      discount: draft.invoice.discountType && draft.invoice.discountValue ? { type: draft.invoice.discountType, value: draft.invoice.discountValue } : null,
      notes: draft.invoice.notes,
      terms: draft.invoice.terms,
      taxNote: draft.invoice.taxNote,
    },
  );
  await sysDb.update(schema.invoices).set({ source: "recurring", recurringScheduleId: scheduleId }).where(eq(schema.invoices.id, draftId));
  await sysDb.update(schema.recurringSchedules).set({ lastInvoiceId: draftId }).where(eq(schema.recurringSchedules.id, scheduleId));

  if (s.autoIssue !== "draft") {
    await issueInvoice(ctx, draftId);
    if (s.autoIssue === "issue_and_send") {
      const fresh = await getInvoice(ctx, draftId);
      const to = fresh.client?.emails ?? [];
      if (to.length) await queueInvoiceEmail(ctx, draftId, { to, cc: [], message: "" });
    }
  }
  return draftId;
}

export function describeSchedule(unit: string, count: number): string {
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`;
}

