import "server-only";
import {
  BASE_CURRENCIES,
  addDays,
  hasFeature,
  assertCan,
  calculate,
  euCountry,
  displayStatus,
  invoiceDraftSchema,
  isCurrencyCode,
  statusAfterPayment,
  todayIn,
  type CalculationResult,
  type CurrencyCode,
  type DisplayStatus,
  type InvoiceDraftInput,
  type LineItemInput,
  type TaxCategory,
} from "@pti/core";
import {
  allocateNumber,
  and,
  asc,
  desc,
  eq,
  one,
  schema,
  sql,
  withOrg,
  type InvoiceEventType,
  type InvoiceSource,
  type IssuedSnapshot,
  type SQL,
  type Tx,
} from "@pti/db";
import { db } from "../db";
import { audit } from "../audit";
import { randomToken } from "../crypto";
import { ConflictError, NotFound, QuotaExceededError, ValidationError } from "../errors";
import { authorize, type OrgContext } from "../session";
import { readBank } from "./business-profiles";
import { consume } from "./usage";
import { conversionRate, logFxGap } from "./fx";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type LineRow = typeof schema.invoiceLines.$inferSelect;

export interface InvoiceListItem {
  id: string;
  docType: "invoice" | "credit_note";
  number: string | null;
  clientName: string | null;
  issueDate: string;
  dueDate: string | null;
  currency: CurrencyCode;
  total: number;
  amountDue: number;
  status: DisplayStatus;
}

export type InvoiceFilter = "all" | "draft" | "outstanding" | "overdue" | "paid" | "void";

const I = schema.invoices;

function cur(c: string): CurrencyCode {
  if (!isCurrencyCode(c)) throw new Error(`Unsupported currency ${c}`);
  return c;
}

function encodeCursor(issueDate: string, id: string) {
  return Buffer.from(`${issueDate}|${id}`).toString("base64url");
}
function decodeCursor(c?: string): [string, string] | null {
  if (!c) return null;
  const [d, id] = Buffer.from(c, "base64url").toString().split("|");
  return d && id && /^\d{4}-\d{2}-\d{2}$/.test(d) && /^[0-9a-f-]{36}$/.test(id) ? [d, id] : null;
}

export async function listInvoices(
  ctx: OrgContext,
  args: {
    filter?: InvoiceFilter;
    q?: string;
    clientId?: string;
    cursor?: string;
    limit?: number;
  } = {},
): Promise<{ items: InvoiceListItem[]; nextCursor: string | null }> {
  authorize(ctx, "invoice:read");
  const limit = Math.min(args.limit ?? 50, 100);
  const today = todayIn(ctx.org.timeZone);
  const where: SQL[] = [];
  switch (args.filter ?? "all") {
    case "draft":
      where.push(eq(I.status, "draft"));
      break;
    case "outstanding":
      where.push(eq(I.status, "open"), eq(I.docType, "invoice"));
      break;
    case "overdue":
      where.push(eq(I.status, "open"), eq(I.docType, "invoice"), sql`${I.dueDate} < ${today}`);
      break;
    case "paid":
      where.push(eq(I.status, "paid"));
      break;
    case "void":
      where.push(eq(I.status, "void"));
      break;
    case "all":
      break;
  }
  if (args.clientId) where.push(eq(I.clientId, args.clientId));
  const q = args.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      sql`(${I.number} ilike ${like} or ${schema.clients.name} ilike ${like} or ${I.reference} ilike ${like})`,
    );
  }
  const c = decodeCursor(args.cursor);
  if (c) where.push(sql`(${I.issueDate}, ${I.id}) < (${c[0]}::date, ${c[1]}::uuid)`);

  const rows = await withOrg(db, ctx.org.id, (tx) =>
    tx
      .select({
        id: I.id,
        docType: I.docType,
        status: I.status,
        number: I.number,
        issueDate: I.issueDate,
        dueDate: I.dueDate,
        currency: I.currency,
        total: I.total,
        amountPaid: I.amountPaid,
        creditedAmount: I.creditedAmount,
        sentAt: I.sentAt,
        viewedAt: I.viewedAt,
        clientName: schema.clients.name,
      })
      .from(I)
      .leftJoin(schema.clients, eq(schema.clients.id, I.clientId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(I.issueDate), desc(I.id))
      .limit(limit + 1),
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id,
      docType: r.docType,
      number: r.number,
      clientName: r.clientName,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      currency: cur(r.currency),
      total: r.total,
      amountDue: r.status === "open" ? Math.max(0, r.total - r.amountPaid - r.creditedAmount) : 0,
      status: displayStatus(r, today),
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.issueDate, last.id) : null,
  };
}

