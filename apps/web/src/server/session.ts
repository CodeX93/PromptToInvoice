import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { allows, isPlanId, isRole, type Permission, type PlanId, type Role } from "@pti/core";
import { and, eq, asc, schema } from "@pti/db";
import { auth } from "./auth";
import { sysDb } from "./db";
import { ForbiddenError, UnauthorizedError } from "./errors";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  locale: string;
  timeZone: string;
  twoFactorEnabled: boolean;
}

export interface OrgContext {
  user: CurrentUser;
  sessionId: string;
  org: { id: string; name: string; slug: string; plan: PlanId; timeZone: string; region: string };
  role: Role;
}

/** Session for this request, deduplicated across the render tree. */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

function toUser(u: NonNullable<Awaited<ReturnType<typeof getSession>>>["user"]): CurrentUser {
  const extra = u as typeof u & {
    locale?: string;
    timeZone?: string;
    twoFactorEnabled?: boolean | null;
  };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    locale: extra.locale ?? "en",
    timeZone: extra.timeZone ?? "UTC",
    twoFactorEnabled: Boolean(extra.twoFactorEnabled),
  };
}

/** For pages: signed-in user or redirect to sign-in. */
export const requireUser = cache(
  async (): Promise<{ user: CurrentUser; sessionId: string; activeOrgId: string | null }> => {
    const s = await getSession();
    if (!s) redirect("/sign-in");
    const active =
      (s.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
    return { user: toUser(s.user), sessionId: s.session.id, activeOrgId: active };
  },
);

async function loadMembership(userId: string, preferredOrgId: string | null) {
  const base = sysDb
    .select({
      role: schema.members.role,
      org: {
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        plan: schema.organizations.plan,
        timeZone: schema.organizations.timeZone,
        region: schema.organizations.region,
      },
    })
    .from(schema.members)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.members.organizationId));

  if (preferredOrgId) {
    const [m] = await base
      .where(
        and(eq(schema.members.userId, userId), eq(schema.members.organizationId, preferredOrgId)),
      )
      .limit(1);
    if (m) return m;
  }
  const [first] = await base
    .where(eq(schema.members.userId, userId))
    .orderBy(asc(schema.members.createdAt))
    .limit(1);
  return first ?? null;
}

/**
 * For pages inside the app: user + active organisation + role. Users without
 * an organisation are sent to onboarding. Membership is re-checked against
 * the database on every request; the session's active org is only a hint.
 */
export const requireOrg = cache(async (): Promise<OrgContext> => {
  const { user, sessionId, activeOrgId } = await requireUser();
  const m = await loadMembership(user.id, activeOrgId);
  if (!m) redirect("/onboarding");
  if (!isRole(m.role)) throw new ForbiddenError();
  return {
    user,
    sessionId,
    role: m.role,
    org: { ...m.org, plan: isPlanId(m.org.plan) ? m.org.plan : "starter" },
  };
});

/**
 * For server actions and route handlers: same checks, but throws instead of
 * redirecting so callers can return a typed error.
 */
export async function orgContextOrThrow(): Promise<OrgContext> {
  const s = await getSession();
  if (!s) throw new UnauthorizedError();
  const active =
    (s.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  const m = await loadMembership(s.user.id, active);
  if (!m || !isRole(m.role)) throw new ForbiddenError("You're not a member of this organisation.");
  return {
    user: toUser(s.user),
    sessionId: s.session.id,
    role: m.role,
    org: { ...m.org, plan: isPlanId(m.org.plan) ? m.org.plan : "starter" },
  };
}

export function authorize(ctx: Pick<OrgContext, "role">, permission: Permission): void {
  if (!allows(ctx.role, permission)) throw new ForbiddenError();
}

export function can(ctx: Pick<OrgContext, "role">, permission: Permission): boolean {
  return allows(ctx.role, permission);
}
