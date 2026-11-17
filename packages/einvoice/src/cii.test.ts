import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { calculate } from "@pti/core";
import { toCii, escapeXml } from "./cii";
import { facturXXmp } from "./facturx";
import { unitCode, type EInvoice } from "./model";

const seller = { name: "Lindqvist Studio GmbH", address: { line1: "Torstraße 12", line2: "", city: "Berlin", postalCode: "10119", region: "", country: "DE" }, vatId: "DE123456789", email: "billing@lindqvist.test", phone: "+49 30 123" };
const buyer = { name: "Atelier Lumière SAS", address: { line1: "12 Rue de Rivoli", line2: "", city: "Paris", postalCode: "75004", region: "", country: "FR" }, vatId: "FR40303265045" };

function invoice(): EInvoice {
  const lines = [
    { quantity: "16", unitPrice: "110", taxCategory: "S" as const, taxRate: "19", discountPercent: "10" },
    { quantity: "1", unitPrice: "39.90", taxCategory: "S" as const, taxRate: "19", discountPercent: null },
  ];
  const r = calculate({ currency: "EUR", lines, discount: { type: "percent", value: "5" } });
  return {
    number: "INV-2026-0042",
    typeCode: "380",
    issueDate: "2026-11-17",
    dueDate: "2026-12-01",
    currency: "EUR",
    buyerReference: "PO-77",
    notes: ["Thank you & goodbye <3"],
    paymentTerms: "Payable within 14 days",
    seller,
    buyer,
    payment: { iban: "DE89370400440532013000", bic: "COBADEFFXXX", accountName: seller.name, reference: "INV-2026-0042" },
    lines: lines.map((l, i) => ({ id: String(i + 1), name: i ? "Hosting" : "Implementation", quantity: l.quantity, unitCode: unitCode(i ? "" : "h"), netPrice: l.unitPrice, allowance: r.lines[i]!.lineDiscount, lineTotal: r.lines[i]!.net, taxCategory: l.taxCategory, taxRate: l.taxRate })),
    allowances: r.breakdown.map((b) => ({ amount: b.discount, base: b.lineNet, reason: "Discount", taxCategory: b.category, taxRate: b.rate })),
    breakdown: r.breakdown.map((b) => ({ category: b.category, rate: b.rate, taxable: b.taxable, tax: b.tax })),
    totals: { lineTotal: r.lineNetTotal, allowanceTotal: r.discountTotal, taxBasis: r.taxExclusive, taxTotal: r.taxTotal, grandTotal: r.taxInclusive, prepaid: 0, duePayable: r.taxInclusive },
  };
}

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, isArray: (n) => ["IncludedSupplyChainTradeLineItem", "ApplicableTradeTax", "SpecifiedTradeAllowanceCharge", "IncludedNote"].includes(n) });
const num = (s: unknown) => Number(s);

/** EN 16931 arithmetic business rules, checked on the serialised XML. */
function checkBusinessRules(xml: string) {
  const doc = parser.parse(xml).CrossIndustryInvoice;
  const tx = doc.SupplyChainTradeTransaction;
  const settle = tx.ApplicableHeaderTradeSettlement;
  const sum = settle.SpecifiedTradeSettlementHeaderMonetarySummation;
  const lineSum = tx.IncludedSupplyChainTradeLineItem.reduce((a: number, l: { SpecifiedLineTradeSettlement: { SpecifiedTradeSettlementLineMonetarySummation: { LineTotalAmount: string } } }) => a + num(l.SpecifiedLineTradeSettlement.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount), 0);
  const allowances = (settle.SpecifiedTradeAllowanceCharge ?? []).reduce((a: number, x: { ActualAmount: string }) => a + num(x.ActualAmount), 0);
  const taxes = settle.ApplicableTradeTax as { CalculatedAmount: string; BasisAmount: string; RateApplicablePercent: string }[];
  const round2 = (n: number) => Math.round(n * 100) / 100;
  expect(round2(lineSum)).toBe(num(sum.LineTotalAmount)); // BR-CO-10
  expect(round2(allowances)).toBe(num(sum.AllowanceTotalAmount ?? 0)); // BR-CO-11
  expect(round2(num(sum.LineTotalAmount) - allowances)).toBe(num(sum.TaxBasisTotalAmount)); // BR-CO-13
  expect(round2(taxes.reduce((a, x) => a + num(x.CalculatedAmount), 0))).toBe(num(sum.TaxTotalAmount["#text"])); // BR-CO-14
  expect(round2(num(sum.TaxBasisTotalAmount) + num(sum.TaxTotalAmount["#text"]))).toBe(num(sum.GrandTotalAmount)); // BR-CO-15
  expect(round2(num(sum.GrandTotalAmount) - num(sum.TotalPrepaidAmount ?? 0))).toBe(num(sum.DuePayableAmount)); // BR-CO-16
  for (const x of taxes) expect(Math.abs(num(x.BasisAmount) * num(x.RateApplicablePercent) / 100 - num(x.CalculatedAmount))).toBeLessThanOrEqual(0.01); // BR-S-09
  return doc;
}