export interface InvoiceDetail {
  invoice: InvoiceRow;
  lines: LineRow[];
  client: typeof schema.clients.$inferSelect | null;
  payments: (typeof schema.payments.$inferSelect)[];
  events: (typeof schema.invoiceEvents.$inferSelect & { actorName: string | null })[];
  credits: { id: string; number: string | null; total: number; status: string }[];
  corrects: { id: string; number: string | null } | null;
  status: DisplayStatus;
}

export async function getInvoice(ctx: OrgContext, id: string): Promise<InvoiceDetail> {
  authorize(ctx, "invoice:read");
  return withOrg(db, ctx.org.id, async (tx) => {
    const [invoice] = await tx.select().from(I).where(eq(I.id, id)).limit(1);
    if (!invoice) throw new NotFound("Invoice");
    const [lines, client, payments, events, credits, corrects] = await Promise.all([
      tx
        .select()
        .from(schema.invoiceLines)
        .where(eq(schema.invoiceLines.invoiceId, id))
        .orderBy(asc(schema.invoiceLines.position)),
      invoice.clientId
        ? tx
            .select()
            .from(schema.clients)
            .where(eq(schema.clients.id, invoice.clientId))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      tx
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.invoiceId, id))
        .orderBy(asc(schema.payments.receivedOn)),
      tx
        .select({
          e: schema.invoiceEvents,
          actorName: sql<
            string | null
          >`(select name from users where users.id = invoice_events.actor_id)`,
        })
        .from(schema.invoiceEvents)
        .where(eq(schema.invoiceEvents.invoiceId, id))
        .orderBy(asc(schema.invoiceEvents.createdAt)),
      tx
        .select({ id: I.id, number: I.number, total: I.total, status: I.status })
        .from(I)
        .where(eq(I.correctsInvoiceId, id))
        .orderBy(asc(I.createdAt)),
      invoice.correctsInvoiceId
        ? tx
            .select({ id: I.id, number: I.number })
            .from(I)
            .where(eq(I.id, invoice.correctsInvoiceId))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);
    return {
      invoice,
      lines,
      client,
      payments,
      events: events.map((r) => ({ ...r.e, actorName: r.actorName })),
      credits,
      corrects,
      status: displayStatus(invoice, todayIn(ctx.org.timeZone)),
    };
  });
}

async function event(
  tx: Tx,
  orgId: string,
  invoiceId: string,
  type: InvoiceEventType,
  actorId: string | null,
  data: Record<string, unknown> = {},
) {
  await tx.insert(schema.invoiceEvents).values({ orgId, invoiceId, type, actorId, data });
}

function toCalcInput(
  currency: CurrencyCode,
  lines: Pick<
    LineItemInput,
    "quantity" | "unitPrice" | "discountPercent" | "taxCategory" | "taxRate"
  >[],
  discount: InvoiceDraftInput["discount"],
) {
  return {
    currency,
    lines: lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent ?? null,
      taxCategory: l.taxCategory,
      taxRate: l.taxRate,
    })),
    discount,
  };
}

function totalsColumns(r: CalculationResult) {
  return {
    lineNetTotal: r.lineNetTotal,
    discountTotal: r.discountTotal,
    taxExclusive: r.taxExclusive,
    taxTotal: r.taxTotal,
    total: r.taxInclusive,
    taxBreakdown: r.breakdown,
  };
}

export interface SaveDraftOptions {
  source?: InvoiceSource;
  aiDraftId?: string | null;
  docType?: "invoice" | "credit_note";
  correctsInvoiceId?: string | null;
  /** Optimistic concurrency: the version the editor loaded. */
  expectedVersion?: number;
}

/**
 * Create or replace a draft. Totals are always recomputed on the server from
 * the submitted lines (never trusted from the client). Lines are replaced
 * wholesale; drafts are small, and it keeps positions contiguous.
 */
