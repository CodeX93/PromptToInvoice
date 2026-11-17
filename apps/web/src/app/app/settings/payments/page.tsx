import type { Metadata } from "next";
import { hasFeature } from "@pti/core";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { features } from "@/server/env";
import { requireOrg, can } from "@/server/session";
import { getProfile } from "@/server/services/business-profiles";
import { getOrgSettings } from "@/server/services/org-settings";
import { openStripeDashboard, startStripeOnboarding } from "./actions";
import { RemindersForm } from "./reminders-form";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsSettingsPage(props: PageProps<"/app/settings/payments">) {
  const ctx = await requireOrg();
  const [profile, settings, sp] = await Promise.all([getProfile(ctx), getOrgSettings(ctx.org.id), props.searchParams]);
  const canEdit = can(ctx, "settings:write");
  const status = !profile.stripeAccountId ? "none" : profile.stripeChargesEnabled ? "active" : "pending";

  return (
    <>
      <Section
        title="Online payments"
        description="Clients pay from the invoice link by card, SEPA debit, ACH and local methods. Money goes straight to your Stripe account; you're the merchant of record."
      >
        {!features.stripe ? (
          <p className="text-ink-3 text-sm">Stripe isn't configured on this server.</p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <p>
              Status:{" "}
              {status === "active" ? (
                <span className="text-positive">Accepting payments</span>
              ) : status === "pending" ? (
                <span className="text-warning">Stripe needs more information</span>
              ) : (
                <span className="text-ink-3">Not connected</span>
              )}
            </p>
            {sp.return === "1" && status !== "active" ? <p className="text-ink-3 text-xs">Stripe is reviewing your details. This page updates automatically when they're done.</p> : null}
            {canEdit ? (
              <div className="flex gap-2">
                <form action={startStripeOnboarding}>
                  <input type="hidden" name="profileId" value={profile.id} />
                  <Button type="submit" variant={status === "active" ? "secondary" : "primary"}>
                    {status === "none" ? "Connect Stripe" : status === "pending" ? "Continue Stripe setup" : "Update Stripe details"}
                  </Button>
                </form>
                {status !== "none" ? (
                  <form action={openStripeDashboard}>
                    <input type="hidden" name="profileId" value={profile.id} />
                    <Button type="submit" variant="ghost">
                      Open Stripe dashboard
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Section>
      <Section title="Reminders" description="Polite, automatic follow-ups for unpaid invoices. Each reminder is sent once and stops as soon as the invoice is paid.">
        <RemindersForm enabled={settings.reminders.enabled} offsets={settings.reminders.offsets} allowed={hasFeature(ctx.org.plan, "reminders")} canEdit={canEdit} />
      </Section>
    </>
  );
}
