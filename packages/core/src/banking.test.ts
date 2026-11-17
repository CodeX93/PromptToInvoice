import { describe, expect, it } from "vitest";
import { epcQrPayload, formatIban, isValidBic, isValidIban } from "./banking";

describe("IBAN", () => {
  it.each([
    "DE89 3704 0044 0532 0130 00",
    "GB82WEST12345698765432",
    "NL91ABNA0417164300",
    "FR1420041010050500013M02606",
  ])("accepts %s", (iban) => {
    expect(isValidIban(iban)).toBe(true);
  });

  it.each(["DE89370400440532013001", "DE8937040044053201300", "XX00", "GB82WEST1234569876543"])(
    "rejects %s",
    (iban) => {
      expect(isValidIban(iban)).toBe(false);
    },
  );

  it("formats in groups of four", () => {
    expect(formatIban("de89370400440532013000")).toBe("DE89 3704 0044 0532 0130 00");
  });

  it("validates BICs", () => {
    expect(isValidBic("COBADEFFXXX")).toBe(true);
    expect(isValidBic("COBADEFF")).toBe(true);
    expect(isValidBic("COBA1EFF")).toBe(false);
  });
});

describe("epcQrPayload", () => {
  it("builds a spec-compliant payload", () => {
    expect(
      epcQrPayload({
        name: "Studio Example GmbH",
        iban: "DE89 3704 0044 0532 0130 00",
        bic: "COBADEFFXXX",
        amountCents: 123456,
        remittance: "INV-2026-0042",
      }),
    ).toBe(
      [
        "BCD",
        "002",
        "1",
        "SCT",
        "COBADEFFXXX",
        "Studio Example GmbH",
        "DE89370400440532013000",
        "EUR1234.56",
        "",
        "",
        "INV-2026-0042",
      ].join("\n"),
    );
  });

  it("rejects bad input", () => {
    expect(() =>
      epcQrPayload({ name: "x", iban: "bad", amountCents: 1, remittance: "" }),
    ).toThrow();
    expect(() =>
      epcQrPayload({ name: "x", iban: "DE89370400440532013000", amountCents: 0, remittance: "" }),
    ).toThrow();
  });
});