export async function saveDraft(
  ctx: OrgContext,
  id: string | null,
  raw: unknown,
  opts: SaveDraftOptions = {},
): Promise<{ id: string; version: number }> {
  authorize(ctx, "invoice:write");
  const parsed = invoiceDraftSchema.safeParse(raw);
  if (!parsed.success) {
    const fe: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fe[i.path.join(".")] ??= []).push(i.message);
    throw new ValidationError("Please check the highlighted fields.", fe);
  }
  const input = parsed.data;
  const currency = cur(input.currency);
  if (!hasFeature(ctx.org.plan, "all_currencies") && !BASE_CURRENCIES.includes(currency)) {
    throw new QuotaExceededError(
      `Invoicing in ${currency} is part of the Professional plan. Starter supports USD and EUR.`,
      { feature: "all_currencies" },
    );
  }
  const docType = opts.docType ?? "invoice";
  const calc = calculate(toCalcInput(currency, input.lines, input.discount));
  if (docType === "invoice" && calc.taxInclusive < 0)
    throw new ValidationError("An invoice total can't be negative. Use a credit note instead.");

  return withOrg(db, ctx.org.id, async (tx) => {
    // Profile and client must belong to this org (RLS makes foreign ids invisible).
    one(
      await tx
        .select({ id: schema.businessProfiles.id })
        .from(schema.businessProfiles)
        .where(eq(schema.businessProfiles.id, input.businessProfileId)),
      "Business profile",
    );
    if (input.clientId)
      one(
        await tx
          .select({ id: schema.clients.id })
          .from(schema.clients)
          .where(eq(schema.clients.id, input.clientId)),
        "Client",
      );

    const values = {
      businessProfileId: input.businessProfileId,
      clientId: input.clientId,
      currency,
      issueDate: input.issueDate,
      supplyDate: input.supplyDate ?? null,
      dueDate: input.dueDate ?? null,
      language: input.language,
      reference: input.reference,
      discountType: input.discount?.type ?? null,
      discountValue: input.discount?.value ?? null,
      notes: input.notes,
      terms: input.terms,
      taxNote: input.taxNote,
      ...totalsColumns(calc),
    };

    let invoiceId: string;
    let version: number;
    if (id) {
      const [existing] = await tx
        .select({ status: I.status, docType: I.docType, version: I.version })
        .from(I)
        .where(eq(I.id, id))
        .for("update");
      if (!existing) throw new NotFound("Invoice");
      assertCan(existing, "edit");
      if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
        throw new ConflictError(
          "This draft was changed in another tab. Reload to see the latest version.",
          "stale_version",
        );
      }
      version = existing.version + 1;
      await tx
        .update(I)
        .set({ ...values, version })
        .where(eq(I.id, id));
      await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id));
      invoiceId = id;
    } else {
      const row = one(
        await tx
          .insert(I)
          .values({
            orgId: ctx.org.id,
            docType,
            ...values,
            source: opts.source ?? "manual",
            aiDraftId: opts.aiDraftId ?? null,
            correctsInvoiceId: opts.correctsInvoiceId ?? null,
            createdBy: ctx.user.id,
          })
          .returning({ id: I.id, version: I.version }),
      );
      invoiceId = row.id;
      version = row.version;
      await event(tx, ctx.org.id, invoiceId, "created", ctx.user.id, {
        source: opts.source ?? "manual",
      });
    }

    await tx.insert(schema.invoiceLines).values(
      input.lines.map((l, position) => {
        const r = calc.lines[position];
        if (!r) throw new Error("line/result mismatch");
        return {
          orgId: ctx.org.id,
          invoiceId,
          position,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent ?? null,
          taxCategory: l.taxCategory,
          taxRate: l.taxRate,
          gross: r.gross,
          lineDiscount: r.lineDiscount,
          net: r.net,
        };
      }),
    );
    return { id: invoiceId, version };
  });
}

