import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { extractDraft, normalizeDraft, type ExtractResult, type HistoryItem, type NormalizedDraft, type PromptContext } from "@pti/ai";
import { isCurrencyCode, suggestTaxTreatment, todayIn, type TaxCategory } from "@pti/core";
import { desc, eq, schema, sql, withOrg } from "@pti/db";
import { db } from "../db";
import { env, features } from "../env";
import { AppError, ValidationError } from "../errors";
import { logger } from "../logger";
import { enforce, RULES } from "../rate-limit";
import { authorize, type OrgContext } from "../session";
import { clientTaxContext, createClient, getClient, matchClients } from "./clients";
import { draftDefaults, saveDraft } from "./invoices";
import { listTaxRates } from "./tax-rates";
import { consume } from "./usage";

type Extractor = (args: Parameters<typeof extractDraft>[0]) => Promise<ExtractResult>;

let anthropic: Anthropic | null = null;
let extractor: Extractor = extractDraft;

function anthropicClient(): Anthropic {
  anthropic ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return anthropic;
}

/** Test seam: replace the model call with a scripted one. */
export function setExtractorForTests(fn: Extractor | null): void {
  extractor = fn ?? extractDraft;
}

const MATCH_THRESHOLD = 0.5;

async function buildContext(ctx: OrgContext, defaults: Awaited<ReturnType<typeof draftDefaults>>): Promise<{ prompt: PromptContext; history: HistoryItem[]; clientIds: Set<string> }> {
  return withOrg(db, ctx.org.id, async (tx) => {
    const c = schema.clients;
    const clients = await tx
      .select({ id: c.id, name: c.name })
      .from(c)
      .where(sql`${c.status} <> 'archived'`)
      .orderBy(sql`(select max(issue_date) from invoices where invoices.client_id = clients.id) desc nulls last`, desc(c.createdAt))
      .limit(150);
    // Distinct recent line items with their latest price, per client.
    const items = await tx.execute<{ description: string; unit: string; unit_price: string; currency: string; client_id: string | null; client: string | null }>(sql`
      select distinct on (lower(l.description), i.client_id)
        l.description, l.unit, l.unit_price::text as unit_price, i.currency, i.client_id, cl.name as client
      from invoice_lines l
      join invoices i on i.id = l.invoice_id
      left join clients cl on cl.id = i.client_id
      where i.status <> 'draft' and i.doc_type = 'invoice'
      order by lower(l.description), i.client_id, i.issue_date desc
      limit 60
    `);
    const history = items.map((r) => ({ description: r.description, unit: r.unit, unitPrice: String(Number(r.unit_price)), currency: r.currency, clientId: r.client_id }));
    return {
      prompt: {
        today: todayIn(ctx.org.timeZone),
        sellerCountry: defaults.profile.address.country,
        defaultCurrency: defaults.currency,
        clients,
        recentItems: items.slice(0, 40).map((r, i) => ({ description: r.description, unit: r.unit, unitPrice: history[i]?.unitPrice ?? r.unit_price, currency: r.currency, client: r.client })),
      },
      history,
      clientIds: new Set(clients.map((x) => x.id)),
    };
  });
}

async function resolveClient(ctx: OrgContext, d: NormalizedDraft, notes: string[]): Promise<string | null> {
  if (d.clientId) return d.clientId;
  if (!d.clientName) return null;
  const [best] = await matchClients(ctx, d.clientName, 1);
  if (best && best.score >= MATCH_THRESHOLD) {
    notes.push(`Matched “${d.clientName}” to your client ${best.name}.`);
    return best.id;
  }
  // Unknown client: create a pending record so the draft is complete; it becomes active on issue.
  const created = await createClient(
    ctx,
    {
      name: d.clientName,
      contactName: null,
      emails: d.clientHints.email ? [d.clientHints.email] : [],
      phone: null,
      address: d.clientHints.country ? { line1: "", line2: "", city: "", region: "", postalCode: "", country: d.clientHints.country } : null,
      isBusiness: true,
      vatId: d.clientHints.vatId,
      taxId: null,
      currency: null,
      paymentTermsDays: null,
      language: null,
      buyerReference: null,
      notes: "",
    },
    "pending",
  );
  notes.push(`“${d.clientName}” is a new client. Add their address before issuing.`);
  return created.id;
}

