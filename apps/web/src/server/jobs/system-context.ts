import "server-only";
import { isPlanId } from "@pti/core";
import { and, asc, eq, schema } from "@pti/db";
import { sysDb } from "../db";
import type { OrgContext } from "../session";

/**
 * An OrgContext for background work. It acts as the given user (e.g. who
 * clicked "send") or, for scheduled work, as the organisation's first owner,
 * so audit trails always name a real person.
 */
export async function systemContext(orgId: string, actorId?: string | null): Promise<OrgContext> {
  const [org] = await sysDb
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));
  if (!org) throw new Error(`organisation ${orgId} not found`);
  const [m] = await sysDb
    .select({
      userId: schema.members.userId,
      name: schema.users.name,
      email: schema.users.email,
      tz: schema.users.timeZone,
    })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(
      actorId
        ? and(eq(schema.members.organizationId, orgId), eq(schema.members.userId, actorId))
        : and(eq(schema.members.organizationId, orgId), eq(schema.members.role, "owner")),
    )
    .orderBy(asc(schema.members.createdAt))
    .limit(1);
  if (!m) throw new Error(`no acting member for organisation ${orgId}`);
  return {
    user: {
      id: m.userId,
      name: m.name,
      email: m.email,
      image: null,
      locale: "en",
      timeZone: m.tz,
      twoFactorEnabled: false,
    },
    sessionId: "system",
    role: "owner",
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: isPlanId(org.plan) ? org.plan : "starter",
      timeZone: org.timeZone,
      region: org.region,
    },
  };
}
