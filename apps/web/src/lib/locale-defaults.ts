import { euCountry, type CurrencyCode } from "@pti/core";

const NON_EU_CURRENCY: Record<string, CurrencyCode> = {
  US: "USD", GB: "GBP", CH: "CHF", NO: "NOK", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY", SG: "SGD", AE: "AED", IN: "INR", PK: "PKR",
};

/** Sensible default invoicing currency for a seller country. */
export function defaultCurrencyFor(country: string): CurrencyCode {
  const eu = euCountry(country);
  if (eu) return eu.currency as CurrencyCode;
  return NON_EU_CURRENCY[country] ?? "USD";
}

/** Best guess of the user's country from their browser locale ("de-DE" → DE). */
export function guessCountry(locale: string | undefined, fallback = "US"): string {
  const region = locale?.split("-")[1]?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : fallback;
}
