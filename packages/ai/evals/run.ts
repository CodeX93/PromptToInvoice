/**
 * Extraction eval runner.
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @pti/ai eval                  # live model
 *   pnpm --filter @pti/ai eval -- --provider stub                  # offline stub (harness self-test)
 *   pnpm --filter @pti/ai eval -- --only canonical,repeat --model claude-opus-5-5
 *
 * Scores each case on the fields it specifies and prints a table plus
 * aggregate accuracy and token cost. Exits non-zero below --min (default 0.9)
 * so CI can gate prompt/model changes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { compareDecimal, parseDecimal } from "@pti/core";
import { extractDraft, type ExtractResult } from "../src/extract";
import { stubExtract } from "../src/stub";
import type { DraftOutput } from "../src/schema";
import { CASES, type EvalCase } from "./cases";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const provider = flag("provider") ?? "anthropic";
const model = flag("model");
const only = flag("only")?.split(",");
const min = Number(flag("min") ?? "0.9");
const concurrency = Number(flag("concurrency") ?? "4");

const sameDecimal = (a: string | null | undefined, b: string | null | undefined) => {
  if (a == null || b == null) return a == b;
  try {
    return compareDecimal(parseDecimal(a), parseDecimal(b)) === 0;
  } catch {
    return false;
  }
};

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export function score(c: EvalCase, o: DraftOutput): Check[] {
  const e = c.expect;
  const checks: Check[] = [];
  const push = (name: string, pass: boolean, detail?: string) => checks.push({ name, pass, detail });
  if (e.clientId !== undefined) push("client", o.client.matchedClientId === e.clientId, `got ${o.client.matchedClientId}`);
  if (e.clientName) push("clientName", (o.client.name ?? "").toLowerCase().includes(e.clientName.toLowerCase()), `got ${o.client.name}`);
  if (e.currency !== undefined) push("currency", (o.currency?.toUpperCase() ?? null) === e.currency, `got ${o.currency}`);
  if (e.paymentTermsDays !== undefined) push("terms", o.paymentTermsDays === e.paymentTermsDays, `got ${o.paymentTermsDays}`);
  if (e.copyFromPrevious !== undefined) push("copy", o.copyFromPrevious === e.copyFromPrevious);
  if (e.reference) push("reference", (o.reference ?? "").includes(e.reference), `got ${o.reference}`);
  if (e.lineCount !== undefined) push("lineCount", o.lines.length === e.lineCount, `got ${o.lines.length}`);
  if (e.noInventedPrices) push("noInventedPrice", o.lines.every((l) => l.unitPrice === null), JSON.stringify(o.lines.map((l) => l.unitPrice)));
  e.lines?.forEach((exp, i) => {
    const l = o.lines[i];
    if (!l) return push(`line${i}`, false, "missing");
    const desc = l.description.toLowerCase();
    if (exp.keywords.length) push(`line${i}.desc`, exp.keywords.every((k) => desc.includes(k)), l.description);
    if (exp.quantity !== undefined) push(`line${i}.qty`, sameDecimal(l.quantity, exp.quantity), `got ${l.quantity}`);
    if (exp.unitPrice !== undefined) push(`line${i}.price`, sameDecimal(l.unitPrice, exp.unitPrice), `got ${l.unitPrice}`);
    if (exp.unit !== undefined) push(`line${i}.unit`, (l.unit ?? null) === exp.unit, `got ${l.unit}`);
  });
  return checks;
}

async function runCase(c: EvalCase, client: Anthropic | null): Promise<{ c: EvalCase; r: ExtractResult; checks: Check[] }> {
  const context = { today: "2026-11-17", sellerCountry: "DE", defaultCurrency: "EUR", clients: c.clients ?? [], recentItems: [] };
  const r = provider === "stub" || !client ? await stubExtract({ client: null as never, prompt: c.prompt, context }) : await extractDraft({ client, prompt: c.prompt, context, model });
  return { c, r, checks: r.status === "ok" ? score(c, r.output) : [{ name: "status", pass: false, detail: r.status }] };
}

async function main() {
  const cases = CASES.filter((c) => !only || only.includes(c.id));
  const client = provider === "anthropic" ? new Anthropic() : null;
  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  for (let i = 0; i < cases.length; i += concurrency) {
    results.push(...(await Promise.all(cases.slice(i, i + concurrency).map((c) => runCase(c, client)))));
  }

  let passed = 0;
  let total = 0;
  let inTok = 0;
  let outTok = 0;
  let cached = 0;
  for (const { c, r, checks } of results) {
    const ok = checks.filter((x) => x.pass).length;
    passed += ok;
    total += checks.length;
    if (r.usage) {
      inTok += r.usage.inputTokens;
      outTok += r.usage.outputTokens;
      cached += r.usage.cacheReadTokens;
    }
    const failed = checks.filter((x) => !x.pass);
    console.log(`${failed.length ? "✗" : "✓"} ${c.id.padEnd(20)} ${ok}/${checks.length}  ${r.latencyMs}ms${failed.length ? "  " + failed.map((f) => `${f.name}(${f.detail ?? ""})`).join(", ") : ""}`);
  }
  const acc = total ? passed / total : 0;
  console.log(`\naccuracy ${(acc * 100).toFixed(1)}%  (${passed}/${total} checks, ${results.length} cases, provider=${provider}${model ? `, model=${model}` : ""})`);
  console.log(`tokens in=${inTok} (cached ${cached}) out=${outTok}`);
  if (acc < min) {
    console.error(`below threshold ${min}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
