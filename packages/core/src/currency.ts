/**
 * ISO 4217 currencies supported by the platform, with their minor-unit exponent.
 * Kept as a const tuple so the union type and the runtime list never drift.
 */
export const CURRENCIES = [
  ["USD", 2, "US Dollar"],
  ["EUR", 2, "Euro"],
  ["GBP", 2, "Pound Sterling"],
  ["CHF", 2, "Swiss Franc"],
  ["SEK", 2, "Swedish Krona"],
  ["NOK", 2, "Norwegian Krone"],
  ["DKK", 2, "Danish Krone"],
  ["PLN", 2, "Polish Złoty"],
  ["CZK", 2, "Czech Koruna"],
  ["HUF", 2, "Hungarian Forint"],
  ["RON", 2, "Romanian Leu"],
  ["BGN", 2, "Bulgarian Lev"],
  ["CAD", 2, "Canadian Dollar"],
  ["AUD", 2, "Australian Dollar"],
  ["NZD", 2, "New Zealand Dollar"],
  ["JPY", 0, "Japanese Yen"],
  ["SGD", 2, "Singapore Dollar"],
  ["AED", 2, "UAE Dirham"],
  ["INR", 2, "Indian Rupee"],
  ["PKR", 2, "Pakistani Rupee"],
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number][0];

const EXPONENTS: ReadonlyMap<string, number> = new Map(CURRENCIES.map(([c, e]) => [c, e]));
const NAMES: ReadonlyMap<string, string> = new Map(CURRENCIES.map(([c, , n]) => [c, n]));

export const CURRENCY_CODES: readonly CurrencyCode[] = CURRENCIES.map(([c]) => c);

/** Currencies available on the free plan. */
export const BASE_CURRENCIES: readonly CurrencyCode[] = ["USD", "EUR"];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && EXPONENTS.has(value);
}

export function minorUnitExponent(currency: CurrencyCode): number {
  // Map lookup cannot miss for a CurrencyCode; the fallback only satisfies the type checker.
  return EXPONENTS.get(currency) ?? 2;
}

export function currencyName(currency: CurrencyCode): string {
  return NAMES.get(currency) ?? currency;
}
