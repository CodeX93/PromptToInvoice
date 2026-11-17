import { afterAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@pti/core";
import { dbs, orgContext } from "../../../test/fixtures";
import { draftCreditNote, issueInvoice, recordPayment, saveDraft } from "./invoices";
import { overview, revenueByClient, revenueByMonth, taxReport } from "./reports";

afterAll(() => dbs.close());

describe("reports", () => {
  it("computes KPIs, aging, collections, tax and revenue", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const today = todayIn("UTC");
    const mk = async (issueDate: string, dueDate: string, price: string, rate = "19", cat = "S") => {
      const { id } = await saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "EUR", issueDate, dueDate, lines: [{ description: "x", quantity: "1", unitPrice: price, taxCategory: cat, taxRate: rate }] });
      await issueInvoice(ctx, id);
      return id;
    };
    const overdue = await mk(addDays(today, -50), addDays(today, -40), "100"); // 119.00, 31-60
    const current = await mk(today, addDays(today, 14), "200"); // 238.00, current
    const paid = await mk(addDays(today, -5), addDays(today, 9), "50", "0", "AE"); // 50.00 reverse charge
    await recordPayment(ctx, paid, { amount: 5000, receivedOn: today, method: "bank_transfer", reference: "", notes: "" });
    await issueInvoice(ctx, await draftCreditNote(ctx, current)); // voids "current"

    const o = await overview(ctx, "EUR");
    const eur = o.kpis.find((k) => k.currency === "EUR");
    expect(eur).toMatchObject({ outstanding: 11900, overdue: 11900, overdueCount: 1, collected30d: 5000 });
    expect(o.aging.find((a) => a.bucket === "31-60")).toEqual({ bucket: "31-60", amount: 11900, count: 1 });
    expect(o.collectedByMonth).toHaveLength(12);
    expect(o.collectedByMonth.at(-1)?.amount).toBe(5000);
    expect(o.topClients[0]).toMatchObject({ id: clientId, outstanding: 11900 });
    expect(o.activity.length).toBeGreaterThan(0);

    const tax = await taxReport(ctx, addDays(today, -60), today);
    const s19 = tax.find((t) => t.category === "S" && t.rate === "19");
    // 100 + 200 − 200 (credit note) = 100 taxable, 19 tax
    expect(s19).toMatchObject({ taxable: 10000, tax: 1900, documents: 3 });
    expect(tax.find((t) => t.category === "AE")).toMatchObject({ taxable: 5000, tax: 0 });

    const months = await revenueByMonth(ctx, addDays(today, -60), today);
    const thisMonth = months.filter((m) => m.month === today.slice(0, 7) && m.currency === "EUR");
    expect(thisMonth[0]?.collected).toBe(5000);

    const byClient = await revenueByClient(ctx, addDays(today, -60), today);
    expect(byClient[0]).toMatchObject({ clientId, outstanding: 11900 });
    void overdue;
  });
});
