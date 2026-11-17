import type { Metadata, Route } from "next";
import Link from "next/link";
import { formatDate, formatMoney, isCurrencyCode } from "@pti/core";
import { PageHeader } from "@/components/shell/page-header";
import { Empty } from "@/components/ui/empty";
import { requireOrg } from "@/server/session";
import { describeSchedule, listSchedules } from "@/server/services/recurring";
import { ScheduleRowActions } from "./schedule-row-actions";

export const metadata: Metadata = { title: "Recurring invoices" };

const MODE = {
  draft: "Creates a draft",
  issue: "Issues",
  issue_and_send: "Issues and emails",
} as const;

export default async function RecurringPage() {
  const ctx = await requireOrg();
  const rows = await listSchedules(ctx);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/app/invoices">Invoices</Link>}
        title="Recurring"
        description="Retainers and subscriptions. Open any issued invoice and choose “Repeat on a schedule” to add one."
      />
      {rows.length === 0 ? (
        <Empty title="No recurring invoices yet." />
      ) : (
        <div className="px-6 pb-12 lg:px-10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-rule-strong border-b text-left">
                <th className="label-caps py-2 font-medium">Client</th>
                <th className="label-caps py-2 font-medium">Schedule</th>
                <th className="label-caps hidden py-2 font-medium md:table-cell">Next</th>
                <th className="label-caps py-2 text-right font-medium">Amount</th>
                <th className="w-40" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, clientName, number, total, currency }) => (
                <tr key={s.id} className="border-rule border-b">
                  <td className="py-2.5">
                    {clientName ?? "—"}
                    <Link
                      href={`/app/invoices/${s.templateInvoiceId}` as Route}
                      className="figures text-ink-3 block text-xs hover:underline"
                    >
                      from {number ?? "draft"}
                    </Link>
                  </td>
                  <td className="text-ink-2 py-2.5">
                    {describeSchedule(s.intervalUnit, s.intervalCount)}
                    <span className="text-ink-3 block text-xs">{MODE[s.autoIssue]}</span>
                  </td>
                  <td className="figures text-ink-2 hidden py-2.5 text-xs md:table-cell">
                    {s.status === "active" ? formatDate(s.nextRunOn, "en-GB") : s.status}
                  </td>
                  <td className="figures py-2.5 text-right">
                    {isCurrencyCode(currency) ? formatMoney(total, currency) : total}
                  </td>
                  <td className="py-2.5 text-right">
                    <ScheduleRowActions id={s.id} status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
