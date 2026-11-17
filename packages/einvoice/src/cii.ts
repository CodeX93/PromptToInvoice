import { fromMinor, normalizeDecimal, parseDecimal, formatDecimal } from "@pti/core";
import type { EInvoice, EParty } from "./model";

/**
 * UN/CEFACT Cross Industry Invoice (CII D16B) serialisation of EN 16931.
 * Used for Factur-X / ZUGFeRD (embedded in PDF/A-3) and XRechnung (CII
 * syntax). Element order follows the XSD sequence, which validators enforce.
 */

export type CiiProfile = "en16931" | "xrechnung";

const GUIDELINE: Record<CiiProfile, string> = {
  en16931: "urn:cen.eu:en16931:2017",
  xrechnung: "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
};

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) =>
    c === "<"
      ? "&lt;"
      : c === ">"
        ? "&gt;"
        : c === "&"
          ? "&amp;"
          : c === "'"
            ? "&apos;"
            : c === '"'
              ? "&quot;"
              : "",
  );
}

/** Tiny builder: e(tag, children | text, attrs). Omits elements whose content is null/undefined/"". */
type Node = string | null | undefined | false;
function e(tag: string, content: Node | Node[], attrs: Record<string, string> = {}): string {
  const inner = Array.isArray(content) ? content.filter(Boolean).join("") : content;
  if (inner === null || inner === undefined || inner === false || inner === "") return "";
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
  return `<${tag}${a}>${inner}</${tag}>`;
}
const t = (tag: string, text: string | null | undefined, attrs: Record<string, string> = {}) =>
  text ? e(tag, escapeXml(text), attrs) : "";
const date = (iso: string) => e("udt:DateTimeString", iso.replace(/-/g, ""), { format: "102" });
const pct = (r: string) => formatDecimal(normalizeDecimal(parseDecimal(r)));

function party(tag: string, p: EParty, profile: CiiProfile, role: "seller" | "buyer"): string {
  const a = p.address;
  const contact =
    role === "seller" && profile === "xrechnung"
      ? e("ram:DefinedTradeContact", [
          t("ram:PersonName", p.contactName ?? p.name),
          e("ram:TelephoneUniversalCommunication", t("ram:CompleteNumber", p.phone ?? "")),
          e("ram:EmailURIUniversalCommunication", t("ram:URIID", p.email ?? "")),
        ])
      : "";
  return e(tag, [
    t("ram:Name", p.name),
    p.registration ? e("ram:SpecifiedLegalOrganization", t("ram:ID", p.registration)) : "",
    contact,
    e("ram:PostalTradeAddress", [
      t("ram:PostcodeCode", a.postalCode),
      t("ram:LineOne", a.line1),
      t("ram:LineTwo", a.line2),
      t("ram:CityName", a.city),
      t("ram:CountryID", a.country),
      t("ram:CountrySubDivisionName", a.region),
    ]),
    p.email ? e("ram:URIUniversalCommunication", t("ram:URIID", p.email, { schemeID: "EM" })) : "",
    p.vatId ? e("ram:SpecifiedTaxRegistration", t("ram:ID", p.vatId, { schemeID: "VA" })) : "",
    p.taxId ? e("ram:SpecifiedTaxRegistration", t("ram:ID", p.taxId, { schemeID: "FC" })) : "",
  ]);
}

