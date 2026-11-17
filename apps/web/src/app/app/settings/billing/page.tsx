import type { Metadata, Route } from "next";
import Link from "next/link";
import { PLAN_BLURB, PLAN_IDS, PLAN_PRICES, PLANS, seatLimit, type PlanId } from "@pti/core";
import { sql, withOrg } from "@pti/db";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import { db, sysDb } from "@/server/db";
import { features } from "@/server/env";
import { requireOrg, can } from "@/server/session";
import { subscriptionFor } from "@/server/services/billing";
import { usageFor } from "@/server/services/usage";
import { manageBilling, upgrade } from "./actions";

export const metadata: Metadata = { title: "Plan & billing" };

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span>{label}</span>
        <span className="figures text-ink-2">
          {used}
          <span className="text-ink-4"> / {limit === null ? "∞" : limit}</span>
        </span>
      </div>
      <div className="bg-rule mt-1.5 h-px">
        <div className={cn("h-[3px] -translate-y-px", pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-ink")} style={{ width: `${limit === null ? 0 : pct}%` }} />
      </div>
    </div>
  );
}

const FEATURES: Partial<Record<PlanId, string[]>> = {
  starter: ["5 invoices / month", "20 AI drafts / month", "USD & EUR", "Online payments"],
  pro: ["Unlimited invoices", "500 AI drafts / month", "All currencies", "Reminders & recurring", "E-invoices (ZUGFeRD, XRechnung)", "Your branding"],
  business: ["Everything in Pro", "5 business profiles", "3 seats included", "Advanced reports", "2,000 AI drafts / month"],
  enterprise: ["Everything in Business", "API & webhooks", "SSO", "SLA & onboarding"],
};

export default async function BillingPage(props: PageProps<"/app/settings/billing">) {
  const ctx = await requireOrg();
  const sp = await props.searchParams;
  const interval = sp.interval === "year" ? "year" : "month";
  const [usage, sub, counts] = await Promise.all([
    withOrg(db, ctx.org.id, (tx) => usageFor(tx, ctx.org.id)),
    subscriptionFor(ctx.org.id),
    sysDb.execute<{ seats: number; profiles: number }>(sql`
      select (select count(*)::int from members where organization_id = ${ctx.org.id}) as seats,
             (select count(*)::int from business_profiles where org_id = ${ctx.org.id} and archived_at is null) as profiles
    `),
  ]);
  const plan = ctx.org.plan;
  const limits = PLANS[plan].limits;
  const canManage = can(ctx, "billing:manage");

  return (
    <>
      <Section
        title="Your plan"
        description={
          sub?.status === "trialing" && sub.trialEndsAt
            ? `Trial ends ${sub.trialEndsAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}.`
            : sub?.cancelAtPeriodEnd && sub.currentPeriodEnd
              ? `Cancels on ${sub.currentPeriodEnd.toLocaleDateString("en-GB", { dateStyle: "medium" })}.`
              : sub?.status === "past_due"
                ? "Your last payment failed. Update your card to avoid interruption."
                : PLAN_BLURB[plan]
        }
      >
        <p className="font-serif text-3xl">{PLANS[plan].name}</p>
        {sp.upgraded === "1" ? <p className="text-positive mt-2 text-sm">Thanks! Your plan updates as soon as Stripe confirms it.</p> : null}
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Meter label="Invoices issued this month" used={usage.invoicesIssued} limit={limits.invoicesPerMonth} />
          <Meter label="AI drafts this month" used={usage.aiDrafts} limit={limits.aiDraftsPerMonth} />
          <Meter label="Seats" used={counts[0]?.seats ?? 1} limit={seatLimit(plan, sub?.extraSeats ?? 0)} />
          <Meter label="Business profiles" used={counts[0]?.profiles ?? 1} limit={limits.businessProfiles} />
        </div>
        {sub && canManage && features.billing ? (
          <form action={manageBilling} className="mt-6">
            <Button type="submit" variant="secondary">
              Manage billing, seats &amp; invoices
            </Button>
          </form>
        ) : null}
      </Section>

      <Section title="Plans" description="Prices exclude VAT where applicable. Cancel any time; you keep your invoices and data.">
        <div className="mb-5 flex gap-4 text-[13px]">
          {(["month", "year"] as const).map((i) => (
            <Link key={i} href={`/app/settings/billing?interval=${i}` as Route} className={cn("border-b pb-0.5", interval === i ? "border-ink text-ink" : "text-ink-3 border-transparent")}>
              {i === "month" ? "Monthly" : "Yearly · 2 months free"}
            </Link>
          ))}
        </div>
        <div className="border-rule-strong grid border-t sm:grid-cols-2 xl:grid-cols-4">
          {PLAN_IDS.map((p) => {
            const price = p === "pro" || p === "business" ? PLAN_PRICES[p][interval] : null;
            const current = p === plan;
            return (
              <div key={p} className={cn("border-rule flex flex-col gap-3 border-b p-5 sm:border-r", current && "bg-paper-raised")}>
                <div>
                  <p className="font-serif text-xl">{PLANS[p].name}</p>
                  <p className="text-ink-3 text-xs">{PLAN_BLURB[p]}</p>
                </div>
                <p className="figures text-2xl">
                  {p === "starter" ? "€0" : p === "enterprise" ? "Custom" : `€${price ?? 0}`}
                  {price ? <span className="text-ink-3 text-xs"> / {interval}</span> : null}
                </p>
                <ul className="text-ink-2 flex-1 space-y-1 text-[13px]">
                  {FEATURES[p]?.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-ink-4" aria-hidden>
                        —
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                {current ? (
                  <p className="text-ink-3 text-xs">Current plan</p>
                ) : (p === "pro" || p === "business") && canManage && features.billing ? (
                  <form action={upgrade}>
                    <input type="hidden" name="plan" value={p} />
                    <input type="hidden" name="interval" value={interval} />
                    <Button type="submit" size="sm" variant={p === "pro" ? "primary" : "secondary"} className="w-full">
                      {PLAN_IDS.indexOf(p) > PLAN_IDS.indexOf(plan) ? `Upgrade to ${PLANS[p].name}` : `Switch to ${PLANS[p].name}`}
                    </Button>
                  </form>
                ) : p === "enterprise" ? (
                  <a href="mailto:sales@prompttoinvoice.com" className="text-ink-2 text-[13px] underline underline-offset-4">
                    Talk to us
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
