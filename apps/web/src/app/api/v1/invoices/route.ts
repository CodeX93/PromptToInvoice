import { apiRoute, parse } from "@/server/api/handler";
import { createInvoiceFromApi } from "@/server/api/operations";
import { apiInvoiceCreate, apiInvoiceList, queryOf } from "@/server/api/schemas";
import { invoiceResource, invoiceSummary } from "@/server/api/serialize";
import { listInvoices } from "@/server/services/invoices";

export const GET = apiRoute(async ({ ctx, req }) => {
  const q = parse(apiInvoiceList, queryOf(req));
  const page = await listInvoices(ctx, {
    filter: q.status,
    clientId: q.client_id,
    q: q.q,
    cursor: q.cursor,
    limit: q.limit,
  });
  return {
    body: { object: "list", data: page.items.map(invoiceSummary), next_cursor: page.nextCursor },
  };
});

/** Creates a draft. Issue it with POST /invoices/{id}/issue. */
export const POST = apiRoute(async ({ ctx, body }) => {
  const detail = await createInvoiceFromApi(ctx, parse(apiInvoiceCreate, body));
  return { status: 201, body: invoiceResource(detail) };
});
