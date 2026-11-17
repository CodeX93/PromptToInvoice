import "server-only";
import { COUNTRY_CODES, countryName } from "@pti/core";

let cache: { code: string; name: string }[] | undefined;

/** Country picker options, localised on the server (stable across SSR/hydration) and memoised. */
export function countryOptions(): { code: string; name: string }[] {
  cache ??= COUNTRY_CODES.map((c) => ({ code: c, name: countryName(c) })).sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}
