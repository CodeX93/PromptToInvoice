import "server-only";
import { z } from "zod";
import { isZeroRateCategory, percentSchema, taxCategorySchema, DEFAULT_EXEMPTION_NOTES } from "@pti/core";
import { and, asc, eq, isNull, schema, sql, withOrg } from "@pti/db";
import { db } from "../db";
import { audit } from "../audit";
import { authorize, type OrgContext } from "../session";

export const taxRateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    category: taxCategorySchema,
    rate: percentSchema,
    note: z.string().trim().max(500).optional(),
  })
  .refine((r) => (isZeroRateCategory(r.category) ? Number(r.rate) === 0 : Number(r.rate) > 0), {
    path: ["rate"],
    message: "Standard rates must be above 0%; other categories are 0%.",
  });

export async function listTaxRates(ctx: OrgContext) {
  return withOrg(db, ctx.org.id, (tx) =>
    tx
      .select()
      .from(schema.taxRates)
      .where(isNull(schema.taxRates.archivedAt))
      .orderBy(sql`${schema.taxRates.isDefault} desc`, asc(schema.taxRates.category), asc(schema.taxRates.name)),
  );
}

export async function createTaxRate(ctx: OrgContext, input: z.infer<typeof taxRateSchema>) {
  authorize(ctx, "settings:write");
  await withOrg(db, ctx.org.id, async (tx) => {
    const [row] = await tx
      .insert(schema.taxRates)
      .values({ orgId: ctx.org.id, name: input.name, category: input.category, rate: input.rate, note: input.note || DEFAULT_EXEMPTION_NOTES[input.category] || null })
      .returning({ id: schema.taxRates.id });
    await audit(tx, { orgId: ctx.org.id, actorId: ctx.user.id, action: "tax_rate.created", entityType: "tax_rate", entityId: row?.id, diff: input });
  });
}

export async function setDefaultTaxRate(ctx: OrgContext, id: string) {
  authorize(ctx, "settings:write");
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx.update(schema.taxRates).set({ isDefault: sql`${schema.taxRates.id} = ${id}` }).where(isNull(schema.taxRates.archivedAt));
    await audit(tx, { orgId: ctx.org.id, actorId: ctx.user.id, action: "tax_rate.default_set", entityType: "tax_rate", entityId: id });
  });
}

/** Rates are archived, never deleted: issued invoices keep their own copy of the rate anyway. */
export async function archiveTaxRate(ctx: OrgContext, id: string) {
  authorize(ctx, "settings:write");
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx.update(schema.taxRates).set({ archivedAt: new Date(), isDefault: false }).where(and(eq(schema.taxRates.id, id)));
    await audit(tx, { orgId: ctx.org.id, actorId: ctx.user.id, action: "tax_rate.archived", entityType: "tax_rate", entityId: id });
  });
}
