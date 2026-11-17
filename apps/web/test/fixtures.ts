import { seedOrg, testDbs } from "@pti/db/testing";
import { eq, schema } from "@pti/db";
import type { OrgContext } from "@/server/session";
import type { PlanId, Role } from "@pti/core";

export const dbs = testDbs();

export async function orgContext(opts: { plan?: PlanId; role?: Role } = {}) {
  const seed = await seedOrg(dbs.system);
  if (opts.plan)
    await dbs.system
      .update(schema.organizations)
      .set({ plan: opts.plan })
      .where(eq(schema.organizations.id, seed.org.id));
  await dbs.system.insert(schema.numberSeries).values({
    orgId: seed.org.id,
    businessProfileId: seed.profile.id,
    docType: "credit_note",
    pattern: "CN-{SEQ:3}",
  });
  const [client] = await dbs.system
    .insert(schema.clients)
    .values({
      orgId: seed.org.id,
      name: "Acme GmbH",
      emails: ["ap@acme.test"],
      address: { line1: "", line2: "", city: "Berlin", region: "", postalCode: "", country: "DE" },
    })
    .returning();
  const ctx: OrgContext = {
    user: {
      id: seed.user.id,
      name: seed.user.name,
      email: seed.user.email,
      image: null,
      locale: "en",
      timeZone: "UTC",
      twoFactorEnabled: false,
    },
    sessionId: "test",
    role: opts.role ?? "owner",
    org: {
      id: seed.org.id,
      name: seed.org.name,
      slug: seed.org.slug,
      plan: opts.plan ?? "pro",
      timeZone: "UTC",
      region: "eu",
    },
  };
  return { ctx, seed, clientId: client!.id };
}
