import { expect, signUpOwner, test, watchErrors } from "./helpers";

test("a sentence in the prompt bar becomes a highlighted, editable draft", async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  await signUpOwner(page);
  await page.goto("/app");
  await page.keyboard.press("Control+k");
  const bar = page.locator("form[role=search] input");
  await bar.fill("16h implementation for Nordlicht at €110/h plus hosting €39.90, net 14");
  await bar.press("Enter");
  await page.waitForURL(/\/app\/invoices\/[0-9a-f-]{36}/, { timeout: 30_000 });

  // AI-filled values carry the highlighter; nothing has been issued.
  await expect(page.locator(".ai-field, .ai-mark").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Issue invoice" })).toBeVisible();
  await expect(page.getByText(/1,760\.00/).first()).toBeVisible();
  assertNoErrors();
});
