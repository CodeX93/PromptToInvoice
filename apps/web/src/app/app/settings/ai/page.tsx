import type { Metadata } from "next";
import { PLANS } from "@pti/core";
import { withOrg } from "@pti/db";
import { Section } from "@/components/ui/section";
import { db } from "@/server/db";
import { features } from "@/server/env";
import { requireOrg, can } from "@/server/session";
import { getOrgSettings } from "@/server/services/org-settings";
import { usageFor } from "@/server/services/usage";
import { AiForm } from "./ai-form";

export const metadata: Metadata = { title: "AI drafting" };

export default async function AiSettingsPage() {
  const ctx = await requireOrg();
  const [settings, usage] = await Promise.all([
    getOrgSettings(ctx.org.id),
    withOrg(db, ctx.org.id, (tx) => usageFor(tx, ctx.org.id)),
  ]);
  const limit = PLANS[ctx.org.plan].limits.aiDraftsPerMonth;
  return (
    <Section
      title="AI drafting"
      description={
        <>
          Prompts are sent to Anthropic's Claude API to extract invoice details. Only your text and
          your clients' names are sent, never addresses, emails or bank details. Totals and tax are
          always calculated by PromptToInvoice, not the model.
        </>
      }
    >
      {features.ai ? (
        <AiForm
          enabled={settings.ai.enabled}
          retainPrompts={settings.ai.retainPrompts}
          canEdit={can(ctx, "settings:write")}
          usage={`${usage.aiDrafts}${limit === null ? "" : ` of ${limit}`} AI drafts used this month.`}
        />
      ) : (
        <p className="text-ink-3 text-sm">AI drafting isn't configured on this server.</p>
      )}
    </Section>
  );
}
