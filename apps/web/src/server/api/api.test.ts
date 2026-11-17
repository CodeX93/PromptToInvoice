import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq, schema } from "@pti/db";
import { dbs, orgContext } from "../../../test/fixtures";
import { createApiKey, revokeApiKey, revokeKeysCreatedBy } from "../services/api-keys";
import type { Poster } from "../net/egress";
import { assertPublicUrl, createEndpoint, deliver, emitEvent, sign } from "../services/webhooks";
import * as invoicesRoute from "@/app/api/v1/invoices/route";
import * as invoiceRoute from "@/app/api/v1/invoices/[id]/route";
import * as issueRoute from "@/app/api/v1/invoices/[id]/issue/route";
import * as clientsRoute from "@/app/api/v1/clients/route";

const BASE = "http://localhost/api/v1";
const noParams = { params: Promise.resolve({}) };
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

function req(
  path: string,
  key: string | null,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(key && { authorization: `Bearer ${key}` }),
      ...(init.body !== undefined && { "content-type": "application/json" }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function enterprise() {
  const o = await orgContext({ plan: "enterprise" });
  const { key, id } = await createApiKey(o.ctx, "CI");
  return { ...o, key, keyId: id };
}

const draft = (clientId: string) => ({
  client_id: clientId,
  currency: "EUR",
  lines: [
    {
      description: "Design",
      quantity: "3",
      unit: "day",
      unit_price: "650",
      tax_category: "S",
      tax_rate: "19",
    },
  ],
});

describe("API authentication", () => {
  it("rejects missing, malformed and revoked keys with problem+json", async () => {
    const { ctx, key, keyId } = await enterprise();
    const missing = await invoicesRoute.GET(req("/invoices", null), noParams);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("content-type")).toBe("application/problem+json");
    expect((await invoicesRoute.GET(req("/invoices", "pti_live_nope"), noParams)).status).toBe(401);
    // Right prefix, wrong secret.
    const forged = key.slice(0, -1) + (key.endsWith("A") ? "B" : "A");
    expect((await invoicesRoute.GET(req("/invoices", forged), noParams)).status).toBe(401);
    await revokeApiKey(ctx, keyId);
    expect((await invoicesRoute.GET(req("/invoices", key), noParams)).status).toBe(401);
  });

  it("refuses keys once the org drops below Enterprise", async () => {
    const { seed, key } = await enterprise();
    await dbs.system
      .update(schema.organizations)
      .set({ plan: "pro" })
      .where(eq(schema.organizations.id, seed.org.id));
    expect((await invoicesRoute.GET(req("/invoices", key), noParams)).status).toBe(403);
  });

  it("keys stop working when the member who created them leaves", async () => {
    const { ctx, key } = await enterprise();
    expect((await invoicesRoute.GET(req("/invoices", key), noParams)).status).toBe(200);
    expect(await revokeKeysCreatedBy(ctx.org.id, ctx.user.id)).toBe(1);
    expect((await invoicesRoute.GET(req("/invoices", key), noParams)).status).toBe(401);
  });

  it("only Enterprise orgs can create keys", async () => {
    const { ctx } = await orgContext({ plan: "business" });
    await expect(createApiKey(ctx, "x")).rejects.toThrow(/Enterprise/);
  });
});

describe("API invoices", () => {
  it("creates a draft with org defaults, issues it and reads it back", async () => {
    const { key, clientId } = await enterprise();
    const created = await invoicesRoute.POST(
      req("/invoices", key, { method: "POST", body: draft(clientId) }),
      noParams,
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("x-ratelimit-limit")).toBe("600");
    const inv = (await created.json()) as {
      id: string;
      status: string;
      total: number;
      number: string | null;
    };
    expect(inv.status).toBe("draft");
    expect(inv.total).toBe(232_050); // 3 × 650 × 1.19 in cents

    const issued = await issueRoute.POST(
      req(`/invoices/${inv.id}/issue`, key, { method: "POST" }),
      withId(inv.id),
    );
    expect(issued.status).toBe(200);
    const after = (await issued.json()) as { number: string | null; status: string };
    expect(after.number).toBeTruthy();

    const got = await invoiceRoute.GET(req(`/invoices/${inv.id}`, key), withId(inv.id));
    expect(((await got.json()) as { number: string }).number).toBe(after.number);

    const list = (await (
      await invoicesRoute.GET(req("/invoices?status=outstanding", key), noParams)
    ).json()) as {
      data: { id: string }[];
    };
    expect(list.data.map((d) => d.id)).toContain(inv.id);
  });

  it("returns 422 with field errors for invalid bodies, 404 for bad ids", async () => {
    const { key } = await enterprise();
    const bad = await invoicesRoute.POST(
      req("/invoices", key, { method: "POST", body: { lines: [] } }),
      noParams,
    );
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { errors: Record<string, string[]> }).errors.lines).toBeDefined();
    expect(
      (await invoiceRoute.GET(req("/invoices/not-a-uuid", key), withId("not-a-uuid"))).status,
    ).toBe(404);
    const nonJson = await invoicesRoute.POST(
      new Request(`${BASE}/invoices`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: "{",
      }),
      noParams,
    );
    expect(nonJson.status).toBe(400);
  });

  it("cannot see another organisation's invoices", async () => {
    const a = await enterprise();
    const b = await enterprise();
    const res = await invoicesRoute.POST(
      req("/invoices", a.key, { method: "POST", body: draft(a.clientId) }),
      noParams,
    );
    const { id } = (await res.json()) as { id: string };
    expect((await invoiceRoute.GET(req(`/invoices/${id}`, b.key), withId(id))).status).toBe(404);
  });
});

