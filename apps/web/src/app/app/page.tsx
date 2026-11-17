import type { Metadata, Route } from "next";
import Link from "next/link";
import { formatMoney, isCurrencyCode, type CurrencyCode } from "@pti/core";
import { CollectionsChart } from "@/components/dashboard/collections-chart";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { features } from "@/server/env";
import { requireOrg, can } from "@/server/session";
import { getProfile } from "@/server/services/business-profiles";
import { overview } from "@/server/services/reports";

export const metadata: Metadata = { title: "Overview" };

const EVENT: Record<string, string> = {
  issued: "issued",
  sent: "sent",
  viewed: "viewed by client",
  paid: "paid in full",
  payment_recorded: "payment received",
  voided: "voided",
  email_bounced: "email bounced",
  reminder_sent: "reminder sent",
};

function greeting(hour: number): string {
  return hour < 5
    ? "Working late"
    : hour < 12
      ? "Good morning"
      : hour < 18
        ? "Good afternoon"
        : "Good evening";
}

export default async function OverviewPage(props: PageProps<"/app">) {
  const ctx = await requireOrg();
  const profile = await getProfile(ctx);
  const primary: CurrencyCode = isCurrencyCode(profile.defaultCurrency)
    ? profile.defaultCurrency
    : "EUR";
  const sp = await props.searchParams;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: ctx.user.timeZone,
    }).format(new Date()),
  );
  const first = ctx.user.name.split(" ")[0] ?? "";

  if (!can(ctx, "report:read")) {
    return <PageHeader eyebrow={ctx.org.name} title={`${greeting(hour)}, ${first}.`} />;
  }
  const o = await overview(ctx, primary);
  const k = o.kpis[0];
  const isEmpty =
    o.kpis.every(
      (x) => x.outstanding === 0 && x.invoicedThisMonth === 0 && x.invoicedLastMonth === 0,
    ) && o.activity.length === 0;
  const fmt = (v: number, c: CurrencyCode = primary) => formatMoney(v, c);
  const agingMax = Math.max(1, ...o.aging.map((a) => a.amount));
  const delta =
    k && k.invoicedLastMonth > 0
      ? Math.round(((k.invoicedThisMonth - k.invoicedLastMonth) / k.invoicedLastMonth) * 100)
      : null;

  return (
    <div className="pb-16">
      <PageHeader eyebrow={ctx.org.name} title={`${greeting(hour)}, ${first}.`}>
        {o.drafts > 0 ? (
          <Link
            href="/app/invoices?status=draft"
            className="text-ink-2 hover:text-ink text-[13px] underline-offset-4 hover:underline"
          >
            {o.drafts} draft{o.drafts === 1 ? "" : "s"} waiting →
          </Link>
        ) : null}
      </PageHeader>

      {sp.welcome === "1" || isEmpty ? (
        <section className="border-rule-strong mx-6 mb-10 grid gap-8 border-y py-8 md:grid-cols-[1fr_auto] lg:mx-10">
          <div className="max-w-xl">
            <p className="label-caps">First invoice</p>
            <h2 className="mt-2 text-2xl leading-snug">
              {features.ai
                ? "Describe the work in the line at the top. We'll draft the invoice."
                : "Create your first invoice."}
            </h2>
            <p className="text-ink-2 mt-2 text-sm leading-relaxed">
              {features.ai ? (
                <>
                  Try{" "}
                  <span className="figures text-ink">
                    “3 days of design for Acme GmbH at €650/day, net 14”
                  </span>
                  . You'll get an editable draft with the client, lines, VAT and due date filled in,
                  and nothing is sent until you say so.
                </>
              ) : (
                "Add a client, a few lines, and issue it. Numbers, VAT and the PDF are handled for you."
              )}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Button asChild>
              <Link href="/app/invoices/new">New invoice</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/app/settings">Check business details</Link>
            </Button>
          </div>
        </section>
      ) : null}

      {k ? (
        <section
          aria-label="Key figures"
          className="border-rule-strong mx-6 grid border-y sm:grid-cols-2 lg:mx-10 lg:grid-cols-4"
        >
          <Figure label="Outstanding" value={fmt(k.outstanding)} />
          <Figure
            label="Overdue"
            value={fmt(k.overdue)}
            note={
              k.overdueCount
                ? `${k.overdueCount} invoice${k.overdueCount === 1 ? "" : "s"}`
                : "none"
            }
            tone={k.overdue > 0 ? "danger" : undefined}
            href={k.overdueCount ? "/app/invoices?status=overdue" : undefined}
          />
          <Figure
            label="Invoiced this month"
            value={fmt(k.invoicedThisMonth)}
            note={
              delta === null
                ? `last month ${fmt(k.invoicedLastMonth)}`
                : `${delta >= 0 ? "+" : ""}${delta}% vs last month`
            }
          />
          <Figure label="Collected, 30 days" value={fmt(k.collected30d)} />
        </section>
      ) : null}
      {o.kpis.length > 1 ? (
        <p className="text-ink-3 figures mx-6 mt-2 text-xs lg:mx-10">
          Also outstanding:{" "}
          {o.kpis
            .slice(1)
            .filter((x) => x.outstanding > 0)
            .map((x) => fmt(x.outstanding, x.currency))
            .join(" · ") || "nothing in other currencies"}
        </p>
      ) : null}

      <div className="mt-10 grid gap-12 px-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:px-10">
        <div className="flex flex-col gap-12">
          <CollectionsChart data={o.collectedByMonth} currency={primary} />

          <section aria-labelledby="aging">
            <h2 id="aging" className="label-caps mb-3">
              Unpaid by age · {primary}
            </h2>
            <ul>
              {o.aging.map((a) => (
                <li
                  key={a.bucket}
                  className="border-rule grid grid-cols-[110px_minmax(0,1fr)_120px] items-center gap-4 border-b py-2 text-[13px]"
                >
                  <span className={cn(a.bucket === "current" ? "text-ink-2" : "text-ink")}>
                    {a.bucket === "current" ? "Not yet due" : `${a.bucket} days late`}
                  </span>
                  <span className="bg-rule h-px">
                    <span
                      className={cn(
                        "block h-[3px] -translate-y-px",
                        a.bucket === "current" ? "bg-ink-4" : "bg-ink",
                      )}
                      style={{ width: `${(a.amount / agingMax) * 100}%` }}
                    />
                  </span>
                  <span className="figures text-right">
                    {a.amount ? fmt(a.amount) : <span className="text-ink-4">—</span>}
                    {a.count ? <span className="text-ink-3 text-2xs"> · {a.count}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-col gap-12">
          <section aria-labelledby="owed">
            <h2 id="owed" className="label-caps mb-3">
              Who owes you
            </h2>
            {o.topClients.length === 0 ? (
              <p className="text-ink-3 text-sm">Nobody. Everything's paid.</p>
            ) : (
              <ol>
                {o.topClients.map((c) => (
                  <li
                    key={`${c.id}${c.currency}`}
                    className="border-rule flex justify-between gap-4 border-b py-2 text-[13px]"
                  >
                    <Link
                      href={`/app/clients/${c.id}` as Route}
                      className="truncate hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="figures">{fmt(c.outstanding, c.currency)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="activity">
            <h2 id="activity" className="label-caps mb-3">
              Recently
            </h2>
            {o.activity.length === 0 ? (
              <p className="text-ink-3 text-sm">Activity on your invoices shows up here.</p>
            ) : (
              <ol className="text-[13px]">
                {o.activity.map((a, i) => (
                  <li key={i} className="border-rule flex gap-3 border-b py-2">
                    <time
                      className="figures text-ink-3 text-2xs w-14 shrink-0 leading-5"
                      dateTime={a.at.toISOString()}
                    >
                      {new Intl.DateTimeFormat("en-GB", {
                        day: "numeric",
                        month: "short",
                        timeZone: ctx.user.timeZone,
                      }).format(a.at)}
                    </time>
                    <span className="min-w-0">
                      <Link
                        href={`/app/invoices/${a.invoiceId}` as Route}
                        className="figures hover:underline"
                      >
                        {a.number ?? "Draft"}
                      </Link>{" "}
                      <span
                        className={cn(
                          a.type === "email_bounced"
                            ? "text-danger"
                            : a.type === "paid"
                              ? "text-positive"
                              : "text-ink-2",
                        )}
                      >
                        {EVENT[a.type] ?? a.type}
                      </span>
                      {a.client ? <span className="text-ink-3"> · {a.client}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
  href,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "danger";
  href?: Route;
}) {
  const body = (
    <>
      <p className="label-caps">{label}</p>
      <p
        className={cn(
          "figures mt-2 text-[26px] leading-none tracking-tight",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {note ? <p className="text-ink-3 mt-2 text-xs">{note}</p> : null}
    </>
  );
  const cls =
    "border-rule block border-b px-0 py-5 sm:px-5 sm:first:pl-0 lg:border-b-0 lg:border-l lg:first:border-l-0";
  return href ? (
    <Link href={href} className={cn(cls, "hover:bg-paper-sunk/50")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
