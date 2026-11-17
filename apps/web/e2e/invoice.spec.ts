import { draftInvoice, expect, signUpOwner, test, watchErrors } from "./helpers";

test("draft → issue → record payment → paid, with correct totals", async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await signUpOwner(page);
  await draftInvoice(page);

  // 3,400.00 + 19% VAT (German client, default rate) = 4,046.00
  await expect(page.getByText("4,046.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await page.waitForURL(/\/app\/invoices\/[0-9a-f-]{36}$/);
  const number = page.getByText(/^INV-\d{4}-0001$/).first();
  await expect(number).toBeVisible();

  // Issued documents are locked: no edit affordance.
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  // PDF is served and archived.
  const pdf = await page.request.get(`${page.url()}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("button", { name: "Record payment" }).last().click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^Paid$/).first()).toBeVisible();
  assertNoErrors();
});

test("numbers are gap-free across consecutive issues", async ({ page }) => {
  await signUpOwner(page);
  const numbers: string[] = [];
  for (let i = 0; i < 2; i++) {
    await draftInvoice(page, { name: `Client ${i}`, email: `c${i}-${Date.now()}@e2e.test` });
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await page.waitForURL(/\/app\/invoices\/[0-9a-f-]{36}$/);
    numbers.push(
      (await page
        .getByText(/^INV-\d{4}-\d{4}$/)
        .first()
        .textContent()) ?? "",
    );
  }
  expect(numbers.map((n) => n.slice(-4))).toEqual(["0001", "0002"]);
});
