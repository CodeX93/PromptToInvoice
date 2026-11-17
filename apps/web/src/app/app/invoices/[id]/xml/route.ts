import { hasFeature } from "@pti/core";
import { isAppError } from "@/server/errors";
import { authorize, orgContextOrThrow } from "@/server/session";
import { getInvoice } from "@/server/services/invoices";
import { einvoiceXml } from "@/server/documents/einvoice";

/** Download the structured invoice: ?format=xrechnung (Germany, public sector) or cii (EN 16931). */
export async function GET(req: Request, ctx: RouteContext<"/app/invoices/[id]/xml">) {
  const { id } = await ctx.params;
  try {
    const org = await orgContextOrThrow();
    authorize(org, "invoice:read");
    if (!hasFeature(org.org.plan, "einvoice"))
      return new Response("E-invoices are part of the Professional plan.", { status: 402 });
    const d = await getInvoice(org, id);
    if (d.invoice.status === "draft")
      return new Response("Issue the invoice first.", { status: 409 });
    const format =
      new URL(req.url).searchParams.get("format") === "xrechnung" ? "xrechnung" : "en16931";
    const xml = einvoiceXml(d, format);
    if (!xml)
      return new Response("Add your VAT number or tax ID in Settings to create e-invoices.", {
        status: 422,
      });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${(d.invoice.number ?? "invoice").replace(/[^\w.-]/g, "_")}-${format === "xrechnung" ? "xrechnung" : "en16931"}.xml"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (isAppError(err)) return new Response(err.message, { status: err.status });
    throw err;
  }
}