describe("CII", () => {
  it("serialises a well-formed EN 16931 invoice that satisfies the arithmetic rules", () => {
    const xml = toCii(invoice());
    const doc = checkBusinessRules(xml);
    expect(doc.ExchangedDocumentContext.GuidelineSpecifiedDocumentContextParameter.ID).toBe("urn:cen.eu:en16931:2017");
    expect(doc.ExchangedDocument.TypeCode).toBe("380");
    expect(doc.ExchangedDocument.IssueDateTime.DateTimeString["#text"]).toBe("20261117");
    const agreement = doc.SupplyChainTradeTransaction.ApplicableHeaderTradeAgreement;
    expect(agreement.SellerTradeParty.SpecifiedTaxRegistration.ID).toEqual({ "#text": "DE123456789", "@_schemeID": "VA" });
    expect(agreement.BuyerReference).toBe("PO-77");
    expect(doc.SupplyChainTradeTransaction.IncludedSupplyChainTradeLineItem[0].SpecifiedLineTradeDelivery.BilledQuantity["@_unitCode"]).toBe("HUR");
  });

  it("escapes markup in free text", () => {
    expect(toCii(invoice())).toContain("Thank you &amp; goodbye &lt;3");
    expect(escapeXml("a\u0001b")).toBe("ab");
  });

  it("keeps XSD element order in the settlement block", () => {
    const xml = toCii(invoice());
    const order = ["PaymentReference", "InvoiceCurrencyCode", "SpecifiedTradeSettlementPaymentMeans", "ApplicableTradeTax", "SpecifiedTradeAllowanceCharge", "SpecifiedTradePaymentTerms", "SpecifiedTradeSettlementHeaderMonetarySummation"];
    const settle = xml.slice(xml.indexOf("<ram:ApplicableHeaderTradeSettlement>"));
    const idx = order.map((tag) => settle.indexOf(`<ram:${tag}`));
    expect(idx.every((v, i) => v >= 0 && (i === 0 || v > (idx[i - 1] ?? -1)))).toBe(true);
  });

  it("writes reverse-charge exemption reasons and credit-note references", () => {
    const inv = invoice();
    inv.typeCode = "381";
    inv.preceding = { number: "INV-2026-0041", issueDate: "2026-11-01" };
    inv.breakdown = [{ category: "AE", rate: "0", taxable: inv.totals.taxBasis, tax: 0, exemptionReason: "Reverse charge" }];
    inv.totals = { ...inv.totals, taxTotal: 0, grandTotal: inv.totals.taxBasis, duePayable: inv.totals.taxBasis };
    inv.lines = inv.lines.map((l) => ({ ...l, taxCategory: "AE", taxRate: "0" }));
    inv.allowances = inv.allowances.map((a) => ({ ...a, taxCategory: "AE", taxRate: "0" }));
    const xml = toCii(inv);
    const doc = checkBusinessRules(xml);
    expect(doc.ExchangedDocument.TypeCode).toBe("381");
    expect(doc.SupplyChainTradeTransaction.ApplicableHeaderTradeSettlement.ApplicableTradeTax[0].ExemptionReason).toBe("Reverse charge");
    expect(doc.SupplyChainTradeTransaction.ApplicableHeaderTradeSettlement.InvoiceReferencedDocument.IssuerAssignedID).toBe("INV-2026-0041");
  });

  it("adds XRechnung specifics", () => {
    const xml = toCii(invoice(), "xrechnung");
    expect(xml).toContain("urn:xeinkauf.de:kosit:xrechnung_3.0");
    expect(xml).toContain("<ram:DefinedTradeContact>");
  });

  it("declares the Factur-X XMP extension", () => {
    const xmp = facturXXmp();
    expect(xmp).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
    expect(xmp).toContain("<pdfaSchema:prefix>fx</pdfaSchema:prefix>");
  });

  it("maps units to UN/ECE Rec. 20", () => {
    expect([unitCode("h"), unitCode("Tage"), unitCode("pcs"), unitCode("")]).toEqual(["HUR", "DAY", "H87", "C62"]);
  });
});
