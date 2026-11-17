import { afterAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { eq, schema } from "@pti/db";
import { dbs, orgContext } from "../../../test/fixtures";
import { readBlob } from "../storage";
import { archivePdf } from "../documents/service";
import { buildExport } from "./data-export";
import { assertCanDeleteUser, deleteOrganization } from "./org-deletion";
import { purgeExpiredRetention } from "../jobs/maintenance";
import { issueInvoice, saveDraft } from "./invoices";

afterAll(() => dbs.close());

const line = { description: "Work", quantity: "1", unitPrice: "100", taxCategory: "S", taxRate: "19" };

describe("GDPR", () => {
  it("exports data and archived PDFs without bank secrets", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "EUR", issueDate: "2026-11-17", lines: [line] });
    await issueInvoice(ctx, id);
    await archivePdf(ctx, id);
    const { fileId } = await buildExport(ctx);
    const [f] = await dbs.system.select().from(schema.files).where(eq(schema.files.id, fileId));
    const zip = unzipSync(new Uint8Array(await readBlob(f!.storageKey)));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(["invoices.json", "clients.json", "README.txt", "pdf/Invoice-INV-2026-0001.pdf"]));
    expect(JSON.parse(strFromU8(zip["invoices.json"]!))[0].number).toBe("INV-2026-0001");
    expect(strFromU8(zip["business_profiles.json"]!)).not.toContain("bankDetailsEncrypted");
  });

  it("deletes an organisation but keeps issued documents under legal hold", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const issued = await saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "EUR", issueDate: "2026-11-17", lines: [line] });
    await issueInvoice(ctx, issued.id);
    const draft = await saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "EUR", issueDate: "2026-11-17", lines: [line] });
    await expect(deleteOrganization(ctx, "wrong name")).rejects.toThrow(/Type the organisation name/);
    await deleteOrganization(ctx, ctx.org.name);
    const inv = await dbs.system.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.orgId, ctx.org.id));
    expect(inv.map((i) => i.id)).toEqual([issued.id]);
    expect(inv.map((i) => i.id)).not.toContain(draft.id);
    expect(await dbs.system.select().from(schema.members).where(eq(schema.members.organizationId, ctx.org.id))).toEqual([]);
    const [org] = await dbs.system.select().from(schema.organizations).where(eq(schema.organizations.id, ctx.org.id));
    expect(org?.deletedAt).toBeInstanceOf(Date);
    // With the org gone, the owner may now delete their account.
    await expect(assertCanDeleteUser(ctx.user.id)).resolves.toBeUndefined();

    // Nothing is purged while retention runs…
    await archivePdf(ctx, issued.id).catch(() => undefined);
    await purgeExpiredRetention(new Date());
    expect(await dbs.system.select().from(schema.invoices).where(eq(schema.invoices.orgId, ctx.org.id))).toHaveLength(1);
    // …and everything goes once it has ended.
    await purgeExpiredRetention(new Date(Date.now() + 11 * 365 * 86_400_000));
    expect(await dbs.system.select().from(schema.invoices).where(eq(schema.invoices.orgId, ctx.org.id))).toHaveLength(0);
    expect(await dbs.system.select().from(schema.organizations).where(eq(schema.organizations.id, ctx.org.id))).toHaveLength(0);
  });

  it("blocks deleting the only owner of a live organisation", async () => {
    const { ctx } = await orgContext();
    await expect(assertCanDeleteUser(ctx.user.id)).rejects.toThrow(/Delete the organisation/);
  });
});
