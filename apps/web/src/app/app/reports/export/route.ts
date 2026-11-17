import { fromMinor, todayIn } from "@pti/core";
import { and, asc, eq, gte, lte, schema, sql, withOrg } from "@pti/db";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { authorize, orgContextOrThrow } from "@/server/session";
import { revenueByClient, revenueByMonth, taxReport } from "@/server/services/reports";
import { resolvePeriod } from "@/lib/periods";
import { toCsv, type Cell } from "@/lib/csv";

/** CSV exports for accountants: invoices, VAT summary, revenue by month, revenue by client. */
export async function GET(req: Request) {
  try {
    const ctx = await orgContextOrThrow();
    authorize(ctx, "export:run");
    const u = new URL(req.url).searchParams;
    const { from, to } = resolvePeriod(
      todayIn(ctx.org.timeZone),
      u.get("period") ?? undefined,
      u.get("from") ?? undefined,
      u.get("to") ?? undefined,
    );
    const report = u.get("report") ?? "invoices";
    let header: string[];
    let rows: Cell[][];
    switch (report) {
      case "tax": {
        const r = await taxReport(ctx, from, to);
        header = ["currency", "category", "rate_percent", "taxable", "tax", "documents"];
        rows = r.map((x) => [
          x.currency,
          x.category,
          x.rate,
          fromMinor(x.taxable, x.currency),
          fromMinor(x.tax, x.currency),
          x.documents,
        ]);
        break;
      }
      case "revenue": {
        const r = await revenueByMonth(ctx, from, to);
        header = ["month", "currency", "invoiced", "credited", "collected"];
        rows = r.map((x) => [
          x.month,
          x.currency,
          fromMinor(x.invoiced, x.currency),
          fromMinor(x.credited, x.currency),
          fromMinor(x.collected, x.currency),
        ]);
        break;
      }
      case "clients": {
        const r = await revenueByClient(ctx, from, to);
        header = ["client", "currency", "invoiced", "collected", "outstanding", "avg_days_to_pay"];
        rows = r.map((x) => [
          x.name,
          x.currency,
          fromMinor(x.invoiced, x.currency),
          fromMinor(x.collected, x.currency),
          fromMinor(x.outstanding, x.currency),
          x.avgDaysToPay,
        ]);
        break;
      }
      default: {
        const I = schema.invoices;
        const r = await withOrg(db, ctx.org.id, (tx) =>
          tx
            .select({ i: I, client: schema.clients.name, clientVat: schema.clients.vatId })
            .from(I)
            .leftJoin(schema.clients, eq(schema.clients.id, I.clientId))
            .where(and(sql`${I.status} <> 'draft'`, gte(I.issueDate, from), lte(I.issueDate, to)))
            .orderBy(asc(I.issueDate), asc(I.number)),
        );
        header = [
          "number",
          "type",
          "status",
          "issue_date",
          "due_date",
          "client",
          "client_vat_id",
          "currency",
          "net",
          "tax",
          "total",
          "paid",
          "credited",
          "reference",
        ];
        rows = r.map(({ i, client, clientVat }) => {
          const c = i.currency as Parameters<typeof fromMinor>[1];
          return [
            i.number,
            i.docType,
            i.status,
            i.issueDate,
            i.dueDate,
            client,
            clientVat,
            i.currency,
            fromMinor(i.taxExclusive, c),
            fromMinor(i.taxTotal, c),
            fromMinor(i.total, c),
            fromMinor(i.amountPaid, c),
            fromMinor(i.creditedAmount, c),
            i.reference,
          ];
        });
      }
    }
    const name = `${report}-${from}-to-${to}.csv`;
    return new Response(toCsv(header, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (isAppError(err)) return new Response(err.message, { status: err.status });
    throw err;
  }
}
