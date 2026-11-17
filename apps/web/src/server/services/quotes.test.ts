import { afterAll, describe, expect, it } from "vitest";
import { dbs, orgContext } from "../../../test/fixtures";
import { addDays, todayIn } from "@pti/core";
import { schema } from "@pti/db";
import {
  answerQuote,
  answerQuotePublic,
  convertQuote,
  getInvoice,
  issueInvoice,
  listInvoices,
  saveDraft,
} from "./invoices";
import { taxReport } from "./reports";
import { buildDocModel } from "../documents/model";

afterAll(() => dbs.close());

// Relative to today so the suite never expires with the calendar.
const today = todayIn("UTC");

describe("quotes", () => {
  it("issues with their own numbering, is answered publicly and converts to an invoice", async () => {
    const { ctx, seed, clientId } = await orgContext({ plan: "starter" });
    await dbs.system.insert(schema.numberSeries).values({
      orgId: ctx.org.id,
      businessProfileId: seed.profile.id,
      docType: "quote",
      pattern: "Q-{SEQ:3}",
    });
    const { id } = await saveDraft(
      ctx,
      null,
      {
        businessProfileId: seed.profile.id,
        clientId,
        currency: "EUR",
        issueDate: today,
        dueDate: addDays(today, 30),
        lines: [
          {
            description: "Website",
            quantity: "1",
            unitPrice: "5000",
            taxCategory: "S",
            taxRate: "19",
          },
        ],
      },
      { docType: "quote" },
    );
    expect((await issueInvoice(ctx, id)).number).toBe("Q-001");

    const q = await getInvoice(ctx, id);
    expect(q.status).toBe("issued");
    const m = buildDocModel(q, { ...seed.profile, bankDetailsEncrypted: null });
    expect(m.title).toBe("Quote");
    expect(m.meta.map((x) => x.label)).toContain("Valid until");
    expect(m.payment).toBeNull();

    // Quotes stay off the invoice list and out of VAT reports.
    expect((await listInvoices(ctx)).items.find((i) => i.id === id)).toBeUndefined();
    expect((await listInvoices(ctx, { filter: "quotes" })).items.map((i) => i.id)).toEqual([id]);
    expect(await taxReport(ctx, addDays(today, -31), addDays(today, 31))).toEqual([]);

    await answerQuotePublic(ctx.org.id, id, "accepted");
    expect((await getInvoice(ctx, id)).status).toBe("accepted");

    const invoiceId = await convertQuote(ctx, id);
    const inv = await getInvoice(ctx, invoiceId);
    expect(inv.invoice.docType).toBe("invoice");
    expect(inv.invoice.status).toBe("draft");
    expect(inv.invoice.total).toBe(595000);
    expect(inv.invoice.reference).toBe("Q-001");
    expect((await getInvoice(ctx, id)).status).toBe("converted");
    // Converting again returns the same invoice; answering afterwards is refused.
    expect(await convertQuote(ctx, id)).toBe(invoiceId);
    await expect(answerQuotePublic(ctx.org.id, id, "declined")).rejects.toThrow(/no longer/);
  });

  async function issuedQuote(validDays: number) {
    const o = await orgContext({ plan: "starter" });
    await dbs.system.insert(schema.numberSeries).values({
      orgId: o.ctx.org.id,
      businessProfileId: o.seed.profile.id,
      docType: "quote",
      pattern: "Q-{SEQ:3}",
    });
    const { id } = await saveDraft(
      o.ctx,
      null,
      {
        businessProfileId: o.seed.profile.id,
        clientId: o.clientId,
        currency: "EUR",
        issueDate: addDays(today, -40),
        dueDate: addDays(today, validDays),
        lines: [
          { description: "Work", quantity: "1", unitPrice: "100", taxCategory: "O", taxRate: "0" },
        ],
      },
      { docType: "quote" },
    );
    await issueInvoice(o.ctx, id);
    return { ...o, id };
  }

  it("a client's answer is final", async () => {
    const { ctx, id } = await issuedQuote(10);
    await answerQuotePublic(ctx.org.id, id, "accepted");
    await expect(answerQuotePublic(ctx.org.id, id, "declined")).rejects.toThrow(/already/);
    expect((await getInvoice(ctx, id)).status).toBe("accepted");
    // The owner can still record a change of mind given offline.
    await answerQuote(ctx, id, "declined");
    expect((await getInvoice(ctx, id)).status).toBe("declined");
  });

  it("an expired quote can't be accepted from the public link", async () => {
    const { ctx, id } = await issuedQuote(-1);
    await expect(answerQuotePublic(ctx.org.id, id, "accepted")).rejects.toThrow(/expired/);
    expect((await getInvoice(ctx, id)).invoice.acceptedAt).toBeNull();
  });
});
