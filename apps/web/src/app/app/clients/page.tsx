import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { countryName, isCurrencyCode } from "@pti/core";
import { PageHeader } from "@/components/shell/page-header";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { NewClientButton } from "@/components/clients/new-client-button";
import { countryOptions } from "@/lib/countries";
import { requireOrg, can } from "@/server/session";
import { listClients } from "@/server/services/clients";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage(props: PageProps<"/app/clients">) {
  const ctx = await requireOrg();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const archived = sp.view === "archived";
  const cursor = typeof sp.after === "string" ? sp.after : undefined;
  const { items, nextCursor } = await listClients(ctx, { q, status: archived ? "archived" : "active", cursor });
  const canWrite = can(ctx, "client:write");

  return (
    <>
      <PageHeader title="Clients" description="Everyone you bill, with what they owe right now.">
        {canWrite ? <NewClientButton countries={countryOptions()} /> : null}
      </PageHeader>

      <form className="flex flex-wrap items-center gap-6 px-6 pb-4 lg:px-10" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, email or VAT number"
          aria-label="Search clients"
          className="border-rule-strong focus:border-ink figures w-72 border-b bg-transparent py-1.5 text-[13px] outline-none"
        />
        {archived ? <input type="hidden" name="view" value="archived" /> : null}
        <Link href={(archived ? "/app/clients" : "/app/clients?view=archived") as Route} className="text-ink-3 hover:text-ink text-[13px]">
          {archived ? "← Active clients" : "Archived"}
        </Link>
      </form>

      {items.length === 0 ? (
        <Empty title={q ? "No clients match that search." : archived ? "No archived clients." : "No clients yet."}>
          {!q && !archived ? "Add one here, or just describe an invoice in the prompt bar. New clients are created from the draft." : null}
        </Empty>
      ) : (
        <div className="px-6 lg:px-10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-rule-strong border-b text-left">
                <th className="label-caps py-2 font-medium">Client</th>
                <th className="label-caps hidden py-2 font-medium md:table-cell">Country</th>
                <th className="label-caps hidden py-2 font-medium lg:table-cell">VAT / tax ID</th>
                <th className="label-caps hidden py-2 text-right font-medium sm:table-cell">Invoices</th>
                <th className="label-caps py-2 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-rule hover:bg-paper-sunk/60 group border-b">
                  <td className="py-2.5">
                    <Link href={`/app/clients/${c.id}` as Route} className="block">
                      <span className="group-hover:underline group-hover:underline-offset-4">{c.name}</span>
                      {c.email ? <span className="text-ink-3 block text-xs">{c.email}</span> : null}
                    </Link>
                  </td>
                  <td className="text-ink-2 hidden py-2.5 md:table-cell">{c.country ? countryName(c.country) : "—"}</td>
                  <td className="figures text-ink-2 hidden py-2.5 text-xs lg:table-cell">
                    {c.vatId ?? "—"}
                    {c.vatVerified ? <span className="text-positive ml-1.5" title="Verified with VIES">✓</span> : null}
                  </td>
                  <td className="figures text-ink-2 hidden py-2.5 text-right sm:table-cell">{c.invoiceCount}</td>
                  <td className="py-2.5 text-right">
                    {c.outstanding.length === 0 ? (
                      <span className="text-ink-4">—</span>
                    ) : (
                      c.outstanding.map((o) => (isCurrencyCode(o.currency) ? <Money key={o.currency} minor={o.amount} currency={o.currency} className="block" /> : null))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor ? (
            <div className="py-6 text-center">
              <Link
                href={`/app/clients?${new URLSearchParams({ ...(q && { q }), ...(archived && { view: "archived" }), after: nextCursor }).toString()}` as Route}
                className="text-ink-2 hover:text-ink text-[13px] underline underline-offset-4"
              >
                More clients →
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
