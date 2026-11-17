import { apiRoute, idParam, parse } from "@/server/api/handler";
import { apiSend } from "@/server/api/schemas";
import { ValidationError } from "@/server/errors";
import { queueInvoiceEmail } from "@/server/services/emails";
import { getInvoice } from "@/server/services/invoices";

/** Queues the email (PDF attached, pay link included). Delivery is asynchronous: listen for invoice.sent. */
export const POST = apiRoute<{ id: string }>(async ({ ctx, params, body }) => {
  const id = idParam(params.id, "Invoice");
  const b = parse(apiSend, body);
  const to = b.to ?? (await getInvoice(ctx, id)).client?.emails ?? [];
  if (!to.length)
    throw new ValidationError("The client has no email address; pass `to`.", {
      to: ["Required."],
    });
  const { emailId } = await queueInvoiceEmail(ctx, id, { to, cc: b.cc, message: b.message });
  return { status: 202, body: { object: "email", id: emailId, invoice_id: id, status: "queued" } };
});
