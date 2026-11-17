import type { Metadata } from "next";
import { formatDate, isRole, seatLimit, type Role } from "@pti/core";
import { and, asc, eq, gt, schema } from "@pti/db";
import { Section } from "@/components/ui/section";
import { sysDb } from "@/server/db";
import { requireOrg, can } from "@/server/session";
import { TeamView } from "./team-view";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireOrg();
  const [members, invites, sub] = await Promise.all([
    sysDb
      .select({
        id: schema.members.id,
        role: schema.members.role,
        createdAt: schema.members.createdAt,
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.members.organizationId, ctx.org.id))
      .orderBy(asc(schema.members.createdAt)),
    sysDb
      .select()
      .from(schema.invitations)
      .where(
        and(
          eq(schema.invitations.organizationId, ctx.org.id),
          eq(schema.invitations.status, "pending"),
          gt(schema.invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(schema.invitations.createdAt)),
    sysDb.query.subscriptions.findFirst({ where: eq(schema.subscriptions.orgId, ctx.org.id) }),
  ]);
  const limit = seatLimit(ctx.org.plan, sub?.extraSeats ?? 0);
  const used = members.length + invites.length;
  const role = (r: string): Role => (isRole(r) ? r : "member");

  return (
    <Section
      title="Team"
      description="Members can create and send invoices. Accountants get read-only access plus exports. Admins manage settings and people."
    >
      <TeamView
        canManage={can(ctx, "member:manage")}
        seats={
          limit === null
            ? `${used} seats in use`
            : `${used} of ${limit} seat${limit === 1 ? "" : "s"} in use`
        }
        members={members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          role: role(m.role),
          isSelf: m.userId === ctx.user.id,
          since: formatDate(m.createdAt.toISOString().slice(0, 10)),
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: role(i.role),
          expires: formatDate(i.expiresAt.toISOString().slice(0, 10)),
        }))}
      />
    </Section>
  );
}
