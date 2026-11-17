import { and, eq, schema } from "@pti/db";
import { sysDb } from "@/server/db";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { logger } from "@/server/logger";

/**
 * Postmark delivery events → email_messages status, and bounces onto the
 * invoice timeline. Postmark authenticates with HTTP basic auth configured
 * on the webhook URL; the password is POSTMARK_WEBHOOK_SECRET.
 */
type PostmarkEvent = {
  RecordType: "Delivery" | "Bounce" | "SpamComplaint" | "Open";
  MessageID: string;
  Description?: string;
  Email?: string;
  Recipient?: string;
};

const STATUS = {
  Delivery: "delivered",
  Bounce: "bounced",
  SpamComplaint: "complained",
  Open: "opened",
} as const;

export async function POST(req: Request) {
  if (!env.POSTMARK_WEBHOOK_SECRET) return new Response("Not configured", { status: 404 });
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Basic ${Buffer.from(`postmark:${env.POSTMARK_WEBHOOK_SECRET}`).toString("base64")}`;
  if (!safeEqual(auth, expected)) return new Response("Unauthorized", { status: 401 });

  const e = (await req.json()) as PostmarkEvent;
  const status = STATUS[e.RecordType] as (typeof STATUS)[keyof typeof STATUS] | undefined;
  if (!status || !e.MessageID) return Response.json({ ignored: true });

  const [msg] = await sysDb
    .update(schema.emailMessages)
    .set({
      status,
      error: e.RecordType === "Bounce" ? (e.Description ?? "Bounced").slice(0, 500) : null,
    })
    .where(
      and(
        eq(schema.emailMessages.provider, "postmark"),
        eq(schema.emailMessages.providerMessageId, e.MessageID),
      ),
    )
    .returning({ orgId: schema.emailMessages.orgId, invoiceId: schema.emailMessages.invoiceId });
  if (msg?.invoiceId && (e.RecordType === "Bounce" || e.RecordType === "SpamComplaint")) {
    await sysDb
      .insert(schema.invoiceEvents)
      .values({
        orgId: msg.orgId,
        invoiceId: msg.invoiceId,
        type: "email_bounced",
        data: { recipient: e.Email ?? e.Recipient ?? null, reason: e.Description ?? e.RecordType },
      });
    logger.warn({ invoiceId: msg.invoiceId, type: e.RecordType }, "invoice email not delivered");
  }
  return Response.json({ ok: true });
}