export async function deleteDraft(ctx: OrgContext, id: string): Promise<void> {
  authorize(ctx, "invoice:write");
  await withOrg(db, ctx.org.id, async (tx) => {
    const [row] = await tx
      .select({ status: I.status, docType: I.docType })
      .from(I)
      .where(eq(I.id, id))
      .for("update");
    if (!row) throw new NotFound("Invoice");
    assertCan(row, "delete");
    await tx.delete(I).where(eq(I.id, id));
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "invoice.draft_deleted",
      entityType: "invoice",
      entityId: id,
    });
  });
}

/**
 * Issue a draft: freeze its legal content, allocate the next number and
 * count it against the plan quota — all in one transaction. The PDF is
 * rendered right after commit (see documents service).
 */
export async function issueInvoice(ctx: OrgContext, id: string): Promise<{ number: string }> {
  authorize(ctx, "invoice:issue");
  return withOrg(db, ctx.org.id, async (tx) => {
    const [inv] = await tx.select().from(I).where(eq(I.id, id)).for("update");
    if (!inv) throw new NotFound("Invoice");
    assertCan(inv, "issue");
    if (!inv.clientId)
      throw new ValidationError("Choose who this invoice is for before issuing it.", {
        clientId: ["Required to issue."],
      });

    const lines = await tx
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, id))
      .orderBy(asc(schema.invoiceLines.position));
    if (lines.length === 0) throw new ValidationError("Add at least one line item.");
    // Defence in depth: recompute and compare before freezing.
    const calc = calculate(
      toCalcInput(
        cur(inv.currency),
        lines.map((l) => ({
          ...l,
          taxCategory: l.taxCategory as TaxCategory,
          discountPercent: l.discountPercent,
        })),
        inv.discountType && inv.discountValue
          ? { type: inv.discountType, value: inv.discountValue }
          : null,
      ),
    );
    if (calc.taxInclusive !== inv.total)
      throw new ConflictError("Totals are out of date. Save the draft again before issuing.");

    const [profile] = await tx
      .select()
      .from(schema.businessProfiles)
      .where(eq(schema.businessProfiles.id, inv.businessProfileId));
    const [client] = await tx
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, inv.clientId));
    if (!profile || !client) throw new NotFound("Business profile or client");
    if (client.status === "pending")
      await tx
        .update(schema.clients)
        .set({ status: "active" })
        .where(eq(schema.clients.id, client.id));

    const [series] = await tx
      .select()
      .from(schema.numberSeries)
      .where(
        and(
          eq(schema.numberSeries.businessProfileId, profile.id),
          eq(schema.numberSeries.docType, inv.docType),
        ),
      );
    if (!series) throw new NotFound("Number series");

    if (inv.docType === "invoice") await consume(tx, ctx.org.id, ctx.org.plan, "invoices_issued");
    const { number } = await allocateNumber(tx, {
      orgId: ctx.org.id,
      seriesId: series.id,
      pattern: series.pattern,
      resetPolicy: series.resetPolicy,
      issueDate: inv.issueDate,
    });

    const bank = readBank(profile);
    const snapshot: IssuedSnapshot = {
      seller: {
        legalName: profile.legalName,
        tradingName: profile.tradingName,
        address: profile.address,
        vatId: profile.vatId,
        taxId: profile.taxId,
        registrationNumber: profile.registrationNumber,
        email: profile.email,
        phone: profile.phone,
        website: profile.website,
        bank: bank
          ? {
              accountHolder: bank.accountHolder,
              iban: bank.iban,
              bic: bank.bic,
              bankName: bank.bankName,
            }
          : null,
        logoFileId: profile.logoFileId,
      },
      buyer: {
        name: client.name,
        contactName: client.contactName,
        address: client.address,
        vatId: client.vatId,
        taxId: client.taxId,
        email: client.emails[0] ?? null,
        buyerReference: client.buyerReference,
      },
    };

    // EU rule (Art. 230 VAT Directive): VAT on a foreign-currency invoice must also be stated in the
    // seller's national currency. Freeze the ECB reference rate at issue.
    const national = euCountry(profile.address.country)?.currency;
    let fx: { fxRate: string; fxCurrency: string } | null = null;
    if (national && national !== inv.currency && inv.taxTotal !== 0) {
      const r = await conversionRate(inv.currency, national, inv.issueDate);
      if (r) fx = { fxRate: r.rate, fxCurrency: national };
      else logFxGap(id, inv.currency, national);
    }

    await tx
      .update(I)
      .set({ status: "open", number, seriesId: series.id, issuedSnapshot: snapshot, issuedAt: new Date(), publicToken: randomToken(18), version: inv.version + 1, ...fx })
      .where(eq(I.id, id));

    // Issuing a credit note settles (part of) the original invoice.
    if (inv.docType === "credit_note" && inv.correctsInvoiceId) {
      const [orig] = await tx.select().from(I).where(eq(I.id, inv.correctsInvoiceId)).for("update");
      if (orig && (orig.status === "open" || orig.status === "paid")) {
        const credited = orig.creditedAmount + Math.abs(inv.total);
        const fullyCreditedUnpaid = credited >= orig.total && orig.amountPaid === 0;
        await tx
          .update(I)
          .set({
            creditedAmount: credited,
            status: fullyCreditedUnpaid
              ? "void"
              : statusAfterPayment(orig.total, orig.amountPaid, credited),
            ...(fullyCreditedUnpaid && { voidedAt: new Date() }),
            version: orig.version + 1,
          })
          .where(eq(I.id, orig.id));
        await event(
          tx,
          ctx.org.id,
          orig.id,
          fullyCreditedUnpaid ? "voided" : "credited",
          ctx.user.id,
          { creditNoteId: id, number, amount: Math.abs(inv.total) },
        );
      }
    }

    // Remember line items for the catalogue (feeds "usual rates" and the AI).
    await event(tx, ctx.org.id, id, "issued", ctx.user.id, { number });
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: `${inv.docType}.issued`,
      entityType: "invoice",
      entityId: id,
      diff: { number, total: inv.total, currency: inv.currency },
    });
    return { number };
  });
}

