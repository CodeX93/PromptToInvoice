import { NextResponse } from "next/server";
import { hit, RULES } from "@/server/rate-limit";
import { isAppError } from "@/server/errors";
import { answerQuotePublic } from "@/server/services/invoices";
import { loadPublicInvoice } from "@/server/services/public-invoices";

/** Client accepts or declines a quote from the public link (POST form). */
export async function POST(req: Request, ctx: RouteContext<"/i/[token]/answer">) {
  const { token } = await ctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await hit(`answer:${ip}`, RULES.publicInvoice)).allowed)
    return new Response("Too many requests", { status: 429 });
  const found = await loadPublicInvoice(token);
  if (!found || found.detail.invoice.docType !== "quote")
    return new Response("Not found", { status: 404 });
  const answer = (await req.formData()).get("answer") === "accept" ? "accepted" : "declined";
  try {
    await answerQuotePublic(found.detail.invoice.orgId, found.detail.invoice.id, answer);
  } catch (err) {
    if (!isAppError(err)) throw err;
  }
  return NextResponse.redirect(new URL(`/i/${token}?answered=${answer}`, req.url), 303);
}
