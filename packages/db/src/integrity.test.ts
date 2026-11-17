import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { PG, pgErrorCode, withOrg } from "./client";
import { allocateNumber } from "./numbering";
import { clients, invoiceLines, invoices, payments } from "./schema";
import { seedOrg, testDbs } from "./testing";

const dbs = testDbs();
afterAll(() => dbs.close());

type Seed = Awaited<ReturnType<typeof seedOrg>>;
let a: Seed;
let b: Seed;

beforeAll(async () => {
  a = await seedOrg(dbs.system);
  b = await seedOrg(dbs.system);
});

async function draftInvoice(seed: Seed) {
  return withOrg(dbs.app, seed.org.id, async (tx) => {
    const [inv] = await tx
      .insert(invoices)
      .values({
        orgId: seed.org.id,
        businessProfileId: seed.profile.id,
        issueDate: "2026-11-01",
        currency: "EUR",
      })
      .returning();
    await tx.insert(invoiceLines).values({
      orgId: seed.org.id,
      invoiceId: inv!.id,
      position: 0,
      description: "Work",
      quantity: "1",
      unitPrice: "100",
      taxCategory: "S",
      taxRate: "19",
      gross: 10000,
      lineDiscount: 0,
      net: 10000,
    });
    return inv!;
  });
}

async function issue(seed: Seed, id: string, number: string) {
  return withOrg(dbs.app, seed.org.id, (tx) =>
    tx
      .update(invoices)
      .set({ status: "open", number, issuedAt: new Date(), total: 11900 })
      .where(eq(invoices.id, id)),
  );
}

describe("row-level security", () => {
  it("hides other organisations' rows", async () => {
    await withOrg(dbs.app, a.org.id, (tx) =>
      tx.insert(clients).values({ orgId: a.org.id, name: "Acme A" }),
    );
    await withOrg(dbs.app, b.org.id, (tx) =>
      tx.insert(clients).values({ orgId: b.org.id, name: "Acme B" }),
    );

    const seenByA = await withOrg(dbs.app, a.org.id, (tx) => tx.select().from(clients));
    expect(seenByA.map((c) => c.name)).toEqual(["Acme A"]);
  });

  it("rejects writes into another organisation", async () => {
    const err = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.insert(clients).values({ orgId: b.org.id, name: "Sneaky" }),
    ).catch((e: unknown) => e);
    expect(String((err as Error).cause ?? err)).toMatch(/row-level security/);
  });

  it("returns nothing without an org context", async () => {
    const rows = await dbs.app.select().from(clients);
    expect(rows).toEqual([]);
  });

  it("cannot update rows of another org even by id", async () => {
    const [bClient] = await withOrg(dbs.app, b.org.id, (tx) => tx.select().from(clients));
    const res = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.update(clients).set({ name: "pwned" }).where(eq(clients.id, bClient!.id)).returning(),
    );
    expect(res).toEqual([]);
  });
});

