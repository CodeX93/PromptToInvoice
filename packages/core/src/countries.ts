/**
 * Country metadata relevant to invoicing. Standard VAT rates are suggestions
 * used to pre-fill tax rates; the business owner remains responsible for the
 * rate they apply, and every rate is editable in the product.
 */

export interface EuCountry {
  /** ISO 3166-1 alpha-2 */
  readonly code: string;
  /** VAT ID prefix (differs from ISO for Greece: EL). */
  readonly vatPrefix: string;
  readonly standardVatRate: string;
  readonly currency: string;
  /** Pattern for the national part of the VAT ID (after the prefix). */
  readonly vatPattern: RegExp;
}

const eu = (
  code: string,
  vatPrefix: string,
  standardVatRate: string,
  currency: string,
  vatPattern: RegExp,
): EuCountry => ({ code, vatPrefix, standardVatRate, currency, vatPattern });

export const EU_COUNTRIES: readonly EuCountry[] = [
  eu("AT", "AT", "20", "EUR", /^U\d{8}$/),
  eu("BE", "BE", "21", "EUR", /^[01]\d{9}$/),
  eu("BG", "BG", "20", "EUR", /^\d{9,10}$/),
  eu("HR", "HR", "25", "EUR", /^\d{11}$/),
  eu("CY", "CY", "19", "EUR", /^\d{8}[A-Z]$/),
  eu("CZ", "CZ", "21", "CZK", /^\d{8,10}$/),
  eu("DK", "DK", "25", "DKK", /^\d{8}$/),
  eu("EE", "EE", "24", "EUR", /^\d{9}$/),
  eu("FI", "FI", "25.5", "EUR", /^\d{8}$/),
  eu("FR", "FR", "20", "EUR", /^[0-9A-HJ-NP-Z]{2}\d{9}$/),
  eu("DE", "DE", "19", "EUR", /^\d{9}$/),
  eu("GR", "EL", "24", "EUR", /^\d{9}$/),
  eu("HU", "HU", "27", "HUF", /^\d{8}$/),
  eu("IE", "IE", "23", "EUR", /^\d{7}[A-W][A-I]?$|^\d[A-Z+*]\d{5}[A-W]$/),
  eu("IT", "IT", "22", "EUR", /^\d{11}$/),
  eu("LV", "LV", "21", "EUR", /^\d{11}$/),
  eu("LT", "LT", "21", "EUR", /^(\d{9}|\d{12})$/),
  eu("LU", "LU", "17", "EUR", /^\d{8}$/),
  eu("MT", "MT", "18", "EUR", /^\d{8}$/),
  eu("NL", "NL", "21", "EUR", /^\d{9}B\d{2}$/),
  eu("PL", "PL", "23", "PLN", /^\d{10}$/),
  eu("PT", "PT", "23", "EUR", /^\d{9}$/),
  eu("RO", "RO", "21", "RON", /^\d{2,10}$/),
  eu("SK", "SK", "23", "EUR", /^\d{10}$/),
  eu("SI", "SI", "22", "EUR", /^\d{8}$/),
  eu("ES", "ES", "21", "EUR", /^[0-9A-Z]\d{7}[0-9A-Z]$/),
  eu("SE", "SE", "25", "SEK", /^\d{12}$/),
];

const EU_BY_CODE = new Map(EU_COUNTRIES.map((c) => [c.code, c]));
const EU_BY_VAT_PREFIX = new Map(EU_COUNTRIES.map((c) => [c.vatPrefix, c]));

export function isEuCountry(code: string | null | undefined): boolean {
  return code != null && EU_BY_CODE.has(code.toUpperCase());
}

export function euCountry(code: string): EuCountry | undefined {
  return EU_BY_CODE.get(code.toUpperCase());
}

export interface ParsedVatId {
  readonly country: EuCountry;
  /** Normalised, prefix included: "DE123456789". */
  readonly normalized: string;
  readonly number: string;
}

/** Strip spaces, dots and dashes users commonly paste in. */
export function normalizeVatId(raw: string): string {
  return raw.toUpperCase().replace(/[\s.\-/]/g, "");
}

/**
 * Validate the *format* of an EU VAT ID. Existence is verified separately
 * against VIES (network call, see the clients module).
 */
export function parseEuVatId(raw: string): ParsedVatId | null {
  const normalized = normalizeVatId(raw);
  const prefix = normalized.slice(0, 2);
  const country = EU_BY_VAT_PREFIX.get(prefix);
  if (!country) return null;
  const number = normalized.slice(2);
  return country.vatPattern.test(number) ? { country, normalized, number } : null;
}

/** ISO 3166-1 alpha-2 codes, used for address pickers. Display names come from Intl. */
export const COUNTRY_CODES: readonly string[] =
  "AD AE AL AR AT AU BA BE BG BR BY CA CH CL CN CO CY CZ DE DK EE EG ES FI FR GB GE GR HK HR HU ID IE IL IN IS IT JP KR KZ LI LT LU LV MA MC MD ME MK MT MX MY NG NL NO NZ PE PH PK PL PT QA RO RS RU SA SE SG SI SK SM TH TR TW UA US UY VN ZA".split(
    " ",
  );

const displayNamesCache = new Map<string, Intl.DisplayNames>();

export function countryName(code: string, locale = "en"): string {
  let dn = displayNamesCache.get(locale);
  if (!dn) {
    dn = new Intl.DisplayNames([locale], { type: "region" });
    displayNamesCache.set(locale, dn);
  }
  return dn.of(code.toUpperCase()) ?? code;
}
