import type { DraftOutput } from "./schema";
import type { ExtractArgs, ExtractResult } from "./extract";

/**
 * Deterministic, offline stand-in for the model, used in local development
 * and end-to-end tests when no API key is configured. It understands the
 * common shapes ("10h consulting for Acme at $120/h, net 30") well enough to
 * exercise the whole pipeline. Never used in production (env validation
 * forbids it).
 */

const CURRENCY: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  eur: "EUR",
  usd: "USD",
  gbp: "GBP",
  chf: "CHF",
};
const UNIT: Record<string, string> = {
  h: "h",
  hr: "h",
  hrs: "h",
  hour: "h",
  hours: "h",
  d: "days",
  day: "days",
  days: "days",
  pcs: "pcs",
  pieces: "pcs",
};

function money(s: string): { value: string; currency: string | null } | null {
  const m = /([€$£])?\s?(\d[\d.,]*)\s?(eur|usd|gbp|chf|€)?/i.exec(s);
  if (!m?.[2]) return null;
  let v = m[2].replace(/[.,]$/, "");
  if (/\d,\d{3}(\D|$)/.test(v) && !/\.\d{1,2}$/.test(v)) v = v.replace(/,/g, "");
  else if (/\.\d{3},\d{1,2}$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else v = v.replace(",", ".");
  const cur = m[1] ?? m[3];
  return { value: v, currency: cur ? (CURRENCY[cur.toLowerCase()] ?? null) : null };
}

export function stubParse(
  prompt: string,
  clients: { id: string; name: string }[],
  today: string,
): DraftOutput {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const forMatch = /\bfor\s+([A-Z][\w&.'\- ]+?)(?=\s+(?:at|@|,|due|net|plus|\d)|[,.]|$)/.exec(text);
  const name = forMatch?.[1]?.trim() ?? null;
  const known = name
    ? clients.find((c) => c.name.toLowerCase().includes(name.toLowerCase().split(/\s+/)[0] ?? ""))
    : undefined;

  const lines: DraftOutput["lines"] = [];
  let currency: string | null = null;
  for (const part of text.split(/\s+(?:plus|and|\+)\s+|;\s*/i)) {
    const qty = /(\d+(?:[.,]\d+)?)\s*(h|hrs?|hours?|d|days?|pcs|pieces)\b/i.exec(part);
    const at =
      /(?:\bat\b|@)\s*([^,]+?)(?:\s*\/\s*(?:h|hr|hour|day|d))?(?:,|$|\s+(?:due|net|for)\b)/i.exec(
        part,
      ) ?? /([€$£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:eur|usd|gbp|€))/i.exec(part);
    const price = at ? money(at[1] ?? at[0]) : null;
    if (price?.currency) currency ??= price.currency;
    const desc = part
      .replace(/(\d+(?:[.,]\d+)?)\s*(h|hrs?|hours?|d|days?|pcs|pieces)\b(\s+of)?/i, "")
      .replace(/\bfor\s+[A-Z][\w&.'\- ]+/, "")
      .replace(/(?:\bat\b|@)\s*[^,]+/i, "")
      .replace(/[€$£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:eur|usd|gbp|€)/gi, "")
      .replace(/\s*\/\s*(?:h|hr|hour|day|d)\b/gi, "")
      .replace(/\b(due in \d+ days|net \d+|flat)\b/gi, "")
      .replace(/[\s,.]+$/g, "")
      .trim();
    if (!desc && !price) continue;
    lines.push({
      description: desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : "Services",
      quantity: qty?.[1]?.replace(",", ".") ?? "1",
      unit: qty?.[2] ? (UNIT[qty[2].toLowerCase()] ?? null) : null,
      unitPrice: price?.value ?? null,
      discountPercent: null,
      taxHint: /no vat|reverse charge/i.test(part)
        ? /reverse/i.test(part)
          ? "reverse_charge"
          : "outside_scope"
        : null,
    });
  }
  const terms = /(?:net|due in)\s*(\d{1,3})/i.exec(lower);
  const vat = /\b([A-Z]{2}\d[\dA-Z]{7,12})\b/.exec(text);
  return {
    client: {
      matchedClientId: known?.id ?? null,
      name: known?.name ?? name,
      email: null,
      country: vat?.[1]?.slice(0, 2) ?? null,
      vatId: vat?.[1] ?? null,
    },
    currency,
    issueDate: null,
    supplyDate: null,
    dueDate: null,
    paymentTermsDays: terms?.[1] ? Number(terms[1]) : null,
    reference: null,
    language: null,
    lines: /same as last|like last time/i.test(lower) ? [] : lines,
    discount: null,
    notes: null,
    copyFromPrevious: /same as last|like last time/i.test(lower),
    uncertainFields: [],
    assumptions:
      known && name && known.name !== name
        ? [`Matched “${name}” to ${known.name}.`]
        : [`Drafted offline (stub extractor) on ${today}.`],
  };
}

export async function stubExtract(a: ExtractArgs): Promise<ExtractResult> {
  await Promise.resolve();
  return {
    status: "ok",
    output: stubParse(a.prompt, a.context.clients, a.context.today),
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    model: "stub",
    requestId: null,
    latencyMs: 0,
  };
}
