"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isoDateSchema, toMinor, isCurrencyCode } from "@pti/core";
import { orgContextOrThrow } from "@/server/session";
import { run, type ActionResult } from "@/server/action";
import { ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { archivePdf } from "@/server/documents/service";
import { recordAiOutcome } from "@/server/services/ai-drafts";
import {
  deleteDraft,
  draftCreditNote,
  duplicateInvoice,
  getInvoice,
  issueInvoice,
  recordPayment,
  saveDraft,
} from "@/server/services/invoices";

const idSchema = z.uuid();

export async function saveInvoice(
  id: string | null,
  payload: unknown,
  expectedVersion?: number,
): Promise<ActionResult<{ id: string; version: number }>> {
  return run("invoices.save", async () => {
    const ctx = await orgContextOrThrow();
    const docType = id ? undefined : "invoice";
    const r = await saveDraft(ctx, id ? idSchema.parse(id) : null, payload, {
      expectedVersion,
      docType,
    });
    revalidatePath("/app/invoices");
    return r;
  });
}

/** Save (if dirty) then issue. The PDF is rendered after the response is sent. */
export async function issueInvoiceAction(id: string): Promise<ActionResult<{ number: string }>> {
  return run("invoices.issue", async () => {
    const ctx = await orgContextOrThrow();
    const r = await issueInvoice(ctx, idSchema.parse(id));
    after(async () => {
      await recordAiOutcome(ctx, id).catch((err: unknown) =>
        logger.warn({ err, invoiceId: id }, "AI outcome not recorded"),
      );
      try {
        await archivePdf(ctx, id);
      } catch (err) {
        // The PDF is re-attempted lazily on first download; never lose the issue.
        logger.error({ err, invoiceId: id }, "PDF archiving failed");
      }
    });
    revalidatePath("/app/invoices");
    revalidatePath(`/app/invoices/${id}`);
    return r;
  });
}

export async function deleteDraftAction(id: string): Promise<ActionResult> {
  return run("invoices.delete", async () => {
    await deleteDraft(await orgContextOrThrow(), idSchema.parse(id));
    revalidatePath("/app/invoices");
  });
}

export async function duplicateAction(id: string): Promise<ActionResult<{ id: string }>> {
  return run("invoices.duplicate", async () => ({
    id: await duplicateInvoice(await orgContextOrThrow(), idSchema.parse(id)),
  }));
}

export async function creditNoteAction(id: string): Promise<ActionResult<{ id: string }>> {
  return run("invoices.credit", async () => ({
    id: await draftCreditNote(await orgContextOrThrow(), idSchema.parse(id)),
  }));
}

const paymentSchema = z.object({
  amount: z.string().trim().min(1, "Enter an amount."),
  receivedOn: isoDateSchema,
  method: z.enum(["bank_transfer", "cash", "check", "other"]),
  reference: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(500).default(""),
});

export async function recordPaymentAction(
  id: string,
  input: z.input<typeof paymentSchema>,
): Promise<ActionResult> {
  return run("invoices.payment", async () => {
    const ctx = await orgContextOrThrow();
    const p = paymentSchema.safeParse(input);
    if (!p.success)
      throw new ValidationError(
        "Check the payment details.",
        Object.fromEntries(p.error.issues.map((i) => [i.path.join("."), [i.message]])),
      );
    const inv = await getInvoice(ctx, idSchema.parse(id));
    if (!isCurrencyCode(inv.invoice.currency)) throw new ValidationError("Unsupported currency.");
    let amount: number;
    try {
      amount = toMinor(p.data.amount.replace(/[\s,](?=\d{3}\b)/g, ""), inv.invoice.currency);
    } catch {
      throw new ValidationError("Enter a valid amount.", {
        amount: ["Use digits and a decimal point, e.g. 1200.50"],
      });
    }
    await recordPayment(ctx, id, { ...p.data, amount });
    revalidatePath(`/app/invoices/${id}`);
    revalidatePath("/app/invoices");
  });
}
