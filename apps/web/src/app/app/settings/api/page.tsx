import type { Metadata } from "next";
import Link from "next/link";
import { hasFeature } from "@pti/core";
import { WEBHOOK_EVENTS } from "@pti/db";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { env } from "@/server/env";
import { can, requireOrg } from "@/server/session";
import { listApiKeys } from "@/server/services/api-keys";
import { listEndpoints } from "@/server/services/webhooks";
import { ApiKeysView, WebhooksView } from "./api-view";

export const metadata: Metadata = { title: "API & webhooks" };

const when = (d: Date | string | null, tz: string) =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: tz,
      }).format(new Date(d))
    : null;

export default async function ApiSettingsPage() {
  const ctx = await requireOrg();
  const base = `${env.APP_URL}/api/v1`;

  if (!hasFeature(ctx.org.plan, "api")) {
    return (
      <Section
        title="API & webhooks"
        description="Create invoices from your own systems, and get told the moment one is viewed or paid."
      >
        <div className="border-rule-strong border-y py-6">
          <p className="max-w-lg text-sm leading-relaxed">
            The REST API and signed webhooks are part of the Enterprise plan. Everything you can do
            in the app (drafting from a sentence included) is available over HTTPS with an API key.
          </p>
          <pre className="figures bg-paper-sunk text-ink-2 mt-4 overflow-x-auto rounded-xs px-4 py-3 text-xs leading-relaxed">
            {`curl ${base}/invoices \\\n  -H "Authorization: Bearer pti_live_…"`}
          </pre>
          <div className="mt-5 flex gap-2">
            <Button asChild>
              <Link href="/app/settings/billing">See plans</Link>
            </Button>
            <Button asChild variant="secondary">
              <a href="/api/v1/openapi.json">OpenAPI spec</a>
            </Button>
          </div>
        </div>
      </Section>
    );
  }

  if (!can(ctx, "apikey:manage")) {
    return (
      <Section title="API & webhooks">
        <p className="text-ink-2 text-sm">Only owners and admins can manage keys and webhooks.</p>
      </Section>
    );
  }

  const [keys, { endpoints, recent }] = await Promise.all([listApiKeys(ctx), listEndpoints(ctx)]);
  const tz = ctx.user.timeZone;
  const urlOf = new Map(endpoints.map((e) => [e.id, e.url]));

  return (
    <>
      <Section
        title="API keys"
        description={
          <>
            Keys act with member permissions: they can create, issue and send invoices, but never
            touch people, billing or settings.
            <span className="figures text-ink-2 mt-2 block truncate" title={base}>
              {base}
            </span>
            <a href="/api/v1/openapi.json" className="underline underline-offset-4">
              OpenAPI spec
            </a>
          </>
        }
      >
        <ApiKeysView
          keys={keys.map((k) => ({
            id: k.id,
            name: k.name,
            prefix: k.prefix,
            created: when(k.createdAt, tz) ?? "",
            lastUsed: when(k.lastUsedAt, tz),
          }))}
        />
      </Section>
      <Section
        title="Webhooks"
        description="We POST a signed JSON event to your URL when something happens. Failed deliveries retry with backoff for about a day; an endpoint that keeps failing is paused until you send it a test."
      >
        <WebhooksView
          events={[...WEBHOOK_EVENTS]}
          endpoints={endpoints.map((e) => ({
            id: e.id,
            url: e.url,
            events: e.events,
            active: e.active,
            failures: e.failureCount,
          }))}
          deliveries={recent.map((d) => ({
            id: d.id,
            url: urlOf.get(d.endpoint_id) ?? "",
            type: d.type,
            status: d.status,
            attempts: d.attempts,
            code: d.response_status,
            error: d.error,
            at: when(d.created_at, tz) ?? "",
          }))}
        />
      </Section>
    </>
  );
}
