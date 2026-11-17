import type { Metadata, Route } from "next";
import Link from "next/link";
import { formatDate, formatMoney, type CurrencyCode } from "@pti/core";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { StatusMark } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { requireOrg, can } from "@/server/session";
import {
  invoiceCounts,
  listInvoices,
  type InvoiceFilter,
  type InvoiceListItem,
} from "@/server/services/invoices";

export const metadata: Metadata = { title: "Invoices" };

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "outstanding", label: "Outstanding" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
];

function isFilter(v: unknown): v is InvoiceFilter {
  return FILTERS.some((f) => f.key === v);
}

/** Group rows under month headings with per-currency month totals, like a ledger. */
function byMonth(items: InvoiceListItem[]) {
  const groups: {
    key: string;
    label: string;
    items: InvoiceListItem[];
    totals: Map<CurrencyCode, number>;
  }[] = [];
  for (const it of items) {
    const key = it.issueDate.slice(0, 7);
    let g = groups.at(-1);
    if (g?.key !== key) {
      g = {
        key,
        label: new Intl.DateTimeFormat("en-GB", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${key}-01T00:00:00Z`)),
        items: [],
        totals: new Map(),
      };
      groups.push(g);
    }
    g.items.push(it);
    // Month heading = amount invoiced; credit notes keep their own rows.
    if (it.docType === "invoice" && it.status !== "draft" && it.status !== "void")
      g.totals.set(it.currency, (g.totals.get(it.currency) ?? 0) + it.total);
  }
  return groups;
}

export default async function InvoicesPage(props: PageProps<"/app/invoices">) {
  const ctx = await requireOrg();
  const sp = await props.searchParams;
  const filter: InvoiceFilter = isFilter(sp.status) ? sp.status : "all";
  const q = typeof sp.q === "string" ? sp.q : "";
  const after = typeof sp.after === "string" ? sp.after : undefined;
  const [{ items, nextCursor }, counts] = await Promise.all([
    listInvoices(ctx, { filter, q, cursor: after }),
    invoiceCounts(ctx),
  ]);
  const href = (params: Record<string, string>) =>
    `/app/invoices?${new URLSearchParams(params).toString()}` as Route;

  return (
    <>
      <PageHeader title="Invoices">
        {can(ctx, "invoice:write") ? (
          <Button asChild>
            <Link href="/app/invoices/new">New invoice</Link>
          </Button>
        ) : null}
      </PageHeader>

      <div className="border-rule flex flex-wrap items-center justify-between gap-4 border-b px-6 lg:px-10">
        <nav aria-label="Filter" className="-mb-px flex scrollbar-thin gap-5 overflow-x-auto">
          {FILTERS.map((f) => {
            const n = f.key === "draft" ? counts.drafts : f.key === "overdue" ? counts.overdue : 0;
            return (
              <Link
                key={f.key}
                href={href({ ...(f.key !== "all" && { status: f.key }), ...(q && { q }) })}
                aria-current={filter === f.key ? "page" : undefined}
                className={cn(
                  "border-b py-2.5 text-[13px] whitespace-nowrap",
                  filter === f.key
                    ? "border-ink text-ink"
                    : "text-ink-3 hover:text-ink border-transparent",
                )}
              >
                {f.label}
                {n > 0 ? (
                  <span
                    className={cn(
                      "figures text-2xs ml-1.5",
                      f.key === "overdue" ? "text-danger" : "text-ink-3",
                    )}
                  >
                    {n}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/app/invoices/recurring"
          className="text-ink-3 hover:text-ink ml-auto text-[13px]"
        >
          Recurring →
        </Link>
        <form role="search" className="py-2">
          {filter !== "all" ? <input type="hidden" name="status" value={filter} /> : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Number, client or reference"
            aria-label="Search invoices"
            className="border-rule-strong focus:border-ink figures w-60 border-b bg-transparent py-1 text-[13px] outline-none"
          />
        </form>
      </div>

      {items.length === 0 ? (
        <Empty
          title={
            q
              ? "Nothing matches that search."
              : filter === "all"
                ? "No invoices yet."
                : "Nothing here."
          }
        >
          {filter === "all" && !q ? (
            <>
              Type what you did into the line at the top, e.g.{" "}
              <span className="figures text-ink-2">“2 days of design for Acme at €650/day”</span>,
              or start a blank invoice.
            </>
          ) : null}
        </Empty>
      ) : (
        <div className="px-6 pb-10 lg:px-10">
          <table className="w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>Number</th>
                <th>Client</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Status</th>
                <th>Amount</th>
              </tr>
            </thead>
            {byMonth(items).map((g) => (
              <tbody key={g.key}>
                <tr>
                  <th colSpan={6} scope="rowgroup" className="pt-7 pb-2 text-left font-normal">
                    <div className="border-rule-strong flex items-baseline justify-between border-b pb-1.5">
                      <span className="font-serif text-base">{g.label}</span>
                      <span className="figures text-ink-3 text-xs">
                        {[...g.totals].map(([c, v]) => formatMoney(v, c)).join("  ·  ")}
                      </span>
                    </div>
                  </th>
                </tr>
                {g.items.map((it) => (
                  <tr
                    key={it.id}
                    className="border-rule hover:bg-paper-sunk/60 group relative border-b"
                  >
                    <td className="figures w-36 py-2.5 text-[13px]">
                      <Link
                        href={`/app/invoices/${it.id}` as Route}
                        className="after:absolute after:inset-0"
                      >
                        {it.number ?? <span className="text-ink-3">Draft</span>}
                      </Link>
                      {it.docType === "credit_note" ? (
                        <span className="text-ink-3 text-2xs ml-1.5 uppercase">CN</span>
                      ) : null}
                    </td>
                    <td className="max-w-0 truncate py-2.5 pr-4">
                      {it.clientName ?? <span className="text-ink-4">No client</span>}
                    </td>
                    <td className="figures text-ink-3 hidden w-28 py-2.5 text-xs md:table-cell">
                      {formatDate(it.issueDate, "en-GB")}
                    </td>
                    <td
                      className={cn(
                        "figures hidden w-28 py-2.5 text-xs lg:table-cell",
                        it.status === "overdue" ? "text-danger" : "text-ink-3",
                      )}
                    >
                      {it.dueDate && it.docType === "invoice"
                        ? formatDate(it.dueDate, "en-GB")
                        : ""}
                    </td>
                    <td className="w-36 py-2.5">
                      <StatusMark status={it.status} />
                    </td>
                    <td className="w-36 py-2.5 text-right">
                      <Money
                        minor={it.total}
                        currency={it.currency}
                        className={it.status === "void" ? "text-ink-4 line-through" : undefined}
                      />
                      {it.amountDue > 0 && it.amountDue !== it.total ? (
                        <span className="figures text-ink-3 text-2xs block">
                          due {formatMoney(it.amountDue, it.currency)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {nextCursor ? (
            <div className="pt-6 text-center">
              <Link
                href={href({
                  ...(filter !== "all" && { status: filter }),
                  ...(q && { q }),
                  after: nextCursor,
                })}
                className="text-ink-2 hover:text-ink text-[13px] underline underline-offset-4"
              >
                Older invoices →
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
