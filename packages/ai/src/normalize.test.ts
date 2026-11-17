import { describe, expect, it } from "vitest";
import { mapTaxHint, normalizeDraft, suggestPrice, type NormalizeContext } from "./normalize";
import type { DraftOutput } from "./schema";

const out = (over: Partial<DraftOutput> = {}): DraftOutput => ({
  client: { matchedClientId: null, name: null, email: null, country: null, vatId: null },
  currency: null,
  issueDate: null,
  supplyDate: null,
  dueDate: null,
  paymentTermsDays: null,
  reference: null,
  language: null,
  lines: [],
  discount: null,
  notes: null,
  copyFromPrevious: false,
  uncertainFields: [],
  assumptions: [],
  ...over,
});

const ctx: NormalizeContext = {
  today: "2026-11-17",
  knownClientIds: new Set(["c-acme"]),
  history: [
    { description: "Consulting", unit: "h", unitPrice: "120", currency: "EUR", clientId: "c-acme" },
    { description: "Logo design", unit: "", unitPrice: "1800", currency: "EUR", clientId: null },
  ],
  taxRates: [
    { category: "S", rate: "19", isDefault: true },
    { category: "S", rate: "7", isDefault: false },
  ],
};

describe("normalizeDraft", () => {
  it("handles the canonical prompt", () => {
    const d = normalizeDraft(
      out({
        client: { matchedClientId: "c-acme", name: "Acme Corp", email: null, country: null, vatId: null },
        currency: "usd",
        paymentTermsDays: 30,
        lines: [{ description: "Consulting", quantity: "10", unit: "h", unitPrice: "120", discountPercent: null, taxHint: null }],
      }),
      ctx,
    );
    expect(d.clientId).toBe("c-acme");
    expect(d.currency).toBe("USD");
    expect(d.dueDate).toBe("2026-12-17");
    expect(d.lines[0]).toMatchObject({ quantity: "10", unit: "h", unitPrice: "120", tax: null });
    expect(d.aiFields).toEqual(expect.arrayContaining(["client", "currency", "dueDate", "lines.0.unitPrice"]));
  });

  it("never trusts unknown client ids", () => {
    const d = normalizeDraft(out({ client: { matchedClientId: "c-other-org", name: "Someone", email: "x@y.z", country: "de", vatId: "de 123 456 789" } }), ctx);
    expect(d.clientId).toBeNull();
    expect(d.clientName).toBe("Someone");
    expect(d.clientHints).toEqual({ email: "x@y.z", country: "DE", vatId: "DE123456789" });
  });

  it("discards unparseable numbers and dates and reports them", () => {
    const d = normalizeDraft(
      out({
        issueDate: "2026-02-30",
        currency: "XYZ",
        lines: [{ description: "Work", quantity: "ten", unit: null, unitPrice: "lots", discountPercent: "150", taxHint: null }],
      }),
      ctx,
    );
    expect(d.issueDate).toBe("2026-11-17");
    expect(d.currency).toBeNull();
    expect(d.lines[0]).toMatchObject({ quantity: "1", unitPrice: "", discountPercent: null });
    expect(d.notesForUser.join(" ")).toMatch(/quantity.*Work|No price/);
  });

  it("fills a missing price from the user's history, preferring the same client", () => {
    const d = normalizeDraft(
      out({
        client: { matchedClientId: "c-acme", name: "Acme", email: null, country: null, vatId: null },
        lines: [{ description: "Consulting work", quantity: "5", unit: "h", unitPrice: null, discountPercent: null, taxHint: null }],
      }),
      ctx,
    );
    expect(d.lines[0]?.unitPrice).toBe("120");
    expect(d.notesForUser.join(" ")).toMatch(/previous rate of 120 EUR\/h/);
  });

  it("normalises thousands separators the model might leave in", () => {
    const d = normalizeDraft(out({ lines: [{ description: "Retainer", quantity: "1", unit: null, unitPrice: "1,200.50", discountPercent: null, taxHint: null }] }), ctx);
    expect(d.lines[0]?.unitPrice).toBe("1200.50");
  });

  it("drops a due date before the issue date", () => {
    expect(normalizeDraft(out({ issueDate: "2026-11-20", dueDate: "2026-11-01" }), ctx).dueDate).toBeNull();
  });

  it("caps runaway output", () => {
    const lines = Array.from({ length: 250 }, (_, i) => ({ description: `Item ${i}`, quantity: "1", unit: null, unitPrice: "1", discountPercent: null, taxHint: null }));
    expect(normalizeDraft(out({ lines }), ctx).lines).toHaveLength(100);
  });
});

describe("helpers", () => {
  it("maps tax hints to configured rates", () => {
    expect(mapTaxHint("standard", ctx.taxRates)).toEqual({ category: "S", rate: "19" });
    expect(mapTaxHint("reduced", ctx.taxRates)).toEqual({ category: "S", rate: "7" });
    expect(mapTaxHint("reverse_charge", ctx.taxRates)).toEqual({ category: "AE", rate: "0" });
    expect(mapTaxHint(null, ctx.taxRates)).toBeNull();
  });

  it("only suggests prices above a similarity threshold", () => {
    expect(suggestPrice("Logo design refresh", "", null, "EUR", ctx.history)?.unitPrice).toBe("1800");
    expect(suggestPrice("Plumbing", "", null, "EUR", ctx.history)).toBeNull();
    expect(suggestPrice("Logo design", "", null, "USD", ctx.history)).toBeNull();
  });
});