export function toCii(inv: EInvoice, profile: CiiProfile = "en16931"): string {
  const m = (minor: number) => fromMinor(minor, inv.currency);

  const lines = inv.lines.map((l) =>
    e("ram:IncludedSupplyChainTradeLineItem", [
      e("ram:AssociatedDocumentLineDocument", t("ram:LineID", l.id)),
      e("ram:SpecifiedTradeProduct", t("ram:Name", l.name)),
      e(
        "ram:SpecifiedLineTradeAgreement",
        e(
          "ram:NetPriceProductTradePrice",
          t("ram:ChargeAmount", formatDecimal(normalizeDecimal(parseDecimal(l.netPrice)))),
        ),
      ),
      e(
        "ram:SpecifiedLineTradeDelivery",
        t("ram:BilledQuantity", formatDecimal(normalizeDecimal(parseDecimal(l.quantity))), {
          unitCode: l.unitCode,
        }),
      ),
      e("ram:SpecifiedLineTradeSettlement", [
        e("ram:ApplicableTradeTax", [
          t("ram:TypeCode", "VAT"),
          t("ram:CategoryCode", l.taxCategory),
          t("ram:RateApplicablePercent", pct(l.taxRate)),
        ]),
        l.allowance > 0
          ? e("ram:SpecifiedTradeAllowanceCharge", [
              e("ram:ChargeIndicator", e("udt:Indicator", "false")),
              t("ram:ActualAmount", m(l.allowance)),
              t("ram:Reason", "Discount"),
            ])
          : "",
        e(
          "ram:SpecifiedTradeSettlementLineMonetarySummation",
          t("ram:LineTotalAmount", m(l.lineTotal)),
        ),
      ]),
    ]),
  );

  const taxes = inv.breakdown.map((b) =>
    e("ram:ApplicableTradeTax", [
      t("ram:CalculatedAmount", m(b.tax)),
      t("ram:TypeCode", "VAT"),
      b.category !== "S" && b.category !== "Z"
        ? t("ram:ExemptionReason", b.exemptionReason ?? "")
        : "",
      t("ram:BasisAmount", m(b.taxable)),
      t("ram:CategoryCode", b.category),
      t("ram:RateApplicablePercent", pct(b.rate)),
    ]),
  );

  const allowances = inv.allowances
    .filter((a) => a.amount !== 0)
    .map((a) =>
      e("ram:SpecifiedTradeAllowanceCharge", [
        e("ram:ChargeIndicator", e("udt:Indicator", "false")),
        t("ram:BasisAmount", m(a.base)),
        t("ram:ActualAmount", m(a.amount)),
        t("ram:Reason", a.reason),
        e("ram:CategoryTradeTax", [
          t("ram:TypeCode", "VAT"),
          t("ram:CategoryCode", a.taxCategory),
          t("ram:RateApplicablePercent", pct(a.taxRate)),
        ]),
      ]),
    );

  const T = inv.totals;
  const body = [
    e(
      "rsm:ExchangedDocumentContext",
      e("ram:GuidelineSpecifiedDocumentContextParameter", t("ram:ID", GUIDELINE[profile])),
    ),
    e("rsm:ExchangedDocument", [
      t("ram:ID", inv.number),
      t("ram:TypeCode", inv.typeCode),
      e("ram:IssueDateTime", date(inv.issueDate)),
      ...inv.notes.filter((n) => n.trim()).map((n) => e("ram:IncludedNote", t("ram:Content", n))),
    ]),
    e("rsm:SupplyChainTradeTransaction", [
      ...lines,
      e("ram:ApplicableHeaderTradeAgreement", [
        t("ram:BuyerReference", inv.buyerReference ?? (profile === "xrechnung" ? "n/a" : "")),
        party("ram:SellerTradeParty", inv.seller, profile, "seller"),
        party("ram:BuyerTradeParty", inv.buyer, profile, "buyer"),
        inv.orderReference
          ? e("ram:BuyerOrderReferencedDocument", t("ram:IssuerAssignedID", inv.orderReference))
          : "",
      ]),
      // Required even when empty.
      inv.supplyDate
        ? e(
            "ram:ApplicableHeaderTradeDelivery",
            e(
              "ram:ActualDeliverySupplyChainEvent",
              e("ram:OccurrenceDateTime", date(inv.supplyDate)),
            ),
          )
        : "<ram:ApplicableHeaderTradeDelivery/>",
      e("ram:ApplicableHeaderTradeSettlement", [
        t("ram:PaymentReference", inv.payment?.reference ?? inv.number),
        t("ram:InvoiceCurrencyCode", inv.currency),
        inv.payment
          ? e("ram:SpecifiedTradeSettlementPaymentMeans", [
              t("ram:TypeCode", "58"),
              e("ram:PayeePartyCreditorFinancialAccount", [
                t("ram:IBANID", inv.payment.iban),
                t("ram:AccountName", inv.payment.accountName ?? ""),
              ]),
              inv.payment.bic
                ? e(
                    "ram:PayeeSpecifiedCreditorFinancialInstitution",
                    t("ram:BICID", inv.payment.bic),
                  )
                : "",
            ])
          : profile === "xrechnung"
            ? e("ram:SpecifiedTradeSettlementPaymentMeans", t("ram:TypeCode", "1"))
            : "",
        ...taxes,
        ...allowances,
        inv.dueDate || inv.paymentTerms
          ? e("ram:SpecifiedTradePaymentTerms", [
              t("ram:Description", inv.paymentTerms ?? ""),
              inv.dueDate ? e("ram:DueDateDateTime", date(inv.dueDate)) : "",
            ])
          : "",
        e("ram:SpecifiedTradeSettlementHeaderMonetarySummation", [
          t("ram:LineTotalAmount", m(T.lineTotal)),
          T.allowanceTotal ? t("ram:AllowanceTotalAmount", m(T.allowanceTotal)) : "",
          t("ram:TaxBasisTotalAmount", m(T.taxBasis)),
          t("ram:TaxTotalAmount", m(T.taxTotal), { currencyID: inv.currency }),
          t("ram:GrandTotalAmount", m(T.grandTotal)),
          T.prepaid ? t("ram:TotalPrepaidAmount", m(T.prepaid)) : "",
          t("ram:DuePayableAmount", m(T.duePayable)),
        ]),
        inv.preceding
          ? e("ram:InvoiceReferencedDocument", [
              t("ram:IssuerAssignedID", inv.preceding.number),
              inv.preceding.issueDate
                ? e(
                    "ram:FormattedIssueDateTime",
                    e("qdt:DateTimeString", inv.preceding.issueDate.replace(/-/g, ""), {
                      format: "102",
                    }),
                  )
                : "",
            ])
          : "",
      ]),
    ]),
  ];

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">` +
    body.join("") +
    `</rsm:CrossIndustryInvoice>\n`
  );
}
