import { afterAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { addDays, todayIn } from "@pti/core";
import { eq, schema } from "@pti/db";
import { dbs, orgContext } from "../../../test/fixtures";
import { getInvoice, issueInvoice, saveDraft } from "./invoices";
import { findDueReminders } from "./reminders";
import { deliverReminder } from "./emails";
import { createSchedule, runSchedule } from "./recurring";
import { handleStripeEvent, verifyWebhook } from "./stripe";

afterAll(() => dbs.close());

async function issued(ctx: Awaited<ReturnType<typeof orgContext>>, over: Record<string, unknown> = {}) {
  const { ctx: c, seed, clientId } = ctx;
  const { id } = await saveDraft(c, null, { businessProfileId: seed.profile.id, clientId, currency: "EUR", issueDate: todayIn("UTC"), lines: [{ description: "Retainer", quantity: "1", unitPrice: "1000", taxCategory: "S", taxRate: "19" }], ...over });
  await issueInvoice(c, id);
  return id;
}

describe("reminders", () => {
  it("finds invoices due for a reminder and sends each offset once", async () => {
    const o = await orgContext({ plan: "pro" });
    const today = todayIn("UTC");
    const id = await issued(o, { dueDate: addDays(today, 3) }); // offset -3 → due today
    const due = (await findDueReminders()).filter((r) => r.orgId === o.ctx.org.id);
    expect(due).toEqual([{ orgId: o.ctx.org.id, invoiceId: id, offset: -3 }]);
    expect(await deliverReminder(o.ctx, id, -3)).toBe(true);
    expect(await deliverReminder(o.ctx, id, -3)).toBe(false);
    const d = await getInvoice(o.ctx, id);
    expect(d.invoice.reminderCount).toBe(1);
    expect(d.events.some((e) => e.type === "reminder_sent")).toBe(true);
  });

  it("skips starter plans and paid invoices", async () => {
    const o = await orgContext({ plan: "starter" });
    await issued(o, { dueDate: addDays(todayIn("UTC"), 3) });
    expect((await findDueReminders()).filter((r) => r.orgId === o.ctx.org.id)).toEqual([]);
  });
});

describe("recurring", () => {
  it("creates one invoice per period, even if a run is retried", async () => {
    const o = await orgContext({ plan: "pro" });
    const tpl = await issued(o, { dueDate: addDays(todayIn("UTC"), 14) });
    const today = todayIn("UTC");
    const sid = await createSchedule(o.ctx, tpl, { intervalUnit: "month", intervalCount: 1, startOn: today, autoIssue: "issue" });
    const first = await runSchedule(o.ctx, sid, today);
    expect(first).not.toBeNull();
    expect(await runSchedule(o.ctx, sid, today)).toBeNull();
    const inv = await getInvoice(o.ctx, first!);
    expect(inv.invoice.status).toBe("open");
    expect(inv.invoice.source).toBe("recurring");
    expect(inv.invoice.issueDate).toBe(today);
    expect(inv.invoice.dueDate).toBe(addDays(today, 14));
    const [s] = await dbs.system.select().from(schema.recurringSchedules).where(eq(schema.recurringSchedules.id, sid));
    expect(s?.nextRunOn > today).toBe(true);
  });

  it("is gated to plans with recurring invoices", async () => {
    const o = await orgContext({ plan: "starter" });
    const tpl = await issued(o);
    await expect(createSchedule(o.ctx, tpl, { intervalUnit: "month", intervalCount: 1, startOn: todayIn("UTC"), autoIssue: "draft" })).rejects.toThrow(/Professional/);
  });
});

describe("stripe webhooks", () => {
  const stripe = new Stripe("sk_test_dummy_not_used_for_network");

  function checkoutEvent(id: string, invoiceId: string, orgId: string, amount: number, pi: string): Stripe.Event {
    return {
      id,
      object: "event",
      type: "checkout.session.completed",
      account: "acct_123",
      api_version: "2025-01-01",
      created: 1,
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      data: { object: { id: `cs_${id}`, object: "checkout.session", mode: "payment", payment_status: "paid", amount_total: amount, currency: "eur", payment_intent: pi, metadata: { invoiceId, orgId } } },
    } as unknown as Stripe.Event;
  }

  it("verifies signatures", () => {
    const payload = JSON.stringify({ id: "evt_sig", object: "event", type: "account.updated", data: { object: {} } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    expect(verifyWebhook(payload, header).id).toBe("evt_sig");
    expect(() => verifyWebhook(payload, header.replace(/v1=\w/, "v1=0"))).toThrow();
  });

  it("records a checkout payment once and marks the invoice paid", async () => {
    const o = await orgContext();
    const id = await issued(o);
    const total = (await getInvoice(o.ctx, id)).invoice.total;
    const ev = checkoutEvent(`evt_${id.slice(0, 8)}`, id, o.ctx.org.id, total, `pi_${id.slice(0, 8)}`);
    expect(await handleStripeEvent(ev)).toBe(true);
    expect(await handleStripeEvent(ev)).toBe(false); // same event replayed
    // A different event for the same PaymentIntent is also a no-op.
    await handleStripeEvent({ ...ev, id: `${ev.id}_b`, type: "checkout.session.async_payment_succeeded" } as Stripe.Event);
    const d = await getInvoice(o.ctx, id);
    expect(d.status).toBe("paid");
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]?.method).toBe("stripe");
  });

  it("reopens the invoice on a refund", async () => {
    const o = await orgContext();
    const id = await issued(o);
    const total = (await getInvoice(o.ctx, id)).invoice.total;
    const pi = `pi_r_${id.slice(0, 8)}`;
    await handleStripeEvent(checkoutEvent(`evt_r_${id.slice(0, 8)}`, id, o.ctx.org.id, total, pi));
    await handleStripeEvent({ id: `evt_rf_${id.slice(0, 8)}`, object: "event", type: "charge.refunded", account: "acct_123", data: { object: { object: "charge", payment_intent: pi, amount_refunded: 50000 } } } as unknown as Stripe.Event);
    const d = await getInvoice(o.ctx, id);
    expect(d.invoice.amountPaid).toBe(total - 50000);
    expect(d.status).toBe("partially_paid");
    expect(d.payments[0]?.refundedAmount).toBe(50000);
  });
});
