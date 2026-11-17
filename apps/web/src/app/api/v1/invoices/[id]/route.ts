import { apiRoute, idParam } from "@/server/api/handler";
import { invoiceResource } from "@/server/api/serialize";
import { getInvoice } from "@/server/services/invoices";

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => ({
  body: invoiceResource(await getInvoice(ctx, idParam(params.id, "Invoice"))),
}));
