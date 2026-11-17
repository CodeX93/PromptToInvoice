import { afterAll, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { eq, schema } from "@pti/db";
import { dbs, orgContext } from "../../../test/fixtures";
import { applySubscription, subscriptionFor } from "./billing";
import { handleStripeEvent } from "./stripe";
import { saveDraft } from "./invoices";

afterAll(() => dbs.close());

function sub(orgId: string, customer: string, status: Stripe.Subscription.Status, items: [string, number][], extra: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: `sub_${customer}`,
    object: "subscription",
    customer,
    status,
    cancel_at_period_end: false,
    trial_end: null,
    metadata: { orgId },
    items: { object: "list", data: items.map(([price, quantity]) => ({ price: { id: price }, quantity, current_period_end: 1_900_000_000 })) },
    ...extra,
  } as unknown as Stripe.Subscription;
}

async function planOf(orgId: string) {
  const [o] = await dbs.system.select({ plan: schema.organizations.plan }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  return o?.plan;
}

describe("subscriptions", () => {
  it("upgrades on an active subscription and counts extra seats", async () => {
    const { ctx } = await orgContext({ plan: "starter" });
    await applySubscription(sub(ctx.org.id, `cus_${ctx.org.id.slice(0, 8)}`, "active", [["price_bus_m", 1], ["price_seat_m", 2]]));
    expect(await planOf(ctx.org.id)).toBe("business");
    expect((await subscriptionFor(ctx.org.id))?.extraSeats).toBe(2);
  });

  it("keeps the plan while past due and drops to starter when cancelled", async () => {
    const { ctx } = await orgContext({ plan: "starter" });
    const cus = `cus_p_${ctx.org.id.slice(0, 8)}`;
    await applySubscription(sub(ctx.org.id, cus, "trialing", [["price_pro_m", 1]], { trial_end: 1_900_000_000 }));
    expect(await planOf(ctx.org.id)).toBe("pro");
    await applySubscription(sub(ctx.org.id, cus, "past_due", [["price_pro_m", 1]]));
    expect(await planOf(ctx.org.id)).toBe("pro");
    await handleStripeEvent({ id: `evt_del_${ctx.org.id.slice(0, 8)}`, object: "event", type: "customer.subscription.deleted", data: { object: sub(ctx.org.id, cus, "canceled", [["price_pro_m", 1]]) } } as unknown as Stripe.Event);
    expect(await planOf(ctx.org.id)).toBe("starter");
    expect((await subscriptionFor(ctx.org.id))?.status).toBe("canceled");
  });

  it("ignores unknown prices", async () => {
    const { ctx } = await orgContext({ plan: "starter" });
    await applySubscription(sub(ctx.org.id, `cus_u_${ctx.org.id.slice(0, 8)}`, "active", [["price_other", 1]]));
    expect(await planOf(ctx.org.id)).toBe("starter");
  });
});

describe("entitlements", () => {
  it("limits starter to USD and EUR", async () => {
    const { ctx, seed, clientId } = await orgContext({ plan: "starter" });
    const line = { description: "x", quantity: "1", unitPrice: "1", taxCategory: "O", taxRate: "0" };
    await expect(saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "GBP", issueDate: "2026-11-17", lines: [line] })).rejects.toThrow(/Professional plan/);
    await expect(saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "USD", issueDate: "2026-11-17", lines: [line] })).resolves.toBeTruthy();
  });
});
