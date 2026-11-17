import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { DraftOutput, ExtractResult } from "@pti/ai";
import { eq, schema } from "@pti/db";
import { dbs, orgContext } from "../../../test/fixtures";
import { aiMarksFor, createAiDraft, recordAiOutcome, setExtractorForTests } from "./ai-drafts";
import { getInvoice, issueInvoice, saveDraft } from "./invoices";

afterAll(() => dbs.close());
afterEach(() => setExtractorForTests(null));

const blank: DraftOutput = {
  client: { matchedClientId: null, name: null, email: null, country: null, vatId: null },
  currency: null, issueDate: null, supplyDate: null, dueDate: null, paymentTermsDays: null, reference: null, language: null,
  lines: [], discount: null, notes: null, copyFromPrevious: false, uncertainFields: [], assumptions: [],
};

function script(build: (ctx: { clients: { id: string; name: string }[]; today: string }) => Partial<DraftOutput>) {
  let seen: Parameters<Parameters<typeof setExtractorForTests>[0] & object>[0] | undefined;
  setExtractorForTests(async (args) => {
    seen = args;
    const out = { ...blank, ...build({ clients: args.context.clients, today: args.context.today }) };
    return { status: "ok", output: out, usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 800 }, model: "test-model", requestId: "req_1", latencyMs: 5 } satisfies ExtractResult;
  });
  return () => seen;
}