async function previousLines(ctx: OrgContext, clientId: string) {
  return withOrg(db, ctx.org.id, async (tx) => {
    const [last] = await tx
      .select({ id: schema.invoices.id, currency: schema.invoices.currency, number: schema.invoices.number })
      .from(schema.invoices)
      .where(sql`${schema.invoices.clientId} = ${clientId} and ${schema.invoices.docType} = 'invoice' and ${schema.invoices.status} <> 'draft'`)
      .orderBy(desc(schema.invoices.issueDate))
      .limit(1);
    if (!last) return null;
    const lines = await tx.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, last.id)).orderBy(schema.invoiceLines.position);
    return { ...last, lines };
  });
}

export interface AiDraftResult {
  invoiceId: string;
  aiDraftId: string;
}

/**
 * Prompt → saved invoice draft. The model only extracts structure; the
 * server resolves the client, validates values, picks tax treatment and
 * computes totals through the normal draft path.
 */
export async function createAiDraft(ctx: OrgContext, rawPrompt: string): Promise<AiDraftResult> {
  authorize(ctx, "invoice:write");
  if (!features.ai) throw new AppError("ai_disabled", "AI drafting isn't configured on this server.", 503);
  const prompt = rawPrompt.trim().slice(0, 2000);
  if (prompt.length < 3) throw new ValidationError("Describe the work to invoice.", { prompt: ["Too short."] });
  await enforce(`ai:${ctx.user.id}`, RULES.aiDraft);
  // Count the attempt up front (its own transaction) so failures can't be used to bypass the quota.
  await withOrg(db, ctx.org.id, (tx) => consume(tx, ctx.org.id, ctx.org.plan, "ai_drafts"));

  const defaults = await draftDefaults(ctx);
  const { prompt: promptCtx, history, clientIds } = await buildContext(ctx, defaults);
  const result = await extractor({ client: anthropicClient(), prompt, context: promptCtx, model: env.AI_MODEL });

  const aiDraftId = crypto.randomUUID();
  const record = (status: "ok" | "invalid" | "refused" | "error", extra: Record<string, unknown> = {}) =>
    withOrg(db, ctx.org.id, (tx) =>
      tx.insert(schema.aiDrafts).values({
        id: aiDraftId,
        orgId: ctx.org.id,
        userId: ctx.user.id,
        prompt,
        model: result.model,
        requestId: result.requestId,
        status,
        error: result.status === "ok" ? null : result.error,
        latencyMs: result.latencyMs,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        cacheReadTokens: result.usage?.cacheReadTokens ?? null,
        ...extra,
      }),
    );

  if (result.status !== "ok") {
    await record(result.status);
    logger.warn({ status: result.status, requestId: result.requestId, latencyMs: result.latencyMs }, "AI draft failed");
    throw new AppError(`ai_${result.status}`, result.status === "refused" ? "That request can't be drafted. Try describing the work differently." : result.error, result.retryable ? 503 : 422);
  }

  const taxRates = await listTaxRates(ctx);
  const d = normalizeDraft(result.output, {
    today: promptCtx.today,
    knownClientIds: clientIds,
    history,
    taxRates: taxRates.map((r) => ({ category: r.category as TaxCategory, rate: String(Number(r.rate)), isDefault: r.isDefault })),
  });
  const notes = [...d.notesForUser];
  const clientId = await resolveClient(ctx, d, notes);
  const client = clientId ? await getClient(ctx, clientId) : null;

  let lines = d.lines;
  let currency = d.currency;
  if (d.copyFromPrevious && clientId && lines.length === 0) {
    const prev = await previousLines(ctx, clientId);
    if (prev) {
      currency ??= prev.currency;
      lines = prev.lines.map((l) => ({ description: l.description, quantity: String(Number(l.quantity)), unit: l.unit, unitPrice: String(Number(l.unitPrice)), discountPercent: l.discountPercent, tax: { category: l.taxCategory as TaxCategory, rate: String(Number(l.taxRate)) } }));
      notes.push(`Copied the lines of ${prev.number ?? "the previous invoice"}.`);
    } else notes.push("No previous invoice for this client to copy.");
  }

  // Tax: explicit hint per line > treatment for this client > default rate.
  const treatment = client
    ? suggestTaxTreatment({ sellerCountry: defaults.profile.address.country, sellerVatExempt: defaults.profile.vatExempt, supply: "services", ...clientTaxContext(client), buyerCountry: client.address?.country ?? null })
    : null;
  const fallbackTax = treatment && treatment.reason !== "non-eu-seller" ? { category: treatment.category, rate: treatment.category === "S" ? treatment.rate : "0" } : { category: defaults.taxCategory, rate: defaults.taxRate };
  if (treatment && treatment.category !== "S" && treatment.reason !== "non-eu-seller") notes.push(`Applied ${treatment.category === "AE" ? "reverse charge" : "a 0% treatment"} for ${client?.name ?? "this client"}. Check it's right.`);

  const resolvedCurrency = currency && isCurrencyCode(currency) ? currency : (client?.currency ?? defaults.currency);
  const termsDays = d.termsDays ?? client?.paymentTermsDays ?? defaults.profile.defaultPaymentTermsDays;
  const payload = {
    businessProfileId: defaults.profile.id,
    clientId,
    currency: resolvedCurrency,
    issueDate: d.issueDate,
    supplyDate: d.supplyDate,
    dueDate: d.dueDate ?? (d.issueDate ? new Date(Date.parse(`${d.issueDate}T00:00:00Z`) + termsDays * 86_400_000).toISOString().slice(0, 10) : null),
    language: d.language ?? client?.language ?? defaults.profile.locale,
    reference: d.reference,
    lines: (lines.length ? lines : [{ description: prompt.slice(0, 200), quantity: "1", unit: "", unitPrice: "0", discountPercent: null, tax: null }]).map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice || "0",
      discountPercent: l.discountPercent,
      taxCategory: (l.tax ?? fallbackTax).category,
      taxRate: (l.tax ?? fallbackTax).rate,
    })),
    discount: d.discount,
    notes: d.notes ?? defaults.notes,
    terms: defaults.terms,
    taxNote: treatment && treatment.category !== "S" ? (treatment.note ?? "") : "",
  };

  await record("ok", { output: { raw: result.output, aiFields: d.aiFields, notes } });
  const { id } = await saveDraft(ctx, null, payload, { source: "ai", aiDraftId });
  await withOrg(db, ctx.org.id, (tx) => tx.update(schema.aiDrafts).set({ acceptedInvoiceId: id }).where(eq(schema.aiDrafts.id, aiDraftId)));
  return { invoiceId: id, aiDraftId };
}

/** AI marks for the editor: shown until the draft has been saved by a person. */
export async function aiMarksFor(ctx: OrgContext, aiDraftId: string | null, version: number): Promise<{ fields: string[]; notes: string[] } | null> {
  if (!aiDraftId || version > 1) return null;
  const [row] = await withOrg(db, ctx.org.id, (tx) => tx.select({ output: schema.aiDrafts.output }).from(schema.aiDrafts).where(eq(schema.aiDrafts.id, aiDraftId)));
  const o = row?.output as { aiFields?: string[]; notes?: string[] } | null | undefined;
  return o ? { fields: o.aiFields ?? [], notes: o.notes ?? [] } : null;
}
