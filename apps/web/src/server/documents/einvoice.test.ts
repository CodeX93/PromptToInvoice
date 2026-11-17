import { afterAll, describe, expect, it } from "vitest";
import { eq, schema } from "@pti/db";
import { dbs, orgContext } from "../../../test/fixtures";
import { draftCreditNote, getInvoice, issueInvoice, saveDraft } from "../services/invoices";
import { archivePdf, pdfFor } from "./service";
import { einvoiceXml } from "./einvoice";

afterAll(() => dbs.close());

async function issued(plan: "pro" | "starter", vat: string | null) {
  const o = await orgContext({ plan });
  if (vat)
    await dbs.system
      .update(schema.businessProfiles)
      .set({ vatId: vat })
      .where(eq(schema.businessProfiles.id, o.seed.profile.id));
  const { id } = await saveDraft(o.ctx, null, {
    businessProfileId: o.seed.profile.id,
    clientId: o.clientId,
    currency: "EUR",
    issueDate: "2026-11-17",
    dueDate: "2026-12-01",
    lines: [
      {
        description: "Implementation",
        quantity: "16",
        unit: "h",
        unitPrice: "110",
        discountPercent: "10",
        taxCategory: "S",
        taxRate: "19",
      },
    ],
    discount: { type: "percent", value: "5" },
  });
  await issueInvoice(o.ctx, id);
  return { ...o, id };
}

describe("e-invoicing", () => {
  it("embeds Factur-X in the archived PDF/A-3 on plans with e-invoicing", async () => {
    const { ctx, id } = await issued("pro", "DE123456789");
    await archivePdf(ctx, id);
    const pdf = (await pdfFor(ctx, id)).pdf.toString("latin1");
    expect(pdf).toContain("factur-x.xml");
    expect(pdf).toContain("/AFRelationship /Alternative");
    expect(pdf).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
  });

  it("does not embed on starter, and skips sellers without a tax identifier", async () => {
    const starter = await issued("starter", "DE123456789");
    await archivePdf(starter.ctx, starter.id);
    expect((await pdfFor(starter.ctx, starter.id)).pdf.toString("latin1")).not.toContain(
      "factur-x.xml",
    );
    const noVat = await issued("pro", null);
    expect(einvoiceXml(await getInvoice(noVat.ctx, noVat.id), "en16931")).toBeNull();
  });

  it("produces consistent totals and a 381 credit note referencing the original", async () => {
    const { ctx, id } = await issued("pro", "DE123456789");
    const inv = await getInvoice(ctx, id);
    const xml = einvoiceXml(inv, "en16931") ?? "";
    expect(xml).toContain(
      `<ram:GrandTotalAmount>${(inv.invoice.total / 100).toFixed(2)}</ram:GrandTotalAmount>`,
    );
    expect(xml).toContain('<ram:BilledQuantity unitCode="HUR">16</ram:BilledQuantity>');
    const cn = await draftCreditNote(ctx, id);
    await issueInvoice(ctx, cn);
    const cxml = einvoiceXml(await getInvoice(ctx, cn), "xrechnung") ?? "";
    expect(cxml).toContain("<ram:TypeCode>381</ram:TypeCode>");
    expect(cxml).toContain(`<ram:IssuerAssignedID>${inv.invoice.number}</ram:IssuerAssignedID>`);
    expect(cxml).not.toMatch(/Amount>-/);
  });
});