describe("AI drafts", () => {
  it("drafts the canonical prompt against a known client", async () => {
    const { ctx, clientId } = await orgContext();
    const seen = script(({ clients }) => ({
      client: { matchedClientId: clients.find((c) => c.name === "Acme GmbH")?.id ?? null, name: "Acme GmbH", email: null, country: null, vatId: null },
      currency: "EUR",
      paymentTermsDays: 30,
      lines: [{ description: "Consulting", quantity: "10", unit: "h", unitPrice: "120", discountPercent: null, taxHint: null }],
      assumptions: ["Matched “acme” to Acme GmbH."],
    }));
    const { invoiceId, aiDraftId } = await createAiDraft(ctx, "10 hours of consulting for acme at €120/h, net 30");
    const d = await getInvoice(ctx, invoiceId);
    expect(d.invoice.clientId).toBe(clientId);
    expect(d.invoice.source).toBe("ai");
    // DE seller, DE client: standard 19%.
    expect(d.invoice.total).toBe(142800);
    expect(d.lines[0]).toMatchObject({ unit: "h", taxCategory: "S" });
    // Only ids and names reach the model.
    expect(Object.keys(seen()?.context.clients[0] ?? {})).toEqual(["id", "name"]);
    const marks = await aiMarksFor(ctx, aiDraftId, d.invoice.version);
    expect(marks?.fields).toEqual(expect.arrayContaining(["client", "lines.0.unitPrice"]));
    expect(marks?.notes[0]).toMatch(/Matched/);
    const [row] = await dbs.system.select().from(schema.aiDrafts).where(eq(schema.aiDrafts.id, aiDraftId));
    expect(row?.cacheReadTokens).toBe(800);
  });

  it("creates a pending client and applies reverse charge for an EU business", async () => {
    const { ctx } = await orgContext();
    script(() => ({
      client: { matchedClientId: null, name: "Atelier Lumière SAS", email: "compta@lumiere.test", country: "FR", vatId: "FR40303265045" },
      lines: [{ description: "Brand identity", quantity: "1", unit: null, unitPrice: "3400", discountPercent: null, taxHint: null }],
    }));
    const { invoiceId } = await createAiDraft(ctx, "Brand identity for Atelier Lumière SAS (FR40303265045), 3400 EUR");
    const d = await getInvoice(ctx, invoiceId);
    expect(d.client?.status).toBe("pending");
    expect(d.lines[0]?.taxCategory).toBe("AE");
    expect(d.invoice.taxNote).toMatch(/Reverse charge/);
    expect(d.invoice.total).toBe(340000);
  });

  it("fuzzy-matches a misspelt client the model didn't map", async () => {
    const { ctx, clientId } = await orgContext();
    script(() => ({ client: { matchedClientId: "not-a-real-id", name: "Acme Gmbh.", email: null, country: null, vatId: null }, lines: [{ description: "Work", quantity: "1", unit: null, unitPrice: "100", discountPercent: null, taxHint: null }] }));
    const { invoiceId, aiDraftId } = await createAiDraft(ctx, "work for acme gmbh, 100");
    expect((await getInvoice(ctx, invoiceId)).invoice.clientId).toBe(clientId);
    expect((await aiMarksFor(ctx, aiDraftId, 1))?.notes.join(" ")).toMatch(/Matched “Acme Gmbh\.”/);
  });

  it("copies the previous invoice for 'same as last month'", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const prev = await saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "EUR", issueDate: "2026-10-17", lines: [{ description: "Retainer", quantity: "1", unitPrice: "2400", taxCategory: "S", taxRate: "19" }] });
    await issueInvoice(ctx, prev.id);
    script(({ clients }) => ({ client: { matchedClientId: clients[0]?.id ?? null, name: "Acme GmbH", email: null, country: null, vatId: null }, copyFromPrevious: true }));
    const { invoiceId } = await createAiDraft(ctx, "same as last month for acme");
    const d = await getInvoice(ctx, invoiceId);
    expect(d.lines.map((l) => l.description)).toEqual(["Retainer"]);
    expect(d.invoice.total).toBe(285600);
  });

  it("fills missing prices from history", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const prev = await saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "EUR", issueDate: "2026-10-01", lines: [{ description: "UX consulting", quantity: "2", unit: "h", unitPrice: "135", taxCategory: "S", taxRate: "19" }] });
    await issueInvoice(ctx, prev.id);
    script(({ clients }) => ({ client: { matchedClientId: clients[0]?.id ?? null, name: "Acme GmbH", email: null, country: null, vatId: null }, currency: "EUR", lines: [{ description: "UX consulting", quantity: "6", unit: "h", unitPrice: null, discountPercent: null, taxHint: null }] }));
    const { invoiceId, aiDraftId } = await createAiDraft(ctx, "6h ux consulting for acme");
    expect((await getInvoice(ctx, invoiceId)).lines[0]?.unitPrice).toBe("135.000000");
    expect((await aiMarksFor(ctx, aiDraftId, 1))?.notes.join(" ")).toMatch(/previous rate of 135 EUR\/h/);
  });

  it("records refusals and enforces the monthly AI quota", async () => {
    const { ctx } = await orgContext({ plan: "starter" });
    setExtractorForTests(async () => ({ status: "refused", error: "declined", usage: null, model: "m", requestId: null, latencyMs: 1, retryable: false }));
    await expect(createAiDraft(ctx, "something odd")).rejects.toThrow(/can't be drafted/);
    const [row] = await dbs.system.select().from(schema.usageCounters).where(eq(schema.usageCounters.orgId, ctx.org.id));
    expect(row?.aiDrafts).toBe(1);
    // Starter allows 20 per month: simulate the other 19.
    await dbs.system.update(schema.usageCounters).set({ aiDrafts: 20 }).where(eq(schema.usageCounters.orgId, ctx.org.id));
    script(() => ({ lines: [{ description: "x", quantity: "1", unit: null, unitPrice: "1", discountPercent: null, taxHint: null }] }));
    await expect(createAiDraft(ctx, "one too many")).rejects.toThrow(/all 20 AI drafts/);
  });

  it("records which AI values were edited before issue", async () => {
    const { ctx, seed, clientId } = await orgContext();
    script(({ clients }) => ({ client: { matchedClientId: clients[0]?.id ?? null, name: "Acme GmbH", email: null, country: null, vatId: null }, currency: "EUR", lines: [{ description: "Design", quantity: "2", unit: "days", unitPrice: "800", discountPercent: null, taxHint: null }] }));
    const { invoiceId, aiDraftId } = await createAiDraft(ctx, "2 days design for acme at 800");
    await saveDraft(ctx, invoiceId, { businessProfileId: seed.profile.id, clientId, currency: "EUR", issueDate: "2026-11-17", lines: [{ description: "Design", quantity: "2", unit: "days", unitPrice: "850", taxCategory: "S", taxRate: "19" }] });
    await issueInvoice(ctx, invoiceId);
    await recordAiOutcome(ctx, invoiceId);
    const [row] = await dbs.system.select().from(schema.aiDrafts).where(eq(schema.aiDrafts.id, aiDraftId));
    expect(row?.editedFields).toEqual(["lines.0.unitPrice"]);
  });

  it("hides AI marks once a person has saved the draft", async () => {
    const { ctx } = await orgContext();
    script(() => ({ lines: [{ description: "x", quantity: "1", unit: null, unitPrice: "1", discountPercent: null, taxHint: null }] }));
    const { aiDraftId } = await createAiDraft(ctx, "x for 1");
    expect(await aiMarksFor(ctx, aiDraftId, 2)).toBeNull();
  });
});