describe("API idempotency", () => {
  it("replays the first response and rejects key reuse with a different body", async () => {
    const { key, clientId } = await enterprise();
    const headers = { "idempotency-key": "order-4711-create" };
    const first = await invoicesRoute.POST(
      req("/invoices", key, { method: "POST", body: draft(clientId), headers }),
      noParams,
    );
    const second = await invoicesRoute.POST(
      req("/invoices", key, { method: "POST", body: draft(clientId), headers }),
      noParams,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    const [a, b] = (await Promise.all([first.json(), second.json()])) as { id: string }[];
    expect(b?.id).toBe(a?.id);

    const changed = { ...draft(clientId), reference: "different" };
    const third = await invoicesRoute.POST(
      req("/invoices", key, { method: "POST", body: changed, headers }),
      noParams,
    );
    expect(third.status).toBe(422);
  });

  it("validates the key format", async () => {
    const { key, clientId } = await enterprise();
    const res = await invoicesRoute.POST(
      req("/invoices", key, {
        method: "POST",
        body: draft(clientId),
        headers: { "idempotency-key": "short" },
      }),
      noParams,
    );
    expect(res.status).toBe(400);
  });
});

describe("API clients", () => {
  it("creates and lists clients", async () => {
    const { key } = await enterprise();
    const res = await clientsRoute.POST(
      req("/clients", key, {
        method: "POST",
        body: {
          name: "Globex SARL",
          emails: ["billing@globex.test"],
          address: { line1: "1 Rue", city: "Paris", country: "fr" },
        },
      }),
      noParams,
    );
    expect(res.status).toBe(201);
    const c = (await res.json()) as { id: string; address: { country: string } };
    expect(c.address.country).toBe("FR");
    const list = (await (
      await clientsRoute.GET(req("/clients?q=globex", key), noParams)
    ).json()) as { data: { id: string }[] };
    expect(list.data.map((x) => x.id)).toEqual([c.id]);
  });
});

describe("webhooks", () => {
  it("rejects non-https, credentials and private targets", async () => {
    await expect(assertPublicUrl("http://93.184.215.14/x")).rejects.toThrow(/https/);
    await expect(assertPublicUrl("https://u:p@93.184.215.14/x")).rejects.toThrow(/Credentials/);
    await expect(assertPublicUrl("https://169.254.169.254/latest")).rejects.toThrow(/public/);
    await expect(assertPublicUrl("https://[::1]/x")).rejects.toThrow(/public/);
    await expect(assertPublicUrl("https://93.184.215.14/x")).resolves.toBeInstanceOf(URL);
  });

  it("signs like Stripe: t=<unix>,v1=hmac(t.body)", () => {
    const sig = sign("whsec_abc", '{"a":1}', 1_700_000_000);
    const expected = createHmac("sha256", "whsec_abc").update('1700000000.{"a":1}').digest("hex");
    expect(sig).toBe(`t=1700000000,v1=${expected}`);
  });

  it("delivers a signed event, records the outcome and retries on failure", async () => {
    const { ctx } = await enterprise();
    const { id: endpointId, secret } = await createEndpoint(ctx, {
      url: "https://93.184.215.14/hooks",
      events: ["invoice.paid"],
    });
    await emitEvent(ctx.org.id, "invoice.paid", { id: "inv_1" });
    await emitEvent(ctx.org.id, "invoice.sent", { id: "inv_1" }); // not subscribed
    const rows = await dbs.system
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.endpointId, endpointId));
    expect(rows).toHaveLength(1);
    const deliveryId = rows[0]!.id;

    // First attempt: receiver is down → throws so the queue retries.
    const failing: Poster = () => Promise.resolve({ status: 503 });
    await expect(deliver(deliveryId, failing)).rejects.toThrow();
    let [row] = await dbs.system
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, deliveryId));
    expect(row).toMatchObject({ attempts: 1, status: "pending", responseStatus: 503 });

    // Second attempt succeeds; verify the receiver-side signature check.
    let seen: { headers: Headers; body: string } | null = null;
    const ok: Poster = (_url, init) => {
      seen = { headers: new Headers(init.headers), body: init.body };
      return Promise.resolve({ status: 200 });
    };
    await deliver(deliveryId, ok);
    [row] = await dbs.system
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, deliveryId));
    expect(row).toMatchObject({ attempts: 2, status: "delivered" });
    const got = seen as unknown as { headers: Headers; body: string };
    const header = got.headers.get("pti-signature") ?? "";
    const t = Number(/t=(\d+)/.exec(header)?.[1]);
    expect(header).toBe(sign(secret, got.body, t));
    expect(JSON.parse(got.body)).toMatchObject({ type: "invoice.paid", data: { id: "inv_1" } });

    // Delivered events are never re-sent.
    const spy: Poster = () => Promise.reject(new Error("should not be called"));
    await deliver(deliveryId, spy);
  });
});
