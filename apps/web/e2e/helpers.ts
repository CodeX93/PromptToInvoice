import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { OUTBOX } from "../playwright.config";

interface Mail {
  to: string[];
  subject: string;
  text: string;
  attachments: string[];
}

/**
 * Every test is its own visitor: a distinct client IP (RFC 2544 benchmark
 * range) so per-IP rate limits apply per test, as they would to real people.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const n = () => Math.floor(Math.random() * 254) + 1;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${n()}.${n()}` });
    await use(page);
  },
});
export { expect };

/** Wait for the newest email to `to` matching `subject`, from the file outbox. */
export async function waitForMail(to: string, subject: RegExp, timeoutMs = 20_000): Promise<Mail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = (await readdir(OUTBOX).catch(() => [] as string[])).sort().reverse();
    for (const f of files) {
      const m = JSON.parse(await readFile(join(OUTBOX, f), "utf8")) as Mail;
      if (m.to.includes(to) && subject.test(m.subject)) return m;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${to} matching ${subject} within ${timeoutMs}ms`);
}

export function linkIn(mail: Mail, pattern: RegExp): string {
  const m = pattern.exec(mail.text);
  if (!m) throw new Error(`No link matching ${pattern} in "${mail.subject}"`);
  return m[0];
}

export const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.test`;

/** Fail the test on any uncaught page error or console error. */
export function watchErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return () => expect(errors, errors.join("\n")).toEqual([]);
}

/** Sign up, verify by email, finish onboarding with bank details. Returns the email. */
export async function signUpOwner(
  page: Page,
  business = "Hoffmann Design Studio",
): Promise<string> {
  const email = uniqueEmail("owner");
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Lena Hoffmann");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Confirm your email")).toBeVisible();

  const mail = await waitForMail(email, /confirm|verify/i);
  await page.goto(linkIn(mail, /https?:\/\/\S+\/api\/auth\/verify-email\?token=\S+/));
  await page.waitForURL(/onboarding/);
  await page.getByLabel("Business name").fill(business);
  // Pick the country explicitly: the default is guessed from the browser locale.
  await page.getByLabel("Country").selectOption("DE");
  await page.getByLabel("Street").fill("Torstraße 12");
  await page.getByLabel("Postcode").fill("10119");
  await page.getByLabel("City").fill("Berlin");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.waitForURL(/\/app/);

  await page.goto("/app/settings");
  await page.getByLabel("IBAN").fill("DE89 3704 0044 0532 0130 00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Business details saved.")).toBeVisible();
  return email;
}

/** Create a client inline and a two-line invoice in the editor; leaves the editor open. */
export async function draftInvoice(
  page: Page,
  client = { name: "Atelier Lumière", email: uniqueEmail("client") },
) {
  await page.goto("/app/invoices/new");
  await page.getByRole("combobox", { name: "Client" }).fill(client.name);
  await page.getByRole("option", { name: new RegExp(`Add “${client.name}”`) }).click();
  await page.getByLabel("Country").selectOption("DE");
  await page.getByLabel("Billing email").fill(client.email);
  await page.getByLabel("Street").fill("Kastanienallee 3");
  await page.getByLabel("Postcode").fill("10435");
  await page.getByLabel("City").fill("Berlin");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByLabel("Line 1 description").fill("Brand identity");
  await page.getByLabel("Line 1 quantity").fill("1");
  await page.getByLabel("Line 1 unit price").fill("3400");
  return client;
}
