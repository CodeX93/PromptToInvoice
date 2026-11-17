import "server-only";
import Stripe from "stripe";
import { amountDue, statusAfterPayment, todayIn, isCurrencyCode } from "@pti/core";
import { eq, one, schema, withOrg } from "@pti/db";
import { db, sysDb } from "../db";
import { env, features } from "../env";
import { audit } from "../audit";
import { AppError, ConflictError, NotFound } from "../errors";
import { logger } from "../logger";
import { authorize, type OrgContext } from "../session";
import { systemContext } from "../jobs/system-context";
import { deliverReceipt } from "./emails";

let stripe: Stripe | null = null;
export function stripeClient(): Stripe {
  if (!features.stripe)
    throw new AppError("stripe_disabled", "Online payments aren't configured on this server.", 503);
  stripe ??= new Stripe(env.STRIPE_SECRET_KEY ?? "", {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "PromptToInvoice" },
  });
  return stripe;
}

/** For tests: inject a Stripe instance (e.g. pointed at stripe-mock). */
export function setStripeForTests(s: Stripe | null): void {
  stripe = s;
}

// ── Connect onboarding ─────────────────────────────────────────────────────

/**
 * Start (or resume) Stripe Express onboarding for a business profile. The
 * business becomes the merchant of record (direct charges), which keeps
 * VAT and refunds with them, not us.
 */
