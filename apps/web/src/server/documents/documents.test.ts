import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { dbs, orgContext } from "../../../test/fixtures";
import { getInvoice, issueInvoice, recordPayment, saveDraft } from "../services/invoices";
import { archivePdf, pdfFor } from "./service";
import { buildDocModel } from "./model";

afterAll(() => dbs.close());

describe("invoice documents", () => {
  it("archives a PDF/A-3 on issue and serves the archived bytes", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, {
      businessProfileId: seed.profile.id,
      clientId,
      currency: "EUR",
      issueDate: "2026-11-17",
      dueDate: "2026-12-01",
      language: "en",
      lines: [
        {
          description:
            "Brand strategy workshop (2 days, on-site in Berlin incl. preparation and follow-up notes)",
          quantity: "2",
          unit: "days",
          unitPrice: "1200",
          taxCategory: "S",
          taxRate: "19",
        },
        {
          description: "Implementation",
          quantity: "16",
          unit: "h",
          unitPrice: "120",
          taxCategory: "S",
          taxRate: "19",
        },
        {
          description: "Hosting, November",
          quantity: "1",
          unit: "",
          unitPrice: "120",
          taxCategory: "S",
          taxRate: "19",
        },
      ],
      discount: { type: "percent", value: "5" },
      notes: "Thank you for the collaboration.",
      terms: "Payable within 14 days without deduction.",
    });
    await issueInvoice(ctx, id);
    await archivePdf(ctx, id);
    const d = await getInvoice(ctx, id);
    expect(d.invoice.pdfSha256).toMatch(/^[0-9a-f]{64}$/);

    const first = await pdfFor(ctx, id);
    expect(first.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(first.pdf.toString("latin1")).toContain("pdfaid:part>3<");
    expect(first.fileName).toBe("Invoice-INV-2026-0001.pdf");
    // Second call serves the same archived bytes.
    expect((await pdfFor(ctx, id)).pdf.equals(first.pdf)).toBe(true);
    if (process.env.PDF_SAMPLE_OUT) writeFileSync(process.env.PDF_SAMPLE_OUT, first.pdf);

    // Archiving twice is a no-op (the hash can only be set once).
    await archivePdf(ctx, id);
    await recordPayment(ctx, id, {
      amount: d.invoice.total,
      receivedOn: "2026-11-20",
      method: "bank_transfer",
      reference: "",
      notes: "",
    });
  });

  it("builds a German model with localized labels and formats", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, {
      businessProfileId: seed.profile.id,
      clientId,
      currency: "EUR",
      issueDate: "2026-11-17",
      language: "de",
      lines: [
        {
          description: "Beratung",
          quantity: "1.5",
          unit: "Std.",
          unitPrice: "0.0125",
          taxCategory: "S",
          taxRate: "19",
        },
      ],
    });
    const d = await getInvoice(ctx, id);
    const m = buildDocModel(d, { ...seed.profile, bankDetailsEncrypted: null });
    expect(m.title).toBe("Rechnung");
    expect(m.number).toBe("Entwurf");
    expect(m.stamp).toBe("draft");
    expect(m.lines[0]?.quantity).toBe("1,5 Std.");
    expect(m.lines[0]?.unitPrice).toBe("0,0125 €");
    expect(m.meta[0]).toEqual({ label: "Rechnungsdatum", value: "17.11.2026" });
  });
});
