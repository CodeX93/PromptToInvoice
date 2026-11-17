import { apiRoute, idParam } from "@/server/api/handler";
import { invoiceResource } from "@/server/api/serialize";
import { getInvoice, issueInvoice } from "@/server/services/invoices";

/** Assigns the next number and freezes the document. Irreversible; correct with a credit note. */
export const POST = apiRoute<{ id: string }>(async ({ ctx, params }) => {
  const id = idParam(params.id, "Invoice");
  await issueInvoice(ctx, id);
  return { body: invoiceResource(await getInvoice(ctx, id)) };
});