/** Start a new draft from any existing document. */
export async function duplicateInvoice(ctx: OrgContext, id: string): Promise<string> {
  authorize(ctx, "invoice:write");
  const src = await getInvoice(ctx, id);
  const today = todayIn(ctx.org.timeZone);
  const terms = src.invoice.dueDate
    ? Math.max(
        0,
        (Date.parse(src.invoice.dueDate) - Date.parse(src.invoice.issueDate)) / 86_400_000,
      )
    : null;
  const { id: newId } = await saveDraft(
    ctx,
    null,
    {
      businessProfileId: src.invoice.businessProfileId,
      clientId: src.invoice.clientId,
      currency: src.invoice.currency,
      issueDate: today,
      dueDate: terms !== null ? addDays(today, terms) : null,
      language: src.invoice.language,
      reference: "",
      lines: src.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity.replace(/^-/, ""),
        unit: l.unit,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        taxCategory: l.taxCategory,
        taxRate: l.taxRate,
      })),
      discount:
        src.invoice.discountType && src.invoice.discountValue
          ? { type: src.invoice.discountType, value: src.invoice.discountValue }
          : null,
      notes: src.invoice.notes,
      terms: src.invoice.terms,
      taxNote: src.invoice.taxNote,
    },
    { source: "duplicate" },
  );
  return newId;
}

/**
 * Draft a credit note for an issued invoice. Quantities are negated so the
 * credit note's totals are negative, mirroring the original line by line;
 * the user can trim lines for a partial credit before issuing.
 */
export async function draftCreditNote(ctx: OrgContext, id: string): Promise<string> {
  authorize(ctx, "invoice:write");
  const src = await getInvoice(ctx, id);
  assertCan(src.invoice, "credit");
  const { id: cnId } = await saveDraft(
    ctx,
    null,
    {
      businessProfileId: src.invoice.businessProfileId,
      clientId: src.invoice.clientId,
      currency: src.invoice.currency,
      issueDate: todayIn(ctx.org.timeZone),
      dueDate: null,
      language: src.invoice.language,
      reference: src.invoice.number ?? "",
      lines: src.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity.startsWith("-") ? l.quantity.slice(1) : `-${l.quantity}`,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        taxCategory: l.taxCategory,
        taxRate: l.taxRate,
      })),
      discount:
        src.invoice.discountType && src.invoice.discountValue
          ? { type: src.invoice.discountType, value: src.invoice.discountValue }
          : null,
      notes: `Credit note for invoice ${src.invoice.number ?? ""}.`,
      terms: "",
      taxNote: src.invoice.taxNote,
    },
    { source: "credit", docType: "credit_note", correctsInvoiceId: id },
  );
  return cnId;
}

