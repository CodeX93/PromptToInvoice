import { apiRoute, idParam } from "@/server/api/handler";
import { pdfFor } from "@/server/documents/service";

/** The archived PDF/A-3 (with embedded Factur-X XML on plans that include e-invoicing). */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => {
  const { pdf, fileName } = await pdfFor(ctx, idParam(params.id, "Invoice"));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(pdf.length),
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "private, no-store",
    },
  });
});