describe("issued invoice immutability", () => {
  it("allows editing drafts", async () => {
    const inv = await draftInvoice(a);
    await withOrg(dbs.app, a.org.id, (tx) =>
      tx.update(invoices).set({ notes: "edited" }).where(eq(invoices.id, inv.id)),
    );
  });

  it("enforces number ⇔ issued", async () => {
    const inv = await draftInvoice(a);
    const err = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.update(invoices).set({ status: "open" }).where(eq(invoices.id, inv.id)),
    ).catch((e: unknown) => e);
    expect(pgErrorCode(err)).toBe(PG.checkViolation);
  });

  it("freezes legal content once issued", async () => {
    const inv = await draftInvoice(a);
    await issue(a, inv.id, "INV-T-1");
    const err = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.update(invoices).set({ total: 1 }).where(eq(invoices.id, inv.id)),
    ).catch((e: unknown) => e);
    expect(String((err as Error).cause ?? err)).toMatch(/immutable/);
  });

  it("freezes lines once issued", async () => {
    const inv = await draftInvoice(a);
    await issue(a, inv.id, "INV-T-2");
    const err = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.update(invoiceLines).set({ description: "x" }).where(eq(invoiceLines.invoiceId, inv.id)),
    ).catch((e: unknown) => e);
    expect(String((err as Error).cause ?? err)).toMatch(/immutable/);
  });

  it("allows lifecycle facts to change", async () => {
    const inv = await draftInvoice(a);
    await issue(a, inv.id, "INV-T-3");
    await withOrg(dbs.app, a.org.id, (tx) =>
      tx
        .update(invoices)
        .set({ sentAt: new Date(), amountPaid: 11900, status: "paid", paidAt: new Date() })
        .where(eq(invoices.id, inv.id)),
    );
  });

  it("blocks deleting issued invoices and returning to draft", async () => {
    const inv = await draftInvoice(a);
    await issue(a, inv.id, "INV-T-4");
    const del = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.delete(invoices).where(eq(invoices.id, inv.id)),
    ).catch((e: unknown) => e);
    expect(String((del as Error).cause ?? del)).toMatch(/cannot be deleted/);
    const back = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.update(invoices).set({ status: "draft", number: null }).where(eq(invoices.id, inv.id)),
    ).catch((e: unknown) => e);
    expect(String((back as Error).cause ?? back)).toMatch(/return to draft/);
  });

  it("deletes drafts together with their lines", async () => {
    const inv = await draftInvoice(a);
    await withOrg(dbs.app, a.org.id, (tx) => tx.delete(invoices).where(eq(invoices.id, inv.id)));
    const lines = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)),
    );
    expect(lines).toEqual([]);
  });

  it("rejects duplicate numbers per profile", async () => {
    const x = await draftInvoice(a);
    const y = await draftInvoice(a);
    await issue(a, x.id, "INV-DUP");
    const err = await issue(a, y.id, "INV-DUP").catch((e: unknown) => e);
    expect(pgErrorCode(err)).toBe(PG.uniqueViolation);
  });

  it("never deletes payments", async () => {
    const inv = await draftInvoice(a);
    await issue(a, inv.id, "INV-T-5");
    const [p] = await withOrg(dbs.app, a.org.id, (tx) =>
      tx
        .insert(payments)
        .values({
          orgId: a.org.id,
          invoiceId: inv.id,
          amount: 100,
          currency: "EUR",
          method: "bank_transfer",
          receivedOn: "2026-11-02",
        })
        .returning(),
    );
    const err = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.delete(payments).where(eq(payments.id, p!.id)),
    ).catch((e: unknown) => e);
    expect(String((err as Error).cause ?? err)).toMatch(/cannot be deleted/);
  });
});

describe("number allocation", () => {
  it("is gap-free and unique under 50 concurrent transactions", async () => {
    const seed = await seedOrg(dbs.system);
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        withOrg(dbs.app, seed.org.id, (tx) =>
          allocateNumber(tx, {
            orgId: seed.org.id,
            seriesId: seed.series.id,
            pattern: seed.series.pattern,
            resetPolicy: "yearly",
            issueDate: "2026-11-17",
          }),
        ),
      ),
    );
    const seqs = results.map((r) => r.sequence).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.number)).size).toBe(50);
  });

  it("does not consume a number when the transaction rolls back", async () => {
    const seed = await seedOrg(dbs.system);
    const args = {
      orgId: seed.org.id,
      seriesId: seed.series.id,
      pattern: "{SEQ}",
      resetPolicy: "never" as const,
      issueDate: "2026-11-17",
    };
    await withOrg(dbs.app, seed.org.id, async (tx) => {
      await allocateNumber(tx, args);
      tx.rollback();
    }).catch(() => undefined);
    const next = await withOrg(dbs.app, seed.org.id, (tx) => allocateNumber(tx, args));
    expect(next.number).toBe("1");
  });

  it("resets per period", async () => {
    const seed = await seedOrg(dbs.system);
    const alloc = (issueDate: string) =>
      withOrg(dbs.app, seed.org.id, (tx) =>
        allocateNumber(tx, {
          orgId: seed.org.id,
          seriesId: seed.series.id,
          pattern: "{YYYY}-{SEQ:3}",
          resetPolicy: "yearly",
          issueDate,
        }),
      );
    expect((await alloc("2026-12-31")).number).toBe("2026-001");
    expect((await alloc("2027-01-01")).number).toBe("2027-001");
    expect((await alloc("2026-12-31")).number).toBe("2026-002");
  });
});

describe("audit log", () => {
  it("is append-only for the app role", async () => {
    await withOrg(dbs.app, a.org.id, (tx) =>
      tx.execute(
        sql`insert into audit_log (org_id, action, entity_type) values (${a.org.id}, 'test', 'x')`,
      ),
    );
    const err = await withOrg(dbs.app, a.org.id, (tx) =>
      tx.execute(sql`delete from audit_log`),
    ).catch((e: unknown) => e);
    expect(String((err as Error).cause ?? err)).toMatch(/permission denied/);
  });
});
