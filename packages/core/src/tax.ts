import { euCountry, isEuCountry } from "./countries";

/**
 * VAT category codes (UNTDID 5305) as used by EN 16931.
 *  S  standard rate          Z  zero rated
 *  E  exempt                 AE reverse charge
 *  K  intra-community supply G  export outside the EU
 *  O  outside scope of tax
 */
export const TAX_CATEGORIES = ["S", "Z", "E", "AE", "K", "G", "O"] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const TAX_CATEGORY_LABEL: Readonly<Record<TaxCategory, string>> = {
  S: "Standard rate",
  Z: "Zero rated",
  E: "Exempt",
  AE: "Reverse charge",
  K: "Intra-community supply",
  G: "Export",
  O: "Outside scope",
};

/** Categories that must carry a 0% rate. */
export function isZeroRateCategory(category: TaxCategory): boolean {
  return category !== "S";
}

/** Categories that require an exemption reason on the invoice (EN 16931 BR-E/AE/K/G/O-10). */
export function requiresExemptionReason(category: TaxCategory): boolean {
  return (
    category === "E" ||
    category === "AE" ||
    category === "K" ||
    category === "G" ||
    category === "O"
  );
}

export const DEFAULT_EXEMPTION_NOTES: Readonly<Partial<Record<TaxCategory, string>>> = {
  AE: "Reverse charge: VAT to be accounted for by the recipient (Art. 196 Council Directive 2006/112/EC).",
  K: "VAT-exempt intra-community supply of goods (Art. 138 Council Directive 2006/112/EC).",
  G: "VAT-exempt export of goods outside the EU (Art. 146 Council Directive 2006/112/EC).",
  O: "Not subject to VAT: place of supply is outside the EU (Art. 44 Council Directive 2006/112/EC).",
  E: "VAT exempt.",
};

export interface TreatmentInput {
  sellerCountry: string;
  buyerCountry: string | null | undefined;
  /** Buyer acts as a business (B2B). We treat a valid VAT ID as proof for EU buyers. */
  buyerIsBusiness: boolean;
  buyerVatIdValid: boolean;
  /** Seller uses a domestic small-business exemption (e.g. DE §19 UStG). */
  sellerVatExempt: boolean;
  supply: "services" | "goods";
}

export interface TaxTreatment {
  category: TaxCategory;
  /** Suggested rate as a decimal percentage string. */
  rate: string;
  note: string | null;
  /** Machine-readable reason so the UI can explain the suggestion. */
  reason:
    | "seller-exempt"
    | "domestic"
    | "eu-b2b-reverse-charge"
    | "eu-b2b-goods"
    | "eu-b2c"
    | "export-services"
    | "export-goods"
    | "non-eu-seller";
}

/**
 * Suggest the VAT treatment for an invoice. This is a well-tested default for
 * common freelancer scenarios, not tax advice: the user can override it and
 * the UI says so.
 */
export function suggestTaxTreatment(input: TreatmentInput): TaxTreatment {
  const seller = euCountry(input.sellerCountry);
  if (!seller) {
    return { category: "O", rate: "0", note: null, reason: "non-eu-seller" };
  }
  if (input.sellerVatExempt) {
    return {
      category: "E",
      rate: "0",
      note: DEFAULT_EXEMPTION_NOTES.E ?? null,
      reason: "seller-exempt",
    };
  }
  const buyer = input.buyerCountry?.toUpperCase();
  const domestic = { category: "S", rate: seller.standardVatRate, note: null } as const;
  if (!buyer || buyer === seller.code) return { ...domestic, reason: "domestic" };

  if (isEuCountry(buyer)) {
    if (input.buyerIsBusiness && input.buyerVatIdValid) {
      return input.supply === "goods"
        ? {
            category: "K",
            rate: "0",
            note: DEFAULT_EXEMPTION_NOTES.K ?? null,
            reason: "eu-b2b-goods",
          }
        : {
            category: "AE",
            rate: "0",
            note: DEFAULT_EXEMPTION_NOTES.AE ?? null,
            reason: "eu-b2b-reverse-charge",
          };
    }
    return { ...domestic, reason: "eu-b2c" };
  }

  if (input.supply === "goods") {
    return {
      category: "G",
      rate: "0",
      note: DEFAULT_EXEMPTION_NOTES.G ?? null,
      reason: "export-goods",
    };
  }
  // B2B services to a non-EU customer: place of supply is the customer's country (Art. 44).
  // B2C services to non-EU customers generally stay taxable at the seller's rate.
  return input.buyerIsBusiness
    ? {
        category: "O",
        rate: "0",
        note: DEFAULT_EXEMPTION_NOTES.O ?? null,
        reason: "export-services",
      }
    : { ...domestic, reason: "eu-b2c" };
}
