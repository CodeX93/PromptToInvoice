"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROLES, seatLimit } from "@pti/core";
import { and, eq, schema, sql } from "@pti/db";
import { auth } from "@/server/auth";
import { sysDb } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, orgContextOrThrow } from "@/server/session";
import { parseOrThrow, run, type ActionResult } from "@/server/action";
import { ForbiddenError, QuotaExceededError } from "@/server/errors";
import { enforce, RULES } from "@/server/rate-limit";
import { revokeKeysCreatedBy } from "@/server/services/api-keys";

const inviteSchema = z.object({
  email: z.email("Enter a valid email.").trim().toLowerCase(),
  role: z.enum(ROLES).exclude(["owner"]),
});

export async function inviteMember(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("team.invite", async () => {
    const ctx = await orgContextOrThrow();
    authorize(ctx, "member:manage");
    await enforce(`invite:${ctx.org.id}`, RULES.sendEmail);
    const input = parseOrThrow(inviteSchema, Object.fromEntries(fd));
    const [{ members, pending } = { members: 0, pending: 0 }] = await sysDb.execute<{
      members: number;
      pending: number;
    }>(sql`
      select
        (select count(*)::int from members where organization_id = ${ctx.org.id}) as members,
        (select count(*)::int from invitations where organization_id = ${ctx.org.id} and status = 'pending' and expires_at > now()) as pending
    `);
    const sub = await sysDb.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.orgId, ctx.org.id),
    });
    const limit = seatLimit(ctx.org.plan, sub?.extraSeats ?? 0);
    if (limit !== null && members + pending >= limit) {
      throw new QuotaExceededError(
        `Your plan includes ${limit} seat${limit === 1 ? "" : "s"}. Upgrade or add seats to invite more people.`,
      );
    }
    await auth.api.createInvitation({
      headers: await headers(),
      body: { email: input.email, role: input.role, organizationId: ctx.org.id },
    });
    await audit(sysDb, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "member.invited",
      entityType: "invitation",
      diff: { email: input.email, role: input.role },
    });
    revalidatePath("/app/settings/team");
  });
}

export async function changeRole(memberId: string, role: string): Promise<ActionResult> {
  return run("team.role", async () => {
    const ctx = await orgContextOrThrow();
    authorize(ctx, "member:manage");
    const r = z.enum(ROLES).parse(role);
    if (r === "owner" && ctx.role !== "owner")
      throw new ForbiddenError("Only owners can make someone an owner.");
    const [m] = await sysDb
      .select()
      .from(schema.members)
      .where(and(eq(schema.members.id, memberId), eq(schema.members.organizationId, ctx.org.id)));
    if (!m) throw new ForbiddenError();
    if (m.role === "owner" && ctx.role !== "owner")
      throw new ForbiddenError("Only owners can change an owner's role.");
    await assertNotLastOwner(ctx.org.id, m, r);
    await sysDb.update(schema.members).set({ role: r }).where(eq(schema.members.id, memberId));
    await audit(sysDb, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "member.role_changed",
      entityType: "member",
      entityId: memberId,
      diff: { from: m.role, to: r },
    });
    revalidatePath("/app/settings/team");
  });
}

export async function removeMember(memberId: string): Promise<ActionResult> {
  return run("team.remove", async () => {
    const ctx = await orgContextOrThrow();
    authorize(ctx, "member:manage");
    const [m] = await sysDb
      .select()
      .from(schema.members)
      .where(and(eq(schema.members.id, memberId), eq(schema.members.organizationId, ctx.org.id)));
    if (!m) throw new ForbiddenError();
    if (m.role === "owner" && ctx.role !== "owner")
      throw new ForbiddenError("Only owners can remove an owner.");
    await assertNotLastOwner(ctx.org.id, m, null);
    await sysDb.delete(schema.members).where(eq(schema.members.id, memberId));
    // Their API keys stop working with them; nothing should act for a former member.
    const revoked = await revokeKeysCreatedBy(ctx.org.id, m.userId);
    // Revoke their sessions' access to this org immediately.
    await sysDb
      .update(schema.sessions)
      .set({ activeOrganizationId: null })
      .where(
        and(
          eq(schema.sessions.userId, m.userId),
          eq(schema.sessions.activeOrganizationId, ctx.org.id),
        ),
      );
    await audit(sysDb, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "member.removed",
      entityType: "member",
      entityId: memberId,
      diff: { userId: m.userId, apiKeysRevoked: revoked },
    });
    revalidatePath("/app/settings/team");
  });
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  return run("team.revoke", async () => {
    const ctx = await orgContextOrThrow();
    authorize(ctx, "member:manage");
    await sysDb
      .update(schema.invitations)
      .set({ status: "canceled" })
      .where(
        and(
          eq(schema.invitations.id, invitationId),
          eq(schema.invitations.organizationId, ctx.org.id),
        ),
      );
    await audit(sysDb, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "member.invitation_revoked",
      entityType: "invitation",
      entityId: invitationId,
    });
    revalidatePath("/app/settings/team");
  });
}

async function assertNotLastOwner(orgId: string, m: { role: string }, nextRole: string | null) {
  if (m.role !== "owner" || nextRole === "owner") return;
  const [{ n } = { n: 0 }] = await sysDb.execute<{ n: number }>(
    sql`select count(*)::int as n from members where organization_id = ${orgId} and role = 'owner'`,
  );
  if (n <= 1)
    throw new ForbiddenError(
      "An organisation needs at least one owner. Make someone else an owner first.",
    );
}
