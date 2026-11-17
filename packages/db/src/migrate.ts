import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

/**
 * Apply pending migrations. Run with the owner role (MIGRATION_DATABASE_URL),
 * never with the RLS-restricted app role.
 */
export async function runMigrations(url: string): Promise<void> {
  const { db, client } = createDb({ url, max: 1, applicationName: "pti-migrate" });
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("MIGRATION_DATABASE_URL or DATABASE_URL must be set");
    process.exit(1);
  }
  const started = performance.now();
  runMigrations(url)
    .then(() => {
      console.warn(`migrations applied in ${Math.round(performance.now() - started)}ms`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
