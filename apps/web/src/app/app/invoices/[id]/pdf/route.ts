import { isAppError } from "@/server/errors";
import { orgContextOrThrow, authorize } from "@/server/session";
import { pdfFor } from "@/server/documents/service";

export async function GET(req: Request, ctx: RouteContext<"/app/invoices/[id]/pdf">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    const org = await orgContextOrThrow();
    authorize(org, "invoice:read");
    const { pdf, fileName } = await pdfFor(org, id);
    const inline = new URL(req.url).searchParams.get("download") === null;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (isAppError(err)) return new Response(err.message, { status: err.status });
    throw err;
  }
}
