import postgres from "postgres";
import { createDb, one, type Database } from "./client";
import { runMigrations } from "./migrate";
import { businessProfiles, numberSeries, organizations, users, members } from "./schema";

const OWNER_URL = process.env.TEST_DATABASE_URL ?? "postgres://pti:pti@localhost:5432/pti_test";

/** Rebuild the test database from migrations. Call once per test run (globalSetup). */
export async function resetTestDatabase(url = OWNER_URL): Promise<void> {
  const admin = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(`
      drop schema if exists public cascade;
      drop schema if exists drizzle cascade;
      create schema public;
      grant all on schema public to public;
    `);
    await admin.unsafe(`alter role pti_app password 'pti_app'`).catch(() => undefined);
    await admin.unsafe(`alter role pti_system password 'pti_system'`).catch(() => undefined);
  } finally {
    await admin.end();
  }
  await runMigrations(url);
  const after = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await after.unsafe(
      `alter role pti_app password 'pti_app'; alter role pti_system password 'pti_system';`,
    );
  } finally {
    await after.end();
  }
}

function withRole(url: string, role: "pti_app" | "pti_system"): string {
  const u = new URL(url);
  u.username = role;
  u.password = role;
  return u.toString();
}

/** Connections as the RLS-restricted app role and the RLS-bypassing system role. */
export function testDbs(url = OWNER_URL): {
  app: Database;
  system: Database;
  close: () => Promise<void>;
} {
  const a = createDb({ url: withRole(url, "pti_app"), max: 20 });
  const s = createDb({ url: withRole(url, "pti_system"), max: 5 });
  return {
    app: a.db,
    system: s.db,
    close: async () => {
      await Promise.all([a.client.end(), s.client.end()]);
    },
  };
}

let counter = 0;

/** Create a user + organisation + default business profile + invoice series. */
export async function seedOrg(system: Database, overrides: { country?: string } = {}) {
  const n = ++counter;
  const suffix = `${Date.now().toString(36)}${n}`;
  return system.transaction(async (tx) => {
    const user = one(
      await tx
        .insert(users)
        .values({ name: `User ${n}`, email: `user${suffix}@example.test`, emailVerified: true })
        .returning(),
    );
    const org = one(
      await tx
        .insert(organizations)
        .values({ name: `Org ${n}`, slug: `org-${suffix}` })
        .returning(),
    );
    await tx.insert(members).values({ organizationId: org.id, userId: user.id, role: "owner" });
    const profile = one(
      await tx
        .insert(businessProfiles)
        .values({
          orgId: org.id,
          legalName: `Studio ${n} GmbH`,
          address: {
            line1: "Main St 1",
            line2: "",
            city: "Berlin",
            region: "",
            postalCode: "10115",
            country: overrides.country ?? "DE",
          },
          isDefault: true,
        })
        .returning(),
    );
    const series = one(
      await tx
        .insert(numberSeries)
        .values({
          orgId: org.id,
          businessProfileId: profile.id,
          docType: "invoice",
          pattern: "INV-{YYYY}-{SEQ:4}",
        })
        .returning(),
    );
    return { user, org, profile, series };
  });
}
