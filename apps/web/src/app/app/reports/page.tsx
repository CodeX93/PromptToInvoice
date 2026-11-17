import type { Metadata, Route } from "next";
import Link from "next/link";
import { formatDate, formatMoney, hasFeature, TAX_CATEGORY_LABEL, todayIn, type TaxCategory } from "@pti/core";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PERIOD_LABEL, PERIODS, resolvePeriod } from "@/lib/periods";
import { requireOrg, can } from "@/server/session";
import { revenueByClient, revenueByMonth, taxReport } from "@/server/services/reports";

export const metadata: Metadata = { title: "Reports" };

const TABS = [
  { key: "tax", label: "VAT summary" },
  { key: "revenue", label: "Revenue by month" },
  { key: "clients", label: "By client" },
] as const;

export default async function ReportsPage(props: PageProps<"/app/reports">) {
  const ctx = await requireOrg();
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? sp[k] : undefined);
  const tab = TABS.find((t) => t.key === str("tab"))?.key ?? "tax";
  const period = resolvePeriod(todayIn(ctx.org.timeZone), str("period"), str("from"), str("to"));
  const advanced = hasFeature(ctx.org.plan, "advanced_reports");
  const q = (over: Record<string, string>) => `/app/reports?${new URLSearchParams({ tab, period: period.key === "custom" ? "this-month" : period.key, ...over }).toString()}` as Route;
  const exportHref = (report: string) => `/app/reports/export?${new URLSearchParams({ report, from: period.from, to: period.to }).toString()}`;

  return (
    <div className="pb-16">
      <PageHeader title="Reports" description={`${formatDate(period.from, "en-GB", "long")} – ${formatDate(period.to, "en-GB", "long")}`}>
        {can(ctx, "export:run") ? (
          <>
            <Button asChild variant="secondary" size="sm">
              <a href={exportHref("invoices")}>Export invoices (CSV)</a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={exportHref(tab)}>Export this report</a>
            </Button>
          </>
        ) : null}
      </PageHeader>

      <div className="border-rule flex flex-wrap items-center justify-between gap-4 border-b px-6 lg:px-10">
        <nav aria-label="Report" className="-mb-px flex gap-5">
          {TABS.map((t) => (
            <Link key={t.key} href={q({ tab: t.key })} aria-current={tab === t.key ? "page" : undefined} className={cn("border-b py-2.5 text-[13px]", tab === t.key ? "border-ink text-ink" : "text-ink-3 hover:text-ink border-transparent")}>
              {t.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Period" className="flex flex-wrap gap-3 py-2 text-[13px]">
          {PERIODS.map((p) => (
            <Link key={p} href={q({ period: p })} className={cn(period.key === p ? "text-ink underline underline-offset-4" : "text-ink-3 hover:text-ink")}>
              {PERIOD_LABEL[p]}
            </Link>
          ))}
        </nav>
      </div>

      <div className="px-6 pt-6 lg:px-10">
        {tab === "tax" ? <TaxTable rows={await taxReport(ctx, period.from, period.to)} /> : null}
        {tab === "revenue" ? (advanced ? <RevenueTable rows={await revenueByMonth(ctx, period.from, period.to)} /> : <Upsell />) : null}
        {tab === "clients" ? (advanced ? <ClientTable rows={await revenueByClient(ctx, period.from, period.to)} /> : <Upsell />) : null}
      </div>
    </div>
  );
}

function Upsell() {
  return (
    <p className="text-ink-2 py-10 text-sm">
      Revenue and client reports are part of the Business plan.{" "}
      <Link href="/app/settings/billing" className="text-ink underline underline-offset-4">
        See plans
      </Link>
    </p>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cn("label-caps py-2 font-medium", right && "text-right")}>{children}</th>;
}

function TaxTable({ rows }: { rows: Awaited<ReturnType<typeof taxReport>> }) {
  if (!rows.length) return <p className="text-ink-3 py-10 text-sm">No issued documents in this period.</p>;
  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-rule-strong border-b text-left">
            <Th>Treatment</Th>
            <Th right>Rate</Th>
            <Th right>Taxable amount</Th>
            <Th right>Tax</Th>
            <Th right>Documents</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.currency}${r.category}${r.rate}`} className="border-rule border-b">
              <td className="py-2.5">
                <span className="figures text-ink-3 mr-2 text-xs">{r.category}</span>
                {TAX_CATEGORY_LABEL[r.category as TaxCategory]}
              </td>
              <td className="figures py-2.5 text-right">{Number(r.rate)}%</td>
              <td className="figures py-2.5 text-right">{formatMoney(r.taxable, r.currency)}</td>
              <td className="figures py-2.5 text-right">{formatMoney(r.tax, r.currency)}</td>
              <td className="figures text-ink-3 py-2.5 text-right">{r.documents}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-ink-3 mt-4 max-w-2xl text-xs leading-relaxed">
        From the frozen tax breakdown of each issued document; credit notes are netted. Reverse-charge (AE) and intra-community (K) amounts are what
        typically goes on an EC Sales List. Confirm figures with your accountant before filing.
      </p>
    </>
  );
}

function RevenueTable({ rows }: { rows: Awaited<ReturnType<typeof revenueByMonth>> }) {
  if (!rows.length) return <p className="text-ink-3 py-10 text-sm">No revenue in this period.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-rule-strong border-b text-left">
          <Th>Month</Th>
          <Th>Currency</Th>
          <Th right>Invoiced</Th>
          <Th right>Credited</Th>
          <Th right>Collected</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.month}${r.currency}`} className="border-rule border-b">
            <td className="figures py-2.5">{r.month}</td>
            <td className="text-ink-3 py-2.5">{r.currency}</td>
            <td className="figures py-2.5 text-right">{formatMoney(r.invoiced, r.currency)}</td>
            <td className="figures text-ink-3 py-2.5 text-right">{r.credited ? formatMoney(-r.credited, r.currency) : "—"}</td>
            <td className="figures py-2.5 text-right">{formatMoney(r.collected, r.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClientTable({ rows }: { rows: Awaited<ReturnType<typeof revenueByClient>> }) {
  if (!rows.length) return <p className="text-ink-3 py-10 text-sm">No invoices in this period.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-rule-strong border-b text-left">
          <Th>Client</Th>
          <Th right>Invoiced</Th>
          <Th right>Collected</Th>
          <Th right>Outstanding</Th>
          <Th right>Avg. days to pay</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.clientId}${r.currency}`} className="border-rule border-b">
            <td className="py-2.5">
              <Link href={`/app/clients/${r.clientId}` as Route} className="hover:underline">
                {r.name}
              </Link>
            </td>
            <td className="figures py-2.5 text-right">{formatMoney(r.invoiced, r.currency)}</td>
            <td className="figures py-2.5 text-right">{formatMoney(r.collected, r.currency)}</td>
            <td className={cn("figures py-2.5 text-right", r.outstanding > 0 ? "" : "text-ink-4")}>{formatMoney(r.outstanding, r.currency)}</td>
            <td className="figures text-ink-2 py-2.5 text-right">{r.avgDaysToPay ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
