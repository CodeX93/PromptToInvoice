import "server-only";
import type Stripe from "stripe";
import { isPlanId, type PlanId } from "@pti/core";
import { eq, schema } from "@pti/db";
import { sysDb } from "../db";
import { env, features } from "../env";
import { audit } from "../audit";
import { AppError, ValidationError } from "../errors";
import { logger } from "../logger";
import { authorize, type OrgContext } from "../session";
import { stripeClient } from "./stripe";

export type Interval = "month" | "year";
export type PaidPlan = Extract<PlanId, "pro" | "business">;

/** price id → (plan, interval); seat prices map to "seat". */
function priceTable(): Map<string, { plan: PaidPlan | "seat"; interval: Interval }> {
  const m = new Map<string, { plan: PaidPlan | "seat"; interval: Interval }>();
  const add = (id: string | undefined, plan: PaidPlan | "seat", interval: Interval) => {
    if (id) m.set(id, { plan, interval });
  };
  add(env.STRIPE_PRICE_PRO_MONTH, "pro", "month");
  add(env.STRIPE_PRICE_PRO_YEAR, "pro", "year");
  add(env.STRIPE_PRICE_BUSINESS_MONTH, "business", "month");
  add(env.STRIPE_PRICE_BUSINESS_YEAR, "business", "year");
  add(env.STRIPE_PRICE_SEAT_MONTH, "seat", "month");
  add(env.STRIPE_PRICE_SEAT_YEAR, "seat", "year");
  return m;
}

function priceFor(plan: PaidPlan, interval: Interval): string {
  const id =
    plan === "pro"
      ? interval === "month"
        ? env.STRIPE_PRICE_PRO_MONTH
        : env.STRIPE_PRICE_PRO_YEAR
      : interval === "month"
        ? env.STRIPE_PRICE_BUSINESS_MONTH
        : env.STRIPE_PRICE_BUSINESS_YEAR;
  if (!id)
    throw new ValidationError(
      `The ${plan} plan isn't available ${interval === "year" ? "annually" : "monthly"}.`,
    );
  return id;
}

function requireBilling(): Stripe {
  if (!features.billing)
    throw new AppError("billing_disabled", "Billing isn't configured on this server.", 503);
  return stripeClient();
}

async function ensureCustomer(
  ctx: OrgContext,
  s: Stripe,
): Promise<{ customerId: string; hadSubscription: boolean }> {
  const [sub] = await sysDb
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, ctx.org.id));
  if (sub)
    return { customerId: sub.stripeCustomerId, hadSubscription: Boolean(sub.stripeSubscriptionId) };
  const customer = await s.customers.create(
    { email: ctx.user.email, name: ctx.org.name, metadata: { orgId: ctx.org.id } },
    { idempotencyKey: `customer-${ctx.org.id}` },
  );
  await sysDb
    .insert(schema.subscriptions)
    .values({ orgId: ctx.org.id, stripeCustomerId: customer.id })
    .onConflictDoNothing();
  return { customerId: customer.id, hadSubscription: false };
}

/**
 * Subscription Checkout. Stripe Tax computes VAT/sales tax on our fee
 * (reverse charge for EU businesses with a valid VAT ID); first-time
 * subscribers get a trial.
 */
export async function subscriptionCheckout(
  ctx: OrgContext,
  plan: PaidPlan,
  interval: Interval,
): Promise<string> {
  authorize(ctx, "billing:manage");
  const s = requireBilling();
  const { customerId, hadSubscription } = await ensureCustomer(ctx, s);
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceFor(plan, interval), quantity: 1 }],
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    billing_address_collection: "required",
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { orgId: ctx.org.id },
      ...(!hadSubscription &&
        env.STRIPE_TRIAL_DAYS > 0 && { trial_period_days: env.STRIPE_TRIAL_DAYS }),
    },
    metadata: { orgId: ctx.org.id },
    success_url: `${env.APP_URL}/app/settings/billing?upgraded=1`,
    cancel_url: `${env.APP_URL}/app/settings/billing`,
  });
  if (!session.url) throw new AppError("stripe_error", "Couldn't open checkout.", 502);
  await audit(sysDb, {
    orgId: ctx.org.id,
    actorId: ctx.user.id,
    action: "billing.checkout_started",
    entityType: "organization",
    entityId: ctx.org.id,
    diff: { plan, interval },
  });
  return session.url;
}

/** Stripe's customer portal: change plan, seats, payment method, invoices, cancel. */
export async function billingPortal(ctx: OrgContext): Promise<string> {
  authorize(ctx, "billing:manage");
  const s = requireBilling();
  const { customerId } = await ensureCustomer(ctx, s);
  return (
    await s.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.APP_URL}/app/settings/billing`,
    })
  ).url;
}

const ACTIVE = new Set(["active", "trialing", "past_due"]);

/**
 * Mirror a Stripe subscription into our tables. The plan only drops to
 * Starter when the subscription actually ends (canceled/unpaid/expired),
 * not on a failed renewal, so a card hiccup never locks anyone out.
 */
export async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const [row] = await sysDb
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.stripeCustomerId, customerId));
  const orgId = row?.orgId ?? sub.metadata.orgId;
  if (!orgId) {
    logger.warn({ subscription: sub.id }, "subscription without organisation");
    return;
  }
  const table = priceTable();
  let plan: PlanId = "starter";
  let interval: Interval | null = null;
  let extraSeats = 0;
  for (const item of sub.items.data) {
    const p = table.get(item.price.id);
    if (!p) continue;
    if (p.plan === "seat") extraSeats += item.quantity ?? 0;
    else {
      plan = p.plan;
      interval = p.interval;
    }
  }
  const effective: PlanId = ACTIVE.has(sub.status) ? plan : "starter";
  const periodEnd = sub.items.data[0]?.current_period_end;
  await sysDb.transaction(async (tx) => {
    await tx
      .insert(schema.subscriptions)
      .values({
        orgId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        plan: effective,
        status: sub.status,
        interval,
        extraSeats,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      })
      .onConflictDoUpdate({
        target: schema.subscriptions.orgId,
        set: {
          stripeSubscriptionId: sub.id,
          plan: effective,
          status: sub.status,
          interval,
          extraSeats,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        },
      });
    const [org] = await tx
      .select({ plan: schema.organizations.plan })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId));
    if (org?.plan !== effective && isPlanId(effective)) {
      await tx
        .update(schema.organizations)
        .set({ plan: effective })
        .where(eq(schema.organizations.id, orgId));
      await audit(tx, {
        orgId,
        actorId: null,
        actorType: "webhook",
        action: "billing.plan_changed",
        entityType: "organization",
        entityId: orgId,
        diff: { from: org?.plan, to: effective, status: sub.status },
      });
    }
  });
}

export async function subscriptionFor(orgId: string) {
  const [row] = await sysDb
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, orgId));
  return row ?? null;
}
