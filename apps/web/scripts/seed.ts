/**
 * Demo data for local development: one verified user, an organisation in
 * Berlin, a handful of EU/US clients and ~8 months of invoices in every
 * state. Uses the real services, so numbering, totals and constraints are
 * exactly what production would produce.
 *
 *   pnpm --filter @pti/web seed            (email: demo@prompttoinvoice.test / password: demo-password-123)
 */
import { addDays, todayIn } from "@pti/core";
import { eq, schema } from "@pti/db";
import { auth } from "@/server/auth";
import { sysDb } from "@/server/db";
import type { OrgContext } from "@/server/session";
import { createOrganization } from "@/server/services/onboarding";
import { createClient } from "@/server/services/clients";
import { issueInvoice, recordPayment, saveDraft, draftCreditNote } from "@/server/services/invoices";

const EMAIL = "demo@prompttoinvoice.test";
const PASSWORD = "demo-password-123";

async function main() {
  const existing = await sysDb.select().from(schema.users).where(eq(schema.users.email, EMAIL));
  if (existing.length) {
    console.warn(`Seed user ${EMAIL} already exists; nothing to do.`);
    return;
  }
  const { user } = await auth.api.signUpEmail({ body: { name: "Mira Lindqvist", email: EMAIL, password: PASSWORD } });
  await sysDb.update(schema.users).set({ emailVerified: true, timeZone: "Europe/Berlin" }).where(eq(schema.users.id, user.id));

  const { orgId } = await createOrganization(user.id, {
    businessName: "Lindqvist Studio",
    legalName: "Lindqvist Studio GmbH",
    address: { line1: "Torstraße 12", line2: "", city: "Berlin", region: "", postalCode: "10119", country: "DE" },
    currency: "EUR",
    vatId: "DE123456789",
    vatExempt: false,
    timeZone: "Europe/Berlin",
    email: "billing@lindqvist.test",
  });
  await sysDb.update(schema.organizations).set({ plan: "pro" }).where(eq(schema.organizations.id, orgId));
  const [org] = await sysDb.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const [profile] = await sysDb.select().from(schema.businessProfiles).where(eq(schema.businessProfiles.orgId, orgId));
  if (!org || !profile) throw new Error("seed failed");

  const ctx: OrgContext = {
    user: { id: user.id, name: user.name, email: user.email, image: null, locale: "en", timeZone: "Europe/Berlin", twoFactorEnabled: false },
    sessionId: "seed",
    role: "owner",
    org: { id: org.id, name: org.name, slug: org.slug, plan: "pro", timeZone: "Europe/Berlin", region: "eu" },
  };

  const base = { contactName: null, phone: null, isBusiness: true, taxId: null, currency: null, paymentTermsDays: null, language: null, buyerReference: null, notes: "" };
  const addr = (line1: string, postalCode: string, city: string, country: string) => ({ line1, line2: "", city, region: "", postalCode, country });
  const clients = await Promise.all([
    createClient(ctx, { ...base, name: "Nordlicht Medien GmbH", emails: ["ap@nordlicht.test"], address: addr("Schanzenstraße 4", "20357", "Hamburg", "DE"), vatId: "DE811907980", paymentTermsDays: 14 }),
    createClient(ctx, { ...base, name: "Atelier Lumière SAS", emails: ["compta@lumiere.test"], address: addr("12 Rue de Rivoli", "75004", "Paris", "FR"), vatId: "FR40303265045", language: "fr" }),
    createClient(ctx, { ...base, name: "Brightline Ltd", emails: ["finance@brightline.test"], address: addr("1 Shoreditch High St", "E1 6PJ", "London", "GB"), currency: "GBP" }),
    createClient(ctx, { ...base, name: "Acme Corp", emails: ["payables@acme.test"], address: addr("500 Market St", "94105", "San Francisco", "US"), currency: "USD", paymentTermsDays: 30 }),
    createClient(ctx, { ...base, name: "Halden & Co", emails: ["office@halden.test"], address: addr("Keizersgracht 1", "1015 CJ", "Amsterdam", "NL"), vatId: "NL123456789B01" }),
  ]);

  const today = todayIn("Europe/Berlin");
  const jobs = [
    { c: 0, d: -230, cur: "EUR", cat: "S", rate: "19", lines: [["Website redesign — discovery", "3", "days", "850"], ["Design system", "24", "h", "110"]], pay: "full" },
    { c: 1, d: -200, cur: "EUR", cat: "AE", rate: "0", lines: [["Brand identity", "1", "", "4200"]], pay: "full" },
    { c: 3, d: -170, cur: "USD", cat: "O", rate: "0", lines: [["Product strategy workshop", "2", "days", "1600"]], pay: "full" },
    { c: 0, d: -140, cur: "EUR", cat: "S", rate: "19", lines: [["Retainer — October", "1", "", "2400"]], pay: "full" },
    { c: 2, d: -110, cur: "GBP", cat: "O", rate: "0", lines: [["UX audit", "1", "", "2850"], ["Usability tests", "6", "sessions", "180"]], pay: "full" },
    { c: 4, d: -80, cur: "EUR", cat: "AE", rate: "0", lines: [["Illustration set (12)", "12", "pcs", "240"]], pay: "partial" },
    { c: 0, d: -50, cur: "EUR", cat: "S", rate: "19", lines: [["Retainer — November", "1", "", "2400"], ["Hosting", "1", "", "39.90"]], pay: "none" },
    { c: 3, d: -35, cur: "USD", cat: "O", rate: "0", lines: [["Design QA", "14.5", "h", "140"]], pay: "none" },
    { c: 1, d: -20, cur: "EUR", cat: "AE", rate: "0", lines: [["Packaging concepts", "3", "", "950"]], pay: "credit" },
    { c: 0, d: -6, cur: "EUR", cat: "S", rate: "19", lines: [["Retainer — December", "1", "", "2400"]], pay: "none" },
  ] as const;

  for (const j of jobs) {
    const client = clients[j.c];
    if (!client) continue;
    const issueDate = addDays(today, j.d);
    const { id } = await saveDraft(ctx, null, {
      businessProfileId: profile.id,
      clientId: client.id,
      currency: j.cur,
      issueDate,
      dueDate: addDays(issueDate, client.paymentTermsDays ?? 14),
      language: client.language ?? "en",
      lines: j.lines.map(([description, quantity, unit, unitPrice]) => ({ description, quantity, unit, unitPrice, taxCategory: j.cat, taxRate: j.rate })),
      notes: "Thank you for working with us.",
      terms: "Payable within the stated term without deduction.",
    });
    await issueInvoice(ctx, id);
    const [inv] = await sysDb.select().from(schema.invoices).where(eq(schema.invoices.id, id));
    if (!inv) continue;
    if (j.pay === "full") await recordPayment(ctx, id, { amount: inv.total, receivedOn: addDays(issueDate, 9), method: "bank_transfer", reference: inv.number ?? "", notes: "" });
    if (j.pay === "partial") await recordPayment(ctx, id, { amount: Math.round(inv.total / 2), receivedOn: addDays(issueDate, 12), method: "bank_transfer", reference: "", notes: "" });
    if (j.pay === "credit") await issueInvoice(ctx, await draftCreditNote(ctx, id));
  }
  // One draft to show the editor state.
  await saveDraft(ctx, null, {
    businessProfileId: profile.id,
    clientId: clients[4]?.id ?? null,
    currency: "EUR",
    issueDate: today,
    lines: [{ description: "Editorial illustrations, spring issue", quantity: "4", unit: "pcs", unitPrice: "380", taxCategory: "AE", taxRate: "0" }],
  });

  console.warn(`Seeded. Sign in as ${EMAIL} / ${PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
