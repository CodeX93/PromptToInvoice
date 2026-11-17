import { apiRoute, parse } from "@/server/api/handler";
import { apiDraftCreate } from "@/server/api/schemas";
import { invoiceResource } from "@/server/api/serialize";
import { createAiDraft } from "@/server/services/ai-drafts";
import { getInvoice } from "@/server/services/invoices";

/**
 * Plain language in, editable draft invoice out. Counts against the AI
 * quota like the prompt bar does. Nothing is issued or sent.
 */
export const POST = apiRoute(async ({ ctx, body }) => {
  const { prompt } = parse(apiDraftCreate, body);
  const r = await createAiDraft(ctx, prompt);
  return {
    status: 201,
    body: {
      ai_draft_id: r.aiDraftId,
      invoice: invoiceResource(await getInvoice(ctx, r.invoiceId)),
    },
  };
});
