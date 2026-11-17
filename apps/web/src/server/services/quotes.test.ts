import { afterAll, describe, expect, it } from "vitest";
import { dbs, orgContext } from "../../../test/fixtures";
import { schema } from "@pti/db";
import {
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

describe("quotes", () => {
  it("issues with their own numbering, is answered publicly and converts to an invoice", async () => {
    const { ctx, seed, clientId } = await orgContext({ plan: "starter" });
    await dbs.system
      .insert(schema.numberSeries)
      .values({
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
        issueDate: "2026-11-17",
        dueDate: "2026-12-17",
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
    expect(await taxReport(ctx, "2026-11-01", "2026-11-30")).toEqual([]);

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
});
