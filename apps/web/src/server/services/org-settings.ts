import "server-only";
import { z } from "zod";
import { eq, schema } from "@pti/db";
import { sysDb } from "../db";
import { audit } from "../audit";
import { authorize, type OrgContext } from "../session";

/** Organisation-level preferences stored in organizations.settings (jsonb). */
export const orgSettingsSchema = z.object({
  ai: z
    .object({
      enabled: z.boolean().default(true),
      /** Keep the text of prompts for quality review (90 days). Off = store only a hash. */
      retainPrompts: z.boolean().default(true),
    })
    .default({ enabled: true, retainPrompts: true }),
  reminders: z
    .object({
      enabled: z.boolean().default(true),
      /** Days relative to the due date: negative = before, positive = after. */
      offsets: z.array(z.number().int().min(-30).max(90)).max(6).default([-3, 3, 10]),
    })
    .default({ enabled: true, offsets: [-3, 3, 10] }),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export async function getOrgSettings(orgId: string): Promise<OrgSettings> {
  const [row] = await sysDb
    .select({ settings: schema.organizations.settings })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));
  const parsed = orgSettingsSchema.safeParse(row?.settings ?? {});
  return parsed.success ? parsed.data : orgSettingsSchema.parse({});
}

export async function updateOrgSettings(
  ctx: OrgContext,
  patch: Partial<OrgSettings>,
): Promise<OrgSettings> {
  authorize(ctx, "settings:write");
  const next = orgSettingsSchema.parse({ ...(await getOrgSettings(ctx.org.id)), ...patch });
  await sysDb
    .update(schema.organizations)
    .set({ settings: next })
    .where(eq(schema.organizations.id, ctx.org.id));
  await audit(sysDb, {
    orgId: ctx.org.id,
    actorId: ctx.user.id,
    action: "org.settings_updated",
    entityType: "organization",
    entityId: ctx.org.id,
    diff: patch,
  });
  return next;
}
