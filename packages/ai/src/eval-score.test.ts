import { describe, expect, it } from "vitest";
import { score } from "../evals/run";
import { CASES } from "../evals/cases";
import type { DraftOutput } from "./schema";

describe("eval scorer", () => {
  const canonical = CASES.find((c) => c.id === "canonical");
  const perfect: DraftOutput = {
    client: {
      matchedClientId: "c-acme",
      name: "Acme Corp",
      email: null,
      country: null,
      vatId: null,
    },
    currency: "USD",
    issueDate: null,
    supplyDate: null,
    dueDate: null,
    paymentTermsDays: 30,
    reference: null,
    language: null,
    lines: [
      {
        description: "Consulting",
        quantity: "10.0",
        unit: "h",
        unitPrice: "120.00",
        discountPercent: null,
        taxHint: null,
      },
    ],
    discount: null,
    notes: null,
    copyFromPrevious: false,
    uncertainFields: [],
    assumptions: [],
  };

  it("passes a perfect answer, comparing decimals by value", () => {
    expect(canonical).toBeDefined();
    expect(score(canonical!, perfect).every((c) => c.pass)).toBe(true);
  });

  it("fails wrong values with details", () => {
    const bad = score(canonical!, {
      ...perfect,
      currency: "EUR",
      lines: [{ ...perfect.lines[0]!, unitPrice: "12" }],
    });
    expect(bad.filter((c) => !c.pass).map((c) => c.name)).toEqual(["currency", "line0.price"]);
  });

  it("has unique case ids", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });
});