export async function connectOnboardingLink(ctx: OrgContext, profileId: string): Promise<string> {
  authorize(ctx, "settings:write");
  const s = stripeClient();
  const profile = await withOrg(db, ctx.org.id, async (tx) =>
    one(
      await tx
        .select()
        .from(schema.businessProfiles)
        .where(eq(schema.businessProfiles.id, profileId)),
      "Business profile",
    ),
  );
  let accountId = profile.stripeAccountId;
  if (!accountId) {
    const account = await s.accounts.create(
      {
        type: "express",
        country: profile.address.country,
        email: profile.email ?? ctx.user.email,
        business_profile: {
          name: profile.tradingName ?? profile.legalName,
          url: profile.website ?? undefined,
        },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { orgId: ctx.org.id, profileId },
      },
      { idempotencyKey: `acct-create-${profileId}` },
    );
    accountId = account.id;
    await withOrg(db, ctx.org.id, async (tx) => {
      await tx
        .update(schema.businessProfiles)
        .set({ stripeAccountId: accountId })
        .where(eq(schema.businessProfiles.id, profileId));
      await audit(tx, {
        orgId: ctx.org.id,
        actorId: ctx.user.id,
        action: "stripe.account_created",
        entityType: "business_profile",
        entityId: profileId,
        diff: { accountId },
      });
    });
  }
  const link = await s.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${env.APP_URL}/app/settings/payments?refresh=1`,
    return_url: `${env.APP_URL}/app/settings/payments?return=1`,
  });
  return link.url;
}

export async function connectDashboardLink(ctx: OrgContext, profileId: string): Promise<string> {
  authorize(ctx, "settings:write");
  const profile = await withOrg(db, ctx.org.id, async (tx) =>
    one(
      await tx
        .select()
        .from(schema.businessProfiles)
        .where(eq(schema.businessProfiles.id, profileId)),
      "Business profile",
    ),
  );
  if (!profile.stripeAccountId) throw new NotFound("Stripe account");
  return (await stripeClient().accounts.createLoginLink(profile.stripeAccountId)).url;
}

async function syncAccount(account: Stripe.Account): Promise<void> {
  await sysDb
    .update(schema.businessProfiles)
    .set({ stripeChargesEnabled: account.charges_enabled })
    .where(eq(schema.businessProfiles.stripeAccountId, account.id));
}

// ── Checkout for an invoice (public page) ──────────────────────────────────

export async function checkoutForToken(token: string): Promise<string> {
  const s = stripeClient();
  const [row] = await sysDb
    .select({
      inv: schema.invoices,
      acct: schema.businessProfiles.stripeAccountId,
      enabled: schema.businessProfiles.stripeChargesEnabled,
      email: schema.clients.emails,
    })
    .from(schema.invoices)
    .innerJoin(
      schema.businessProfiles,
      eq(schema.businessProfiles.id, schema.invoices.businessProfileId),
    )
    .leftJoin(schema.clients, eq(schema.clients.id, schema.invoices.clientId))
    .where(eq(schema.invoices.publicToken, token))
    .limit(1);
  if (!row) throw new NotFound("Invoice");
  const inv = row.inv;
  const due = amountDue(inv);
  if (inv.docType !== "invoice" || inv.status !== "open" || due <= 0)
    throw new ConflictError("This invoice has nothing left to pay.");
  if (!row.acct || !row.enabled)
    throw new ConflictError("Online payment isn't available for this invoice.");
  if (!isCurrencyCode(inv.currency)) throw new ConflictError("Unsupported currency.");
  // Stripe amounts are in the currency's smallest unit — same as ours.
  const fee = Math.floor((due * env.STRIPE_APPLICATION_FEE_BPS) / 10_000);
  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: inv.currency.toLowerCase(),
            unit_amount: due,
            product_data: {
              name: `Invoice ${inv.number ?? ""}`.trim(),
              description: inv.issuedSnapshot?.seller.legalName,
            },
          },
        },
      ],
      customer_email: row.email?.[0] ?? undefined,
      client_reference_id: inv.id,
      metadata: { invoiceId: inv.id, orgId: inv.orgId },
      payment_intent_data: {
        ...(fee > 0 && { application_fee_amount: fee }),
        description: `Invoice ${inv.number ?? ""}`,
        metadata: { invoiceId: inv.id, orgId: inv.orgId, number: inv.number ?? "" },
      },
      success_url: `${env.APP_URL}/i/${token}?paid=1`,
      cancel_url: `${env.APP_URL}/i/${token}`,
    },
    // Same invoice + same amount due → same session (double-click safe).
    { stripeAccount: row.acct, idempotencyKey: `checkout-${inv.id}-${due}-${inv.version}` },
  );
  if (!session.url) throw new AppError("stripe_error", "Couldn't start the payment.", 502);
  return session.url;
}

// ── Webhooks ───────────────────────────────────────────────────────────────

/** Verify against the platform secret, then the Connect secret. */
export function verifyWebhook(payload: string, signature: string): Stripe.Event {
  const s = stripeClient();
  const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (x): x is string => Boolean(x),
  );
  let lastErr: Error = new Error("No webhook secret configured");
  for (const secret of secrets) {
    try {
      return s.webhooks.constructEvent(payload, signature, secret);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr;
}

async function recordStripePayment(args: {
  invoiceId: string;
  orgId: string;
  paymentIntentId: string;
  chargeId: string | null;
  amount: number;
  currency: string;
  feeAmount: number | null;
}): Promise<boolean> {
  const ctx = await systemContext(args.orgId);
  const recorded = await withOrg(db, args.orgId, async (tx) => {
    const [inv] = await tx
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, args.invoiceId))
      .for("update");
    if (!inv) return false;
    const inserted = await tx
      .insert(schema.payments)
      .values({
        orgId: args.orgId,
        invoiceId: inv.id,
        amount: args.amount,
        currency: args.currency.toUpperCase(),
        method: "stripe",
        reference: args.paymentIntentId,
        receivedOn: todayIn(ctx.org.timeZone),
        stripePaymentIntentId: args.paymentIntentId,
        stripeChargeId: args.chargeId,
        feeAmount: args.feeAmount,
      })
      .onConflictDoNothing({ target: schema.payments.stripePaymentIntentId })
      .returning({ id: schema.payments.id });
    if (inserted.length === 0) return false; // already recorded (webhook retry)
    const paid = inv.amountPaid + args.amount;
    const status =
      inv.status === "void" ? "void" : statusAfterPayment(inv.total, paid, inv.creditedAmount);
    await tx
      .update(schema.invoices)
      .set({
        amountPaid: paid,
        status,
        paidAt: status === "paid" ? new Date() : inv.paidAt,
        version: inv.version + 1,
      })
      .where(eq(schema.invoices.id, inv.id));
    await tx
      .insert(schema.invoiceEvents)
      .values({
        orgId: args.orgId,
        invoiceId: inv.id,
        type: "payment_recorded",
        data: { amount: args.amount, method: "stripe", paymentIntentId: args.paymentIntentId },
      });
    if (status === "paid")
      await tx
        .insert(schema.invoiceEvents)
        .values({ orgId: args.orgId, invoiceId: inv.id, type: "paid", data: {} });
    await audit(tx, {
      orgId: args.orgId,
      actorId: null,
      actorType: "webhook",
      action: "payment.stripe_recorded",
      entityType: "invoice",
      entityId: inv.id,
      diff: { amount: args.amount, paymentIntentId: args.paymentIntentId },
    });
    return true;
  });
  if (recorded)
    await deliverReceipt(ctx, args.invoiceId, args.amount).catch((err: unknown) =>
      logger.warn({ err }, "receipt not sent"),
    );
  return recorded;
}

async function recordRefund(charge: Stripe.Charge, account: string | null): Promise<void> {
  const pi =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return;
  const [p] = await sysDb
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.stripePaymentIntentId, pi));
  if (!p) return;
  const refunded = Math.min(p.amount, charge.amount_refunded);
  const delta = refunded - p.refundedAmount;
  if (delta <= 0) return;
  await withOrg(db, p.orgId, async (tx) => {
    const [inv] = await tx
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, p.invoiceId))
      .for("update");
    if (!inv) return;
    await tx
      .update(schema.payments)
      .set({ refundedAmount: refunded })
      .where(eq(schema.payments.id, p.id));
    const paid = Math.max(0, inv.amountPaid - delta);
    const status =
      inv.status === "void" ? "void" : statusAfterPayment(inv.total, paid, inv.creditedAmount);
    await tx
      .update(schema.invoices)
      .set({
        amountPaid: paid,
        status,
        paidAt: status === "paid" ? inv.paidAt : null,
        version: inv.version + 1,
      })
      .where(eq(schema.invoices.id, inv.id));
    await tx
      .insert(schema.invoiceEvents)
      .values({
        orgId: p.orgId,
        invoiceId: inv.id,
        type: "payment_refunded",
        data: { amount: delta, account },
      });
  });
}

/**
 * Apply a verified event. Returns false if it was already processed.
 * Dedupe is by event id in processed_webhooks; every handler is also
 * idempotent on its own (PaymentIntent id uniqueness, refund deltas).
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  const fresh = await sysDb
    .insert(schema.processedWebhooks)
    .values({ id: event.id, source: "stripe", type: event.type })
    .onConflictDoNothing()
    .returning({ id: schema.processedWebhooks.id });
  if (fresh.length === 0) return false;
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        if (session.payment_status !== "paid" || session.mode !== "payment") break;
        const invoiceId = session.metadata?.invoiceId;
        const orgId = session.metadata?.orgId;
        const pi =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
        if (!invoiceId || !orgId || !pi || session.amount_total === null) break;
        await recordStripePayment({
          invoiceId,
          orgId,
          paymentIntentId: pi,
          chargeId: null,
          amount: session.amount_total,
          currency: session.currency ?? "eur",
          feeAmount: null,
        });
        break;
      }
      case "account.updated":
        await syncAccount(event.data.object);
        break;
      case "charge.refunded":
        await recordRefund(event.data.object, event.account ?? null);
        break;
      default:
        break;
    }
    return true;
  } catch (err) {
    // Allow Stripe's retry to reprocess.
    await sysDb.delete(schema.processedWebhooks).where(eq(schema.processedWebhooks.id, event.id));
    throw err;
  }
}
