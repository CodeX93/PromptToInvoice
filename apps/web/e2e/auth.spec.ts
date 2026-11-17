import type { Page } from "@playwright/test";
import {
  expect,
  linkIn,
  signUpOwner,
  sql,
  test,
  uniqueEmail,
  waitForMail,
  watchErrors,
} from "./helpers";

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

test.describe("magic links and two-factor", () => {
  async function requestLink(page: Page, email: string) {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign in with an email link instead" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    const mail = await waitForMail(email, /sign-in link/i);
    return linkIn(mail, /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/);
  }

  test("a magic link signs in an account without 2FA", async ({ page }) => {
    const email = await signUpOwner(page);
    await page.context().clearCookies();
    await page.goto(await requestLink(page, email));
    await expect(page).toHaveURL(/\/app/);
  });

  test("a magic link can't skip the second factor", async ({ page }) => {
    const email = await signUpOwner(page);
    await sql`update users set two_factor_enabled = true where email = ${email}`;
    await page.context().clearCookies();
    await page.goto(await requestLink(page, email));
    await expect(page).toHaveURL(/\/sign-in\?error=two_factor_required/);
    await expect(page.getByText(/uses two-factor authentication/)).toBeVisible();
    // And no session was created.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
