import { NextResponse } from "next/server";
import { isAppError } from "@/server/errors";
import { hit, RULES } from "@/server/rate-limit";
import { checkoutForToken } from "@/server/services/stripe";

/** "Pay now" on the public invoice page → Stripe Checkout on the business's account. POST only. */
export async function POST(req: Request, ctx: RouteContext<"/i/[token]/pay">) {
  const { token } = await ctx.params;
  if (!/^[\w-]{20,40}$/.test(token)) return new Response("Not found", { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await hit(`pay:${ip}`, RULES.publicInvoice)).allowed)
    return new Response("Too many requests", { status: 429 });
  try {
    return NextResponse.redirect(await checkoutForToken(token), 303);
  } catch (err) {
    if (isAppError(err))
      return NextResponse.redirect(
        new URL(`/i/${token}?error=${encodeURIComponent(err.code)}`, req.url),
        303,
      );
    throw err;
  }
}
