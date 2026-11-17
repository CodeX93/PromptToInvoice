import "server-only";
import { zipSync, strToU8 } from "fflate";
import { eq, schema, withOrg } from "@pti/db";
import { db, sysDb } from "../db";
import { env } from "../env";
import { audit } from "../audit";
import { authorize, type OrgContext } from "../session";
import { enqueue } from "../jobs/queue";
import { readBlob, storeFile } from "../storage";
import { sendEmail } from "../email/transport";
import { enforce } from "../rate-limit";

/** Request a full export (GDPR Art. 20). Built by the worker; the requester gets an email. */
export async function requestExport(ctx: OrgContext): Promise<void> {
  authorize(ctx, "export:run");
  await enforce(`export:${ctx.org.id}`, { limit: 3, windowSeconds: 86_400 });
  await enqueue(
    "org.export",
    { orgId: ctx.org.id, requestedBy: ctx.user.id },
    { singletonKey: `export:${ctx.org.id}` },
  );
  await audit(sysDb, {
    orgId: ctx.org.id,
    actorId: ctx.user.id,
    action: "org.export_requested",
    entityType: "organization",
    entityId: ctx.org.id,
  });
}

/**
 * Build the archive: one JSON file per table (secrets excluded) plus every
 * archived invoice PDF, zipped in memory (exports are tens of MB at most).
 */
export async function buildExport(ctx: OrgContext): Promise<{ fileId: string; bytes: number }> {
  const files: Record<string, Uint8Array> = {};
  const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2));
  await withOrg(db, ctx.org.id, async (tx) => {
    const [profiles, clients, invoices, lines, payments, events, taxRates, schedules] =
      await Promise.all([
        tx.select().from(schema.businessProfiles),
        tx.select().from(schema.clients),
        tx.select().from(schema.invoices),
        tx.select().from(schema.invoiceLines),
        tx.select().from(schema.payments),
        tx.select().from(schema.invoiceEvents),
        tx.select().from(schema.taxRates),
        tx.select().from(schema.recurringSchedules),
      ]);
    // Bank details stay encrypted at rest and are not exported in clear text.
    files["business_profiles.json"] = json(profiles.map(({ bankDetailsEncrypted: _b, ...p }) => p));
    files["clients.json"] = json(clients);
    files["invoices.json"] = json(invoices);
    files["invoice_lines.json"] = json(lines);
    files["payments.json"] = json(payments);
    files["invoice_events.json"] = json(events);
    files["tax_rates.json"] = json(taxRates);
    files["recurring_schedules.json"] = json(schedules);
    const pdfs = await tx.select().from(schema.files).where(eq(schema.files.kind, "invoice_pdf"));
    for (const f of pdfs) files[`pdf/${f.fileName}`] = new Uint8Array(await readBlob(f.storageKey));
  });
  files["README.txt"] = strToU8(
    `PromptToInvoice export for ${ctx.org.name}\nCreated ${new Date().toISOString()}\n\nAmounts are integers in minor units (cents). PDFs are the archived originals as sent to clients.\n`,
  );
  const zip = Buffer.from(zipSync(files, { level: 6 }));
  const stored = await withOrg(db, ctx.org.id, (tx) =>
    storeFile(tx, {
      orgId: ctx.org.id,
      kind: "export",
      body: zip,
      contentType: "application/zip",
      fileName: `prompttoinvoice-export-${new Date().toISOString().slice(0, 10)}.zip`,
      retainUntil: new Date(Date.now() + 7 * 86_400_000),
    }),
  );
  await sendEmail({
    to: [ctx.user.email],
    subject: "Your data export is ready",
    text: `Your export is ready to download for 7 days:\n${env.APP_URL}/api/files/${stored.id}\n\nYou'll need to be signed in.`,
    html: `<p>Your export is ready to download for 7 days:</p><p><a href="${env.APP_URL}/api/files/${stored.id}">Download export</a></p><p>You'll need to be signed in.</p>`,
    tag: "export",
  });
  return { fileId: stored.id, bytes: zip.length };
}
