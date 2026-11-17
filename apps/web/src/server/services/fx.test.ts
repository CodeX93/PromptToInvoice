import { afterAll, describe, expect, it } from "vitest";
import { dbs, orgContext } from "../../../test/fixtures";
import { getInvoice, issueInvoice, saveDraft } from "./invoices";
import { buildDocModel } from "../documents/model";
import { conversionRate, parseEcbXml, refreshEcbRates } from "./fx";

afterAll(() => dbs.close());

const XML = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube><Cube time='2026-11-16'><Cube currency='USD' rate='1.0850'/><Cube currency='GBP' rate='0.8600'/><Cube currency='PLN' rate='4.3200'/></Cube></Cube></gesmes:Envelope>`;

describe("fx", () => {
  it("parses ECB daily XML", () => {
    expect(parseEcbXml(XML)).toEqual({ date: "2026-11-16", rates: { EUR: "1", USD: "1.0850", GBP: "0.8600", PLN: "4.3200" } });
    expect(parseEcbXml("<nope/>")).toBeNull();
  });

  it("stores rates and computes direct and cross rates", async () => {
    const n = await refreshEcbRates((async () => new Response(XML)) as unknown as typeof fetch);
    expect(n).toBe(4);
    expect(await conversionRate("USD", "EUR", "2026-11-17")).toEqual({ rate: "0.92165899", date: "2026-11-16" });
    expect(await conversionRate("EUR", "PLN", "2026-11-17")).toEqual({ rate: "4.32", date: "2026-11-16" });
    expect((await conversionRate("USD", "PLN", "2026-11-17"))?.rate).toBe("3.98156682");
    expect(await conversionRate("USD", "EUR", "2026-01-01")).toBeNull();
  });

  it("freezes the ECB rate and states VAT in the national currency on foreign-currency invoices", async () => {
    await refreshEcbRates((async () => new Response(XML)) as unknown as typeof fetch);
    const { ctx, seed, clientId } = await orgContext({ plan: "pro" });
    const { id } = await saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "USD", issueDate: "2026-11-17", lines: [{ description: "Work", quantity: "1", unitPrice: "1000", taxCategory: "S", taxRate: "19" }] });
    await issueInvoice(ctx, id);
    const d = await getInvoice(ctx, id);
    expect(d.invoice.fxCurrency).toBe("EUR");
    expect(d.invoice.fxRate).toBe("0.92165899");
    const m = buildDocModel(d, { ...seed.profile, bankDetailsEncrypted: null });
    expect(m.taxNotes.join(" ")).toContain("VAT in EUR: €175.12 (1 USD = 0.92165899 EUR, ECB reference rate).");
  });
});
