import { sql } from "drizzle-orm";
import { bigint, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/**
 * UUIDv7 primary keys: globally unique like v4 but time-ordered, so B-tree
 * inserts stay append-mostly and indexes don't fragment.
 */
export const id = () =>
  uuid("id")
    .primaryKey()
    // App-generated v7 for locality; DB default covers raw SQL inserts.
    .default(sql`gen_random_uuid()`)
    .$defaultFn(() => uuidv7());

export const newId = (): string => uuidv7();

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Money in minor units. Values stay within Number.MAX_SAFE_INTEGER (see @pti/core money). */
export const money = (name: string) => bigint(name, { mode: "number" });

export const orgId = () => uuid("org_id").notNull();

export const nowSql = sql`now()`;