export interface PaymentInput {
  amount: number;
  receivedOn: string;
  method: "bank_transfer" | "cash" | "check" | "other";
  reference: string;
  notes: string;
}

export async function recordPayment(ctx: OrgContext, id: string, p: PaymentInput): Promise<void> {
  authorize(ctx, "payment:write");
  if (!Number.isSafeInteger(p.amount) || p.amount <= 0)
    throw new ValidationError("Enter an amount above zero.", {
      amount: ["Enter an amount above zero."],
    });
  await withOrg(db, ctx.org.id, async (tx) => {
    const [inv] = await tx.select().from(I).where(eq(I.id, id)).for("update");
    if (!inv) throw new NotFound("Invoice");
    assertCan(inv, "record_payment");
    const due = inv.total - inv.amountPaid - inv.creditedAmount;
    if (p.amount > due)
      throw new ValidationError("That's more than the amount due.", {
        amount: [`At most ${due / 100}.`],
      });
    await tx.insert(schema.payments).values({
      orgId: ctx.org.id,
      invoiceId: id,
      amount: p.amount,
      currency: inv.currency,
      method: p.method,
      reference: p.reference,
      receivedOn: p.receivedOn,
      notes: p.notes,
      createdBy: ctx.user.id,
    });
    const paid = inv.amountPaid + p.amount;
    const status = statusAfterPayment(inv.total, paid, inv.creditedAmount);
    await tx
      .update(I)
      .set({
        amountPaid: paid,
        status,
        paidAt: status === "paid" ? new Date() : null,
        version: inv.version + 1,
      })
      .where(eq(I.id, id));
    await event(tx, ctx.org.id, id, "payment_recorded", ctx.user.id, {
      amount: p.amount,
      method: p.method,
      receivedOn: p.receivedOn,
    });
    if (status === "paid") await event(tx, ctx.org.id, id, "paid", ctx.user.id);
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "payment.recorded",
      entityType: "invoice",
      entityId: id,
      diff: { amount: p.amount, method: p.method },
    });
  });
}

/** Defaults for a brand-new draft (profile, currency, dates, notes, default tax rate). */
export async function draftDefaults(ctx: OrgContext, clientId?: string | null) {
  return withOrg(db, ctx.org.id, async (tx) => {
    const [profile] = await tx
      .select()
      .from(schema.businessProfiles)
      .where(eq(schema.businessProfiles.isDefault, true))
      .limit(1);
    if (!profile) throw new NotFound("Business profile");
    const [client] = clientId
      ? await tx.select().from(schema.clients).where(eq(schema.clients.id, clientId))
      : [];
    const [rate] = await tx
      .select()
      .from(schema.taxRates)
      .where(and(eq(schema.taxRates.isDefault, true), sql`${schema.taxRates.archivedAt} is null`))
      .limit(1);
    const today = todayIn(ctx.org.timeZone);
    const terms = client?.paymentTermsDays ?? profile.defaultPaymentTermsDays;
    return {
      profile,
      issueDate: today,
      dueDate: addDays(today, terms),
      currency: cur(client?.currency ?? profile.defaultCurrency),
      notes: profile.defaultNotes,
      terms: profile.defaultTerms,
      taxCategory: (rate?.category ?? "O") as TaxCategory,
      taxRate: rate?.rate ? String(Number(rate.rate)) : "0",
    };
  });
}

/** Lightweight counts for nav badges and the dashboard. */
export async function invoiceCounts(ctx: OrgContext) {
  const today = todayIn(ctx.org.timeZone);
  const [r] = await withOrg(db, ctx.org.id, (tx) =>
    tx.execute<{ drafts: number; overdue: number }>(sql`
      select
        count(*) filter (where status = 'draft')::int as drafts,
        count(*) filter (where status = 'open' and doc_type = 'invoice' and due_date < ${today})::int as overdue
      from invoices
    `),
  );
  return { drafts: r?.drafts ?? 0, overdue: r?.overdue ?? 0 };
}

export function isInvoiceIds(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.every((x) => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x));
}
