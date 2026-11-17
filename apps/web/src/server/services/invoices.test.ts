import { afterAll, describe, expect, it } from "vitest";
import { dbs, orgContext } from "../../../test/fixtures";
import {
  deleteDraft,
  draftCreditNote,
  duplicateInvoice,
  getInvoice,
  issueInvoice,
  listInvoices,
  recordPayment,
  saveDraft,
} from "./invoices";

afterAll(() => dbs.close());

const line = { description: "Consulting", quantity: "10", unit: "h", unitPrice: "120", taxCategory: "S", taxRate: "19" };

function draftInput(profileId: string, clientId: string | null, over: Record<string, unknown> = {}) {
  return { businessProfileId: profileId, clientId, currency: "EUR", issueDate: "2026-11-17", dueDate: "2026-12-01", lines: [line], ...over };
}

describe("invoice lifecycle", () => {
  it("computes totals on the server and issues with a sequential number", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, draftInput(seed.profile.id, clientId));
    const d = await getInvoice(ctx, id);
    expect(d.invoice.total).toBe(142800);
    expect(d.invoice.taxTotal).toBe(22800);
    expect(d.status).toBe("draft");

    const { number } = await issueInvoice(ctx, id);
    expect(number).toBe("INV-2026-0001");
    const issued = await getInvoice(ctx, id);
    expect(issued.invoice.issuedSnapshot?.buyer.name).toBe("Acme GmbH");
    expect(issued.invoice.publicToken).toHaveLength(24);
    expect(issued.events.map((e) => e.type)).toEqual(["created", "issued"]);

    const second = await saveDraft(ctx, null, draftInput(seed.profile.id, clientId));
    expect((await issueInvoice(ctx, second.id)).number).toBe("INV-2026-0002");
  });

  it("refuses to issue without a client and to edit after issue", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, draftInput(seed.profile.id, null));
    await expect(issueInvoice(ctx, id)).rejects.toThrow(/Choose who/);
    await saveDraft(ctx, id, draftInput(seed.profile.id, clientId));
    await issueInvoice(ctx, id);
    await expect(saveDraft(ctx, id, draftInput(seed.profile.id, clientId))).rejects.toThrow(/Cannot edit/);
    await expect(deleteDraft(ctx, id)).rejects.toThrow(/Cannot delete/);
  });

  it("detects concurrent edits with optimistic versions", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id, version } = await saveDraft(ctx, null, draftInput(seed.profile.id, clientId));
    await saveDraft(ctx, id, draftInput(seed.profile.id, clientId), { expectedVersion: version });
    await expect(saveDraft(ctx, id, draftInput(seed.profile.id, clientId), { expectedVersion: version })).rejects.toThrow(/another tab/);
  });

  it("enforces the starter plan's monthly issue quota", async () => {
    const { ctx, seed, clientId } = await orgContext({ plan: "starter" });
    for (let i = 0; i < 5; i++) {
      const { id } = await saveDraft(ctx, null, draftInput(seed.profile.id, clientId));
      await issueInvoice(ctx, id);
    }
    const { id } = await saveDraft(ctx, null, draftInput(seed.profile.id, clientId));
    await expect(issueInvoice(ctx, id)).rejects.toThrow(/all 5 invoices/);
    // The failed issue consumed no number: the draft is still a draft.
    expect((await getInvoice(ctx, id)).invoice.number).toBeNull();
  });

  it("records partial and full payments", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, draftInput(seed.profile.id, clientId));
    await issueInvoice(ctx, id);
    await recordPayment(ctx, id, { amount: 40000, receivedOn: "2026-11-20", method: "bank_transfer", reference: "", notes: "" });
    expect((await getInvoice(ctx, id)).status).toBe("partially_paid");
    await expect(recordPayment(ctx, id, { amount: 999999, receivedOn: "2026-11-21", method: "cash", reference: "", notes: "" })).rejects.toThrow(/more than/);
    await recordPayment(ctx, id, { amount: 102800, receivedOn: "2026-11-21", method: "bank_transfer", reference: "", notes: "" });
    const paid = await getInvoice(ctx, id);
    expect(paid.status).toBe("paid");
    expect(paid.payments).toHaveLength(2);
  });

  it("voids an unpaid invoice when a full credit note is issued", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, draftInput(seed.profile.id, clientId));
    const { number } = await issueInvoice(ctx, id);
    const cnId = await draftCreditNote(ctx, id);
    const cn = await getInvoice(ctx, cnId);
    expect(cn.invoice.docType).toBe("credit_note");
    expect(cn.invoice.total).toBe(-142800);
    expect(cn.invoice.reference).toBe(number);
    expect((await issueInvoice(ctx, cnId)).number).toBe("CN-001");
    const orig = await getInvoice(ctx, id);
    expect(orig.status).toBe("void");
    expect(orig.credits).toHaveLength(1);
  });

  it("applies a partial credit to the amount due", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, draftInput(seed.profile.id, clientId));
    await issueInvoice(ctx, id);
    const cnId = await draftCreditNote(ctx, id);
    await saveDraft(ctx, cnId, draftInput(seed.profile.id, clientId, { lines: [{ ...line, quantity: "-2" }] }), { docType: "credit_note" });
    await issueInvoice(ctx, cnId);
    const orig = await getInvoice(ctx, id);
    expect(orig.invoice.creditedAmount).toBe(28560);
    expect(orig.status).toBe("partially_paid");
    const list = await listInvoices(ctx, { filter: "outstanding" });
    expect(list.items.find((x) => x.id === id)?.amountDue).toBe(142800 - 28560);
  });

  it("duplicates into a fresh draft", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, draftInput(seed.profile.id, clientId));
    await issueInvoice(ctx, id);
    const dup = await getInvoice(ctx, await duplicateInvoice(ctx, id));
    expect(dup.invoice.status).toBe("draft");
    expect(dup.invoice.total).toBe(142800);
    expect(dup.invoice.source).toBe("duplicate");
  });

  it("filters and paginates the list", async () => {
    const { ctx, seed, clientId } = await orgContext();
    for (let i = 0; i < 3; i++) await saveDraft(ctx, null, draftInput(seed.profile.id, clientId, { issueDate: `2026-11-0${i + 1}`, dueDate: null }));
    const p1 = await listInvoices(ctx, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.items[0]?.issueDate).toBe("2026-11-03");
    const p2 = await listInvoices(ctx, { limit: 2, cursor: p1.nextCursor ?? undefined });
    expect(p2.items.map((i) => i.issueDate)).toEqual(["2026-11-01"]);
    expect(p2.nextCursor).toBeNull();
    expect((await listInvoices(ctx, { filter: "draft", q: "acme" })).items).toHaveLength(3);
  });

  it("denies read-only roles from writing", async () => {
    const { ctx, seed, clientId } = await orgContext({ role: "accountant" });
    await expect(saveDraft(ctx, null, draftInput(seed.profile.id, clientId))).rejects.toThrow(/permission/);
  });
});
