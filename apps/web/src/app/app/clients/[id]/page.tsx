import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { countryName, formatDate, formatMoney, isCurrencyCode } from "@pti/core";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { StatusMark } from "@/components/ui/status";
import { countryOptions } from "@/lib/countries";
import { NotFound } from "@/server/errors";
import { requireOrg, can } from "@/server/session";
import { getClient } from "@/server/services/clients";
import { listInvoices } from "@/server/services/invoices";
import { ClientHeaderActions } from "./client-header-actions";

export const metadata: Metadata = { title: "Client" };

export default async function ClientPage(props: PageProps<"/app/clients/[id]">) {
  const ctx = await requireOrg();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const client = await getClient(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });
  const { items } = await listInvoices(ctx, { clientId: id, limit: 100 });
  const outstanding = new Map<string, number>();
  for (const i of items)
    if (i.amountDue > 0)
      outstanding.set(i.currency, (outstanding.get(i.currency) ?? 0) + i.amountDue);
  const a = client.address;

  return (
    <>
      <PageHeader eyebrow={<Link href="/app/clients">Clients</Link>} title={client.name}>
        {can(ctx, "client:write") ? (
          <ClientHeaderActions
            countries={countryOptions()}
            archived={client.status === "archived"}
            hasVat={Boolean(client.vatId)}
            values={{
              id: client.id,
              name: client.name,
              contactName: client.contactName,
              emails: client.emails,
              phone: client.phone,
              address: client.address,
              isBusiness: client.isBusiness,
              vatId: client.vatId,
              taxId: client.taxId,
              currency: client.currency,
              paymentTermsDays: client.paymentTermsDays,
              buyerReference: client.buyerReference,
              notes: client.notes,
            }}
          />
        ) : null}
        {can(ctx, "invoice:write") ? (
          <Button asChild size="sm">
            <Link href={`/app/invoices/new?client=${client.id}` as Route}>New invoice</Link>
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-10 px-6 pb-12 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-10">
        <aside className="flex flex-col gap-6 text-[13px]">
          <div>
            <p className="label-caps">Outstanding</p>
            {outstanding.size === 0 ? (
              <p className="figures mt-1 text-xl">—</p>
            ) : (
              [...outstanding].map(([c, v]) =>
                isCurrencyCode(c) ? (
                  <p key={c} className="figures mt-1 text-xl">
                    {formatMoney(v, c)}
                  </p>
                ) : null,
              )
            )}
          </div>
          <dl className="grid gap-3">
            {client.emails.length ? <Fact label="Email">{client.emails.join(", ")}</Fact> : null}
            {client.contactName ? <Fact label="Contact">{client.contactName}</Fact> : null}
            {a ? (
              <Fact label="Address">
                {[
                  a.line1,
                  a.line2,
                  [a.postalCode, a.city].filter(Boolean).join(" "),
                  a.region,
                  countryName(a.country),
                ]
                  .filter(Boolean)
                  .join("\n")}
              </Fact>
            ) : null}
            {client.vatId ? (
              <Fact label="VAT number">
                <span className="figures">{client.vatId}</span>
                {client.vatIdVerifiedAt ? (
                  <span className="text-positive block text-xs">
                    ✓ Verified{" "}
                    {formatDate(client.vatIdVerifiedAt.toISOString().slice(0, 10), "en-GB")}
                    {client.vatIdVerifiedName ? ` · ${client.vatIdVerifiedName}` : ""}
                  </span>
                ) : (
                  <span className="text-ink-3 block text-xs">Not verified</span>
                )}
              </Fact>
            ) : null}
            <Fact label="Terms">
              {client.paymentTermsDays !== null
                ? `${client.paymentTermsDays} days`
                : "Business default"}
            </Fact>
            {client.currency ? <Fact label="Currency">{client.currency}</Fact> : null}
            {client.notes ? <Fact label="Notes">{client.notes}</Fact> : null}
          </dl>
        </aside>

        <section>
          <h2 className="border-rule-strong border-b pb-2 font-serif text-lg">Invoices</h2>
          {items.length === 0 ? (
            <p className="text-ink-3 py-8 text-sm">No invoices for this client yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-rule hover:bg-paper-sunk/60 relative border-b">
                    <td className="figures py-2.5 text-[13px]">
                      <Link
                        href={`/app/invoices/${i.id}` as Route}
                        className="after:absolute after:inset-0"
                      >
                        {i.number ?? "Draft"}
                      </Link>
                    </td>
                    <td className="figures text-ink-3 py-2.5 text-xs">
                      {formatDate(i.issueDate, "en-GB")}
                    </td>
                    <td className="py-2.5">
                      <StatusMark status={i.status} />
                    </td>
                    <td className="py-2.5 text-right">
                      <Money minor={i.total} currency={i.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd className="text-ink-2 mt-0.5 whitespace-pre-line">{children}</dd>
    </div>
  );
}
