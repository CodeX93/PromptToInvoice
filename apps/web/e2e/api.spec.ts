import { expect, test } from "@playwright/test";

test("OpenAPI document is public and describes the API", async ({ request, baseURL }) => {
  const res = await request.get("/api/v1/openapi.json");
  expect(res.status()).toBe(200);
  const doc = (await res.json()) as { openapi: string; servers: { url: string }[]; paths: object };
  expect(doc.openapi).toBe("3.1.0");
  expect(doc.servers[0]?.url).toBe(`${baseURL}/api/v1`);
  expect(Object.keys(doc.paths)).toContain("/invoices/{id}/issue");
});

test("API rejects requests without a key as problem+json", async ({ request }) => {
  const res = await request.get("/api/v1/invoices");
  expect(res.status()).toBe(401);
  expect(res.headers()["content-type"]).toBe("application/problem+json");
});

test("health probes", async ({ request }) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  const ready = await request.get("/api/health?ready=1");
  expect(ready.status()).toBe(200);
  expect(((await ready.json()) as { status: string }).status).toBe("ok");
});
