import { expect, test, watchErrors } from "./helpers";

for (const path of ["/", "/legal/terms", "/legal/privacy"]) {
  test(`${path} renders without errors or horizontal scroll`, async ({ page }) => {
    const assertNoErrors = watchErrors(page);
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

test("security headers are sent", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[\w=+/-]+' 'strict-dynamic'/,
  );
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("pricing ledger lists every plan", async ({ page }) => {
  await page.goto("/#pricing");
  for (const plan of ["Starter", "Professional", "Business", "Enterprise"])
    await expect(page.getByRole("columnheader", { name: new RegExp(plan) })).toBeVisible();
});
