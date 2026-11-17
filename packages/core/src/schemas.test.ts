import { describe, expect, it } from "vitest";
import {
  addressSchema,
  euVatIdSchema,
  ibanSchema,
  invoiceDraftSchema,
  lineItemSchema,
} from "./schemas";

const validLine = {
  description: "Consulting",
  quantity: "10",
  unitPrice: "120",
  taxCategory: "S",
  taxRate: "19",
};

describe("schemas", () => {
  it("parses a line item with defaults", () => {
    expect(lineItemSchema.parse(validLine)).toMatchObject({ unit: "", quantity: "10" });
  });

  it("rejects excessive precision and bad percents", () => {
    expect(lineItemSchema.safeParse({ ...validLine, quantity: "1.23456" }).success).toBe(false);
    expect(lineItemSchema.safeParse({ ...validLine, taxRate: "101" }).success).toBe(false);
  });

  it("normalises VAT IDs and IBANs", () => {
    expect(euVatIdSchema.parse(" de 123 456 789 ")).toBe("DE123456789");
    expect(ibanSchema.parse("de89 3704 0044 0532 0130 00")).toBe("DE89370400440532013000");
    expect(ibanSchema.safeParse("DE00").success).toBe(false);
  });

  it("uppercases countries", () => {
    expect(addressSchema.parse({ country: "de" }).country).toBe("DE");
  });

  it("validates due date ordering", () => {
    const base = {
      businessProfileId: "0190a6f0-0000-7000-8000-000000000000",
      clientId: null,
      currency: "EUR",
      issueDate: "2026-05-10",
      lines: [validLine],
    };
    expect(invoiceDraftSchema.safeParse({ ...base, dueDate: "2026-06-09" }).success).toBe(true);
    const bad = invoiceDraftSchema.safeParse({ ...base, dueDate: "2026-05-01" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["dueDate"]);
  });
});
