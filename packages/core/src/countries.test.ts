import { describe, expect, it } from "vitest";
import { countryName, isEuCountry, normalizeVatId, parseEuVatId } from "./countries";

describe("EU VAT IDs", () => {
  it.each([
    ["DE 123 456 789", "DE123456789"],
    ["de123456789", "DE123456789"],
    ["NL123456789B01", "NL123456789B01"],
    ["ATU12345678", "ATU12345678"],
    ["EL123456789", "EL123456789"],
    ["FR AB123456789", "FRAB123456789"],
    ["IE1234567T", "IE1234567T"],
  ])("accepts %s", (raw, normalized) => {
    expect(parseEuVatId(raw)?.normalized).toBe(normalized);
  });

  it.each(["DE12345678", "GR123456789", "US123456789", "NL123456789", "", "ATU1234"])(
    "rejects %s",
    (raw) => {
      expect(parseEuVatId(raw)).toBeNull();
    },
  );

  it("maps Greece's EL prefix to GR", () => {
    expect(parseEuVatId("EL123456789")?.country.code).toBe("GR");
  });

  it("normalises separators", () => {
    expect(normalizeVatId("be 0123.456.789")).toBe("BE0123456789");
  });
});

describe("countries", () => {
  it("knows EU membership", () => {
    expect(isEuCountry("de")).toBe(true);
    expect(isEuCountry("GB")).toBe(false);
    expect(isEuCountry(null)).toBe(false);
  });

  it("resolves display names", () => {
    expect(countryName("DE", "en")).toBe("Germany");
    expect(countryName("DE", "de")).toBe("Deutschland");
  });
});
