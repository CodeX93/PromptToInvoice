import { features } from "@/server/env";
import { logger } from "@/server/logger";
import { handleStripeEvent, verifyWebhook } from "@/server/services/stripe";

/**
 * Stripe webhooks (platform + Connect). The raw body is required for
 * signature verification. 2xx only after the event is durably applied;
 * failures return 500 so Stripe retries.
 */
export async function POST(req: Request) {
  if (!features.stripe) return new Response("Stripe not configured", { status: 404 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const payload = await req.text();
  let event;
  try {
    event = verifyWebhook(payload, signature);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  try {
    const applied = await handleStripeEvent(event);
    return Response.json({ received: true, duplicate: !applied });
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, "stripe webhook failed");
    return new Response("Processing failed", { status: 500 });
  }
}
