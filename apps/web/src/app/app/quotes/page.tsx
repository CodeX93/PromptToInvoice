import type { Metadata, Route } from "next";
import Link from "next/link";
import { formatDate } from "@pti/core";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { StatusMark } from "@/components/ui/status";
import { requireOrg, can } from "@/server/session";
import { listInvoices } from "@/server/services/invoices";

export const metadata: Metadata = { title: "Quotes" };

export default async function QuotesPage() {
  const ctx = await requireOrg();
  const { items } = await listInvoices(ctx, { filter: "quotes", limit: 100 });
  return (
    <>
      <PageHeader
        title="Quotes"
        description="Send a price before the work. Clients can accept on the link, and an accepted quote becomes an invoice in one click."
      >
        {can(ctx, "invoice:write") ? (
          <Button asChild>
            <Link href="/app/invoices/new?type=quote">New quote</Link>
          </Button>
        ) : null}
      </PageHeader>
      {items.length === 0 ? (
        <Empty title="No quotes yet." />
      ) : (
        <div className="px-6 pb-12 lg:px-10">
          <table className="w-full text-sm">
            <tbody>
              {items.map((q) => (
                <tr key={q.id} className="border-rule hover:bg-paper-sunk/60 relative border-b">
                  <td className="figures w-36 py-2.5 text-[13px]">
                    <Link
                      href={`/app/invoices/${q.id}` as Route}
                      className="after:absolute after:inset-0"
                    >
                      {q.number ?? <span className="text-ink-3">Draft</span>}
                    </Link>
                  </td>
                  <td className="max-w-0 truncate py-2.5 pr-4">
                    {q.clientName ?? <span className="text-ink-4">No client</span>}
                  </td>
                  <td className="figures text-ink-3 hidden w-28 py-2.5 text-xs md:table-cell">
                    {formatDate(q.issueDate, "en-GB")}
                  </td>
                  <td className="w-36 py-2.5">
                    <StatusMark status={q.status} />
                  </td>
                  <td className="w-36 py-2.5 text-right">
                    <Money minor={q.total} currency={q.currency} />
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
