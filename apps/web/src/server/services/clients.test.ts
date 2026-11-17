import { afterAll, describe, expect, it } from "vitest";
import { dbs, orgContext } from "../../../test/fixtures";
import { clientTaxContext, createClient, listClients, matchClients, setClientArchived, updateClient } from "./clients";
import { issueInvoice, saveDraft } from "./invoices";

afterAll(() => dbs.close());

const base = { contactName: null, emails: [], phone: null, address: null, isBusiness: true, vatId: null, taxId: null, currency: null, paymentTermsDays: null, language: null, buyerReference: null, notes: "" };

describe("clients", () => {
  it("fuzzy-matches names with trigram similarity", async () => {
    const { ctx } = await orgContext();
    await createClient(ctx, { ...base, name: "Nordlicht Medien GmbH" });
    await createClient(ctx, { ...base, name: "Brightline Ltd" });
    const m = await matchClients(ctx, "nordlicht");
    expect(m[0]?.name).toBe("Nordlicht Medien GmbH");
    expect((await matchClients(ctx, "brigtline"))[0]?.name).toBe("Brightline Ltd");
    expect(await matchClients(ctx, "zzzzzz")).toEqual([]);
  });

  it("lists with outstanding balances per currency and keyset pages", async () => {
    const { ctx, seed, clientId } = await orgContext();
    const { id } = await saveDraft(ctx, null, { businessProfileId: seed.profile.id, clientId, currency: "EUR", issueDate: "2026-11-17", lines: [{ description: "x", quantity: "1", unitPrice: "100", taxCategory: "S", taxRate: "19" }] });
    await issueInvoice(ctx, id);
    for (const n of ["Zeta", "Yotta", "Xeno"]) await createClient(ctx, { ...base, name: n });
    const p1 = await listClients(ctx, { limit: 2 });
    expect(p1.items.map((c) => c.name)).toEqual(["Acme GmbH", "Xeno"]);
    expect(p1.items[0]?.outstanding).toEqual([{ currency: "EUR", amount: 11900 }]);
    expect(p1.items[0]?.invoiceCount).toBe(1);
    const p2 = await listClients(ctx, { limit: 2, cursor: p1.nextCursor ?? undefined });
    expect(p2.items.map((c) => c.name)).toEqual(["Yotta", "Zeta"]);
  });

  it("searches by name, email and VAT ID, and hides archived clients", async () => {
    const { ctx } = await orgContext();
    const c = await createClient(ctx, { ...base, name: "Halden & Co", emails: ["billing@halden.test"], vatId: "NL123456789B01" });
    expect((await listClients(ctx, { q: "halden" })).items).toHaveLength(1);
    expect((await listClients(ctx, { q: "billing@halden.test" })).items).toHaveLength(1);
    expect((await listClients(ctx, { q: "NL1234" })).items).toHaveLength(1);
    expect((await listClients(ctx, { q: "50%_" })).items).toHaveLength(0);
    await setClientArchived(ctx, c.id, true);
    expect((await listClients(ctx, { q: "halden" })).items).toHaveLength(0);
    expect((await listClients(ctx, { q: "halden", status: "archived" })).items).toHaveLength(1);
  });

  it("resets VAT verification when the VAT ID changes", async () => {
    const { ctx } = await orgContext();
    const c = await createClient(ctx, { ...base, name: "Verified Co", vatId: "DE123456789" });
    await dbs.system.execute(`update clients set vat_id_verified_at = now() where id = '${c.id}'` as never);
    await updateClient(ctx, c.id, { ...base, name: "Verified Co", vatId: "DE987654321" });
    const after = (await listClients(ctx, { q: "Verified" })).items[0];
    expect(after?.vatVerified).toBe(false);
  });

  it("derives tax context, including Greece's EL prefix", () => {
    expect(clientTaxContext({ isBusiness: true, vatId: "EL123456789", vatIdVerifiedAt: null, address: { line1: "", line2: "", city: "", region: "", postalCode: "", country: "GR" } }).buyerVatIdValid).toBe(true);
    expect(clientTaxContext({ isBusiness: true, vatId: "XX1", vatIdVerifiedAt: null, address: null }).buyerVatIdValid).toBe(false);
  });
});
