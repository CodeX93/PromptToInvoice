import { describe, expect, it } from "vitest";
import { suggestTaxTreatment, type TreatmentInput } from "./tax";

const base: TreatmentInput = {
  sellerCountry: "DE",
  buyerCountry: "DE",
  buyerIsBusiness: true,
  buyerVatIdValid: true,
  sellerVatExempt: false,
  supply: "services",
};

describe("suggestTaxTreatment", () => {
  it("applies the domestic standard rate", () => {
    expect(suggestTaxTreatment(base)).toMatchObject({ category: "S", rate: "19", reason: "domestic" });
  });

  it("uses reverse charge for intra-EU B2B services with a valid VAT ID", () => {
    expect(suggestTaxTreatment({ ...base, buyerCountry: "FR" })).toMatchObject({
      category: "AE",
      rate: "0",
      reason: "eu-b2b-reverse-charge",
    });
  });

  it("uses K for intra-EU B2B goods", () => {
    expect(suggestTaxTreatment({ ...base, buyerCountry: "NL", supply: "goods" }).category).toBe("K");
  });

  it("charges seller VAT when the EU buyer has no valid VAT ID", () => {
    expect(
      suggestTaxTreatment({ ...base, buyerCountry: "FR", buyerVatIdValid: false }),
    ).toMatchObject({ category: "S", rate: "19", reason: "eu-b2c" });
  });

  it("treats B2B services to non-EU customers as outside scope", () => {
    expect(suggestTaxTreatment({ ...base, buyerCountry: "US" })).toMatchObject({
      category: "O",
      reason: "export-services",
    });
  });

  it("treats goods to non-EU customers as exports", () => {
    expect(suggestTaxTreatment({ ...base, buyerCountry: "US", supply: "goods" }).category).toBe("G");
  });

  it("respects seller small-business exemption", () => {
    expect(suggestTaxTreatment({ ...base, sellerVatExempt: true }).category).toBe("E");
  });

  it("does not apply EU rules to non-EU sellers", () => {
    expect(suggestTaxTreatment({ ...base, sellerCountry: "US", buyerCountry: "DE" })).toMatchObject({
      category: "O",
      rate: "0",
      reason: "non-eu-seller",
    });
  });

  it("uses Finland's 25.5% rate", () => {
    expect(suggestTaxTreatment({ ...base, sellerCountry: "FI", buyerCountry: "FI" }).rate).toBe("25.5");
  });
});
