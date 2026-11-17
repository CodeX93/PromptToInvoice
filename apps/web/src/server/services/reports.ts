import "server-only";
import { addDays, addMonths, isCurrencyCode, todayIn, type CurrencyCode } from "@pti/core";
import { sql, withOrg } from "@pti/db";
import { db } from "../db";
import { authorize, type OrgContext } from "../session";

const cur = (c: string): CurrencyCode => (isCurrencyCode(c) ? c : "EUR");

export interface CurrencyKpis {
  currency: CurrencyCode;
  outstanding: number;
  overdue: number;
  overdueCount: number;
  invoicedThisMonth: number;
  invoicedLastMonth: number;
  collected30d: number;
}

export interface Overview {
  today: string;
  kpis: CurrencyKpis[];
  aging: { bucket: "current" | "1-30" | "31-60" | "61-90" | "90+"; amount: number; count: number }[];
  agingCurrency: CurrencyCode | null;
  collectedByMonth: { month: string; amount: number }[];
  topClients: { id: string; name: string; outstanding: number; currency: CurrencyCode }[];
  activity: { invoiceId: string; number: string | null; client: string | null; type: string; at: Date }[];
  drafts: number;
}

/** Everything the overview needs, aggregated in Postgres within one tenant transaction. */
export async function overview(ctx: OrgContext, primaryCurrency: CurrencyCode): Promise<Overview> {
  authorize(ctx, "report:read");
  const today = todayIn(ctx.org.timeZone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthStart = addMonths(monthStart, -1);
  const yearAgo = addMonths(monthStart, -11);
  const d30 = addDays(today, -30);

  return withOrg(db, ctx.org.id, async (tx) => {
    const kpis = await tx.execute<{ currency: string; outstanding: number; overdue: number; overdue_count: number; this_month: number; last_month: number; collected: number }>(sql`
      with inv as (
        select currency, status, due_date, issue_date, total, total - amount_paid - credited_amount as due
        from invoices where doc_type = 'invoice' and status in ('open','paid')
      )
      select c.currency,
        coalesce((select sum(due) from inv where currency = c.currency and status = 'open'), 0)::bigint as outstanding,
        coalesce((select sum(due) from inv where currency = c.currency and status = 'open' and due_date < ${today}), 0)::bigint as overdue,
        (select count(*) from inv where currency = c.currency and status = 'open' and due_date < ${today})::int as overdue_count,
        coalesce((select sum(total) from inv where currency = c.currency and issue_date >= ${monthStart}), 0)::bigint as this_month,
        coalesce((select sum(total) from inv where currency = c.currency and issue_date >= ${lastMonthStart} and issue_date < ${monthStart}), 0)::bigint as last_month,
        coalesce((select sum(amount - refunded_amount) from payments where currency = c.currency and received_on >= ${d30}), 0)::bigint as collected
      from (select distinct currency from invoices where status <> 'draft' union select ${primaryCurrency}) c
    `);

    const aging = await tx.execute<{ bucket: Overview["aging"][number]["bucket"]; amount: number; count: number }>(sql`
      select bucket, sum(due)::bigint as amount, count(*)::int as count from (
        select total - amount_paid - credited_amount as due,
          case
            when due_date is null or due_date >= ${today} then 'current'
            when ${today}::date - due_date <= 30 then '1-30'
            when ${today}::date - due_date <= 60 then '31-60'
            when ${today}::date - due_date <= 90 then '61-90'
            else '90+'
          end as bucket
        from invoices where status = 'open' and doc_type = 'invoice' and currency = ${primaryCurrency}
      ) x group by bucket
    `);

    const monthly = await tx.execute<{ month: string; amount: number }>(sql`
      select to_char(m, 'YYYY-MM') as month, coalesce(sum(p.amount - p.refunded_amount), 0)::bigint as amount
      from generate_series(${yearAgo}::date, ${monthStart}::date, interval '1 month') m
      left join payments p on p.currency = ${primaryCurrency} and date_trunc('month', p.received_on) = m
      group by m order by m
    `);

    const top = await tx.execute<{ id: string; name: string; outstanding: number; currency: string }>(sql`
      select c.id, c.name, sum(i.total - i.amount_paid - i.credited_amount)::bigint as outstanding, i.currency
      from invoices i join clients c on c.id = i.client_id
      where i.status = 'open' and i.doc_type = 'invoice'
      group by c.id, c.name, i.currency
      order by outstanding desc limit 5
    `);

    const activity = await tx.execute<{ invoice_id: string; number: string | null; client: string | null; type: string; at: string }>(sql`
      select e.invoice_id, i.number, c.name as client, e.type, e.created_at as at
      from invoice_events e join invoices i on i.id = e.invoice_id left join clients c on c.id = i.client_id
      where e.type in ('issued','sent','viewed','paid','payment_recorded','voided','email_bounced','reminder_sent')
      order by e.created_at desc limit 12
    `);

    const [drafts] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from invoices where status = 'draft'`);

    const order = ["current", "1-30", "31-60", "61-90", "90+"] as const;
    return {
      today,
      kpis: kpis
        .map((k) => ({ currency: cur(k.currency), outstanding: Number(k.outstanding), overdue: Number(k.overdue), overdueCount: k.overdue_count, invoicedThisMonth: Number(k.this_month), invoicedLastMonth: Number(k.last_month), collected30d: Number(k.collected) }))
        .sort((a, b) => (a.currency === primaryCurrency ? -1 : b.currency === primaryCurrency ? 1 : b.outstanding - a.outstanding)),
      aging: order.map((b) => {
        const r = aging.find((x) => x.bucket === b);
        return { bucket: b, amount: Number(r?.amount ?? 0), count: r?.count ?? 0 };
      }),
      agingCurrency: primaryCurrency,
      collectedByMonth: monthly.map((m) => ({ month: m.month, amount: Number(m.amount) })),
      topClients: top.map((t) => ({ id: t.id, name: t.name, outstanding: Number(t.outstanding), currency: cur(t.currency) })),
      // Raw execute() returns timestamptz as strings; normalise to Date at the boundary.
      activity: activity.map((a) => ({ invoiceId: a.invoice_id, number: a.number, client: a.client, type: a.type, at: new Date(a.at) })),
      drafts: drafts?.n ?? 0,
    };
  });
}

export interface TaxReportRow {
  currency: CurrencyCode;
  category: string;
  rate: string;
  taxable: number;
  tax: number;
  documents: number;
}

/**
 * VAT/sales tax summary for a period, from the frozen per-invoice breakdown
 * (credit notes net off automatically as negative amounts). This is the
 * table you hand to your accountant or copy into a VAT return.
 */
export async function taxReport(ctx: OrgContext, from: string, to: string): Promise<TaxReportRow[]> {
  authorize(ctx, "report:read");
  const rows = await withOrg(db, ctx.org.id, (tx) =>
    tx.execute<{ currency: string; category: string; rate: string; taxable: number; tax: number; docs: number }>(sql`
      select i.currency, b->>'category' as category, b->>'rate' as rate,
        sum((b->>'taxable')::bigint)::bigint as taxable, sum((b->>'tax')::bigint)::bigint as tax, count(distinct i.id)::int as docs
      from invoices i, jsonb_array_elements(i.tax_breakdown) b
      where i.status <> 'draft' and i.issue_date between ${from} and ${to}
      group by 1, 2, 3 order by 1, 2, (b->>'rate')::numeric desc
    `),
  );
  return rows.map((r) => ({ currency: cur(r.currency), category: r.category, rate: r.rate, taxable: Number(r.taxable), tax: Number(r.tax), documents: r.docs }));
}

export interface RevenueRow {
  month: string;
  currency: CurrencyCode;
  invoiced: number;
  credited: number;
  collected: number;
}

export async function revenueByMonth(ctx: OrgContext, from: string, to: string): Promise<RevenueRow[]> {
  authorize(ctx, "report:read");
  const rows = await withOrg(db, ctx.org.id, (tx) =>
    tx.execute<{ month: string; currency: string; invoiced: number; credited: number; collected: number }>(sql`
      with months as (select to_char(m, 'YYYY-MM') as month from generate_series(date_trunc('month', ${from}::date), ${to}::date, interval '1 month') m),
      inv as (
        select to_char(issue_date, 'YYYY-MM') as month, currency,
          sum(total) filter (where doc_type = 'invoice') as invoiced,
          -sum(total) filter (where doc_type = 'credit_note') as credited
        from invoices where status <> 'draft' and issue_date between ${from} and ${to} group by 1, 2
      ),
      pay as (
        select to_char(received_on, 'YYYY-MM') as month, currency, sum(amount - refunded_amount) as collected
        from payments where received_on between ${from} and ${to} group by 1, 2
      )
      select m.month, c.currency, coalesce(inv.invoiced, 0)::bigint as invoiced, coalesce(inv.credited, 0)::bigint as credited, coalesce(pay.collected, 0)::bigint as collected
      from months m
      cross join (select currency from inv union select currency from pay) c
      left join inv on inv.month = m.month and inv.currency = c.currency
      left join pay on pay.month = m.month and pay.currency = c.currency
      order by m.month, c.currency
    `),
  );
  return rows.map((r) => ({ month: r.month, currency: cur(r.currency), invoiced: Number(r.invoiced), credited: Number(r.credited), collected: Number(r.collected) }));
}

export interface ClientRevenueRow {
  clientId: string;
  name: string;
  currency: CurrencyCode;
  invoiced: number;
  collected: number;
  outstanding: number;
  avgDaysToPay: number | null;
}

/** Revenue and payment behaviour per client — who pays, and how fast. */
export async function revenueByClient(ctx: OrgContext, from: string, to: string): Promise<ClientRevenueRow[]> {
  authorize(ctx, "report:read");
  const rows = await withOrg(db, ctx.org.id, (tx) =>
    tx.execute<{ id: string; name: string; currency: string; invoiced: number; collected: number; outstanding: number; days: number | null }>(sql`
      select c.id, c.name, i.currency,
        sum(i.total) filter (where i.doc_type = 'invoice')::bigint as invoiced,
        sum(i.amount_paid)::bigint as collected,
        sum(i.total - i.amount_paid - i.credited_amount) filter (where i.status = 'open' and i.doc_type = 'invoice')::bigint as outstanding,
        round(avg(extract(epoch from (i.paid_at - i.issued_at)) / 86400) filter (where i.paid_at is not null))::int as days
      from invoices i join clients c on c.id = i.client_id
      where i.status <> 'draft' and i.issue_date between ${from} and ${to}
      group by c.id, c.name, i.currency
      order by invoiced desc nulls last
    `),
  );
  return rows.map((r) => ({ clientId: r.id, name: r.name, currency: cur(r.currency), invoiced: Number(r.invoiced ?? 0), collected: Number(r.collected ?? 0), outstanding: Number(r.outstanding ?? 0), avgDaysToPay: r.days }));
}
