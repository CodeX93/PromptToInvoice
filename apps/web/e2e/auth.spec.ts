import { expect, signUpOwner, test, uniqueEmail, watchErrors } from "./helpers";

test("sign up, verify, onboard, sign out and back in", async ({ page }) => {
  const assertNoErrors = watchErrors(page);
  const email = await signUpOwner(page);
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lena");

  await page.context().clearCookies();
  await page.goto("/app/invoices");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Finvoices/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/invoices/);
  assertNoErrors();
});

test("wrong password is refused without revealing whether the account exists", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(uniqueEmail("nobody"));
  await page.getByLabel(/^Password/).fill("not the password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("app routes require a session", async ({ page }) => {
  await page.goto("/app/settings/billing");
  await expect(page).toHaveURL(/\/sign-in/);
});
