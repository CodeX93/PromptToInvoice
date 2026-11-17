import { describe, expect, it } from "vitest";
import { applyTaxTreatment, blankLine, computeTotals, moveLine, taxSuggestion, toPayload, withClient, type EditorState } from "./invoice-editor";

const base = (): EditorState => ({
  businessProfileId: "00000000-0000-4000-8000-000000000000",
  client: null,
  currency: "EUR",
  issueDate: "2026-11-17",
  supplyDate: "",
  dueDate: "2026-12-01",
  language: "en",
  reference: "",
  lines: [{ ...blankLine("S", "19"), description: "Design", quantity: "2", unitPrice: "1.200,50" }, blankLine("S", "19")],
  discount: null,
  notes: "",
  terms: "",
  taxNote: "",
});

const client = { id: "c1", name: "Acme SAS", email: null, country: "FR", vatId: "FRAB123456789", isBusiness: true, vatIdValid: true, currency: null, paymentTermsDays: 30 };

describe("invoice editor state", () => {
  it("normalises numbers and drops blank lines in the payload", () => {
    const p = toPayload(base());
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]?.unitPrice).toBe("1200.50");
  });

  it("computes live totals with the core engine", () => {
    const t = computeTotals(base());
    expect(t.ok && t.result.taxInclusive).toBe(285719);
  });

  it("reports which line is invalid", () => {
    const s = base();
    s.lines[0] = { ...s.lines[0]!, quantity: "two" };
    const t = computeTotals(s);
    expect(t).toMatchObject({ ok: false, lineIndex: 0 });
  });

  it("suggests reverse charge for an EU business client and applies it", () => {
    const s = withClient(base(), client, 14);
    expect(s.dueDate).toBe("2026-12-17");
    const sug = taxSuggestion(s, { country: "DE", vatExempt: false });
    expect(sug?.category).toBe("AE");
    const applied = applyTaxTreatment(s, sug!);
    expect(applied.lines.every((l) => l.taxCategory === "AE" && l.taxRate === "0")).toBe(true);
    expect(applied.taxNote).toMatch(/Reverse charge/);
    expect(taxSuggestion(applied, { country: "DE", vatExempt: false })).toBeNull();
  });

  it("moves lines", () => {
    const s = base();
    expect(moveLine(s.lines, 0, 1)[1]?.description).toBe("Design");
    expect(moveLine(s.lines, 0, -1)).toBe(s.lines);
  });
});
