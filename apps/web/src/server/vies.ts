import "server-only";
import { parseEuVatId } from "@pti/core";
import { logger } from "./logger";

export type ViesResult =
  | { status: "valid"; name: string | null; address: string | null; checkedAt: Date }
  | { status: "invalid"; checkedAt: Date }
  | { status: "malformed" }
  | { status: "unavailable"; reason: string };

/**
 * Check an EU VAT number against the European Commission's VIES REST API.
 * VIES member-state backends are often down, so "unavailable" is a normal
 * outcome that the UI shows as "couldn't verify right now" rather than an error.
 */
export async function checkVies(raw: string, timeoutMs = 6000): Promise<ViesResult> {
  const parsed = parseEuVatId(raw);
  if (!parsed) return { status: "malformed" };
  const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${parsed.country.vatPrefix}/vat/${parsed.number}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { status: "unavailable", reason: `HTTP ${res.status}` };
    const body = (await res.json()) as { isValid?: boolean; name?: string; address?: string; userError?: string };
    if (body.userError && body.userError !== "VALID" && body.userError !== "INVALID") {
      return { status: "unavailable", reason: body.userError };
    }
    const clean = (s?: string) => (s && s !== "---" ? s.replace(/\s+/g, " ").trim() : null);
    return body.isValid
      ? { status: "valid", name: clean(body.name), address: clean(body.address), checkedAt: new Date() }
      : { status: "invalid", checkedAt: new Date() };
  } catch (err) {
    logger.warn({ err, country: parsed.country.code }, "VIES lookup failed");
    return { status: "unavailable", reason: err instanceof Error ? err.name : "network" };
  }
}
