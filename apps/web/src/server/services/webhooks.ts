import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import {
  and,
  arrayContains,
  eq,
  schema,
  sql,
  withOrg,
  WEBHOOK_EVENTS,
  type WebhookEventType,
} from "@pti/db";
import { db, sysDb } from "../db";
import { audit } from "../audit";
import { decrypt, encrypt } from "../crypto";
import { ValidationError } from "../errors";
import { logger } from "../logger";
import { authorize, type OrgContext } from "../session";
import { enqueue } from "../jobs/queue";

const MAX_ATTEMPTS = 8;
const DISABLE_AFTER_FAILURES = 50;

/** Block private, loopback, link-local and metadata ranges (SSRF). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (
      v === "::1" ||
      v === "::" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe80")
    )
      return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped?.[1] ? isPrivateAddress(mapped[1]) : false;
  }
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ValidationError("Enter a valid URL.", { url: ["Invalid URL."] });
  }
  if (u.protocol !== "https:")
    throw new ValidationError("Webhook URLs must use https.", { url: ["Use https://"] });
  if (u.username || u.password)
    throw new ValidationError("Credentials in URLs aren't allowed.", {
      url: ["Remove user:pass@"],
    });
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0)
    throw new ValidationError("That host doesn't resolve.", { url: ["Unknown host."] });
  if (addrs.some((a) => isPrivateAddress(a.address)))
    throw new ValidationError("Webhook URLs must point to a public address.", {
      url: ["Private address."],
    });
  return u;
}

export const endpointSchema = z.object({
  url: z.string().trim().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event."),
});

const aad = (id: string) => `webhook:${id}`;

export async function createEndpoint(
  ctx: OrgContext,
  input: z.infer<typeof endpointSchema>,
): Promise<{ id: string; secret: string }> {
  authorize(ctx, "apikey:manage");
  const url = await assertPublicUrl(input.url);
  const id = crypto.randomUUID();
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx
      .insert(schema.webhookEndpoints)
      .values({
        id,
        orgId: ctx.org.id,
        url: url.toString(),
        events: input.events,
        secretEncrypted: encrypt(secret, aad(id)),
      });
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "webhook.created",
      entityType: "webhook_endpoint",
      entityId: id,
      diff: { url: url.toString(), events: input.events },
    });
  });
  return { id, secret };
}

export async function deleteEndpoint(ctx: OrgContext, id: string): Promise<void> {
  authorize(ctx, "apikey:manage");
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, id));
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "webhook.deleted",
      entityType: "webhook_endpoint",
      entityId: id,
    });
  });
}

export async function listEndpoints(ctx: OrgContext) {
  authorize(ctx, "apikey:manage");
  return withOrg(db, ctx.org.id, async (tx) => {
    const endpoints = await tx
      .select({
        id: schema.webhookEndpoints.id,
        url: schema.webhookEndpoints.url,
        events: schema.webhookEndpoints.events,
        active: schema.webhookEndpoints.active,
        failureCount: schema.webhookEndpoints.failureCount,
      })
      .from(schema.webhookEndpoints);
    const recent = await tx.execute<{
      endpoint_id: string;
      type: string;
      status: string;
      response_status: number | null;
      created_at: string;
    }>(sql`
      select endpoint_id, type, status, response_status, created_at::text from webhook_deliveries order by created_at desc limit 20
    `);
    return { endpoints, recent };
  });
}

/**
 * Fan an event out to subscribed endpoints. One delivery row per
 * (endpoint, event) — the unique index makes re-emission a no-op.
 * Never throws: webhooks must not break the business action that emitted them.
 */
export async function emitEvent(
  orgId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const endpoints = await sysDb
      .select({ id: schema.webhookEndpoints.id })
      .from(schema.webhookEndpoints)
      .where(
        and(
          eq(schema.webhookEndpoints.orgId, orgId),
          eq(schema.webhookEndpoints.active, true),
          arrayContains(schema.webhookEndpoints.events, [type]),
        ),
      );
    if (endpoints.length === 0) return;
    const eventId = crypto.randomUUID();
    const payload = { id: eventId, type, created: new Date().toISOString(), data };
    const rows = await sysDb
      .insert(schema.webhookDeliveries)
      .values(endpoints.map((e) => ({ orgId, endpointId: e.id, eventId, type, payload })))
      .onConflictDoNothing()
      .returning({ id: schema.webhookDeliveries.id });
    for (const r of rows)
      await enqueue("webhook.deliver", { deliveryId: r.id }, { singletonKey: r.id });
  } catch (err) {
    logger.error({ err, orgId, type }, "webhook emit failed");
  }
}

/** Stripe-style signature: `t=<unix>,v1=<hex hmac of "t.body">`. */
export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Worker: POST one delivery. Throws on failure so the queue retries with backoff. */
export async function deliver(deliveryId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const [d] = await sysDb
    .select({
      d: schema.webhookDeliveries,
      url: schema.webhookEndpoints.url,
      secret: schema.webhookEndpoints.secretEncrypted,
      endpointId: schema.webhookEndpoints.id,
      active: schema.webhookEndpoints.active,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(
      schema.webhookEndpoints,
      eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId),
    )
    .where(eq(schema.webhookDeliveries.id, deliveryId));
  if (!d || d.d.status === "delivered" || !d.active) return;
  const body = JSON.stringify(d.d.payload);
  const attempts = d.d.attempts + 1;
  let status: number | null = null;
  let error: string | null = null;
  try {
    await assertPublicUrl(d.url); // re-check at send time (DNS may have changed)
    const res = await fetchImpl(d.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "PromptToInvoice-Webhooks/1",
        "PTI-Signature": sign(decrypt(d.secret, aad(d.endpointId)), body),
        "PTI-Event": d.d.type,
        "PTI-Delivery": deliveryId,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 300) : "request failed";
  }
  const ok = error === null;
  const finalFailure = !ok && attempts >= MAX_ATTEMPTS;
  await sysDb.transaction(async (tx) => {
    await tx
      .update(schema.webhookDeliveries)
      .set({
        attempts,
        responseStatus: status,
        error,
        status: ok ? "delivered" : finalFailure ? "failed" : "pending",
        deliveredAt: ok ? new Date() : null,
      })
      .where(eq(schema.webhookDeliveries.id, deliveryId));
    await tx
      .update(schema.webhookEndpoints)
      .set(
        ok
          ? { failureCount: 0 }
          : {
              failureCount: sql`${schema.webhookEndpoints.failureCount} + 1`,
              active: sql`${schema.webhookEndpoints.failureCount} + 1 < ${DISABLE_AFTER_FAILURES}`,
            },
      )
      .where(eq(schema.webhookEndpoints.id, d.endpointId));
  });
  if (!ok && !finalFailure) throw new Error(`webhook delivery failed: ${error ?? "unknown"}`);
}
