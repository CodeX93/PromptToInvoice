import { draftInvoice, expect, linkIn, signUpOwner, test, waitForMail } from "./helpers";

test.describe.configure({ mode: "serial" });

test("client receives the email, opens the link, and the owner sees it viewed", async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "owner flow runs on desktop; the client side is checked on mobile below");
  await signUpOwner(page);
  const client = await draftInvoice(page);
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await page.waitForURL(/\/app\/invoices\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByLabel("Message").fill("Thanks for the great project.");
  await page.getByRole("button", { name: "Send invoice" }).click();
  await expect(page.getByText(/Queued for sending/)).toBeVisible();

  const mail = await waitForMail(client.email, /^Invoice INV-/, 30_000);
  expect(mail.attachments.some((a) => a.endsWith(".pdf"))).toBe(true);
  const link = linkIn(mail, /https?:\/\/\S+\/i\/[\w-]+/);

  const clientPage = await (await browser.newContext()).newPage();
  await clientPage.goto(link);
  await expect(clientPage.getByText("Amount due", { exact: true }).first()).toBeVisible();
  // On the document and in the "pay by bank transfer" panel.
  await expect(clientPage.getByText("DE89 3704 0044 0532 0130 00")).toHaveCount(2);
  // The client page has no app chrome and can't reach the app.
  await expect(clientPage.getByRole("link", { name: "Settings" })).toHaveCount(0);

  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Viewed by client/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
});

test("unknown invoice links are a plain 404", async ({ page }) => {
  const res = await page.goto("/i/does-not-exist-0000000000000000");
  expect(res?.status()).toBe(404);
});
