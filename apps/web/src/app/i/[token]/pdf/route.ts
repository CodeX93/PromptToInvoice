import { hit, RULES } from "@/server/rate-limit";
import { loadPublicInvoice } from "@/server/services/public-invoices";
import { pdfFor } from "@/server/documents/service";

export async function GET(req: Request, ctx: RouteContext<"/i/[token]/pdf">) {
  const { token } = await ctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await hit(`pub:${ip}`, RULES.publicInvoice)).allowed)
    return new Response("Too many requests", { status: 429 });
  const found = await loadPublicInvoice(token);
  if (!found) return new Response("Not found", { status: 404 });
  const { pdf, fileName } = await pdfFor(found.ctx, found.detail.invoice.id);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
