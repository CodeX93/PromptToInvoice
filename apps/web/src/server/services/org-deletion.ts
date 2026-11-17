import "server-only";
import { and, eq, isNull, schema, sql } from "@pti/db";
import { sysDb } from "../db";
import { audit } from "../audit";
import { ForbiddenError, ValidationError } from "../errors";
import { logger } from "../logger";
import { authorize, type OrgContext } from "../session";
import { stripeClient } from "./stripe";
import { subscriptionFor } from "./billing";
import { features } from "../env";

/**
 * Delete an organisation (GDPR Art. 17) while honouring bookkeeping law:
 * everything is removed except issued invoices, credit notes, their
 * payments and archived PDFs, which stay under legal hold (read-only,
 * inaccessible to members) until their retention date, then the purge job
 * removes them. Clients referenced by issued documents are kept only as
 * the frozen snapshot inside those documents.
 */
export async function deleteOrganization(ctx: OrgContext, confirmName: string): Promise<void> {
  authorize(ctx, "org:delete");
  if (confirmName.trim() !== ctx.org.name) throw new ValidationError("Type the organisation name exactly to confirm.", { confirm: ["Doesn't match."] });

  const sub = await subscriptionFor(ctx.org.id);
  if (sub?.stripeSubscriptionId && features.stripe && sub.status !== "canceled") {
    await stripeClient().subscriptions.cancel(sub.stripeSubscriptionId).catch((err: unknown) => logger.error({ err }, "subscription cancel failed"));
  }

  await sysDb.transaction(async (tx) => {
    const id = ctx.org.id;
    await tx.execute(sql`delete from invoices where org_id = ${id} and status = 'draft'`);
    await tx.execute(sql`delete from recurring_schedules where org_id = ${id}`);
    await tx.execute(sql`delete from ai_drafts where org_id = ${id}`);
    await tx.execute(sql`delete from email_messages where org_id = ${id}`);
    await tx.execute(sql`delete from catalog_items where org_id = ${id}`);
    await tx.execute(sql`update clients set emails = '{}', phone = null, notes = '', contact_name = null where org_id = ${id}`);
    await tx.execute(sql`delete from clients c where c.org_id = ${id} and not exists (select 1 from invoices i where i.client_id = c.id)`);
    await tx.execute(sql`delete from files where org_id = ${id} and kind in ('logo','export','attachment')`);
    await tx.update(schema.sessions).set({ activeOrganizationId: null }).where(eq(schema.sessions.activeOrganizationId, id));
    await tx.delete(schema.invitations).where(eq(schema.invitations.organizationId, id));
    await tx.delete(schema.members).where(eq(schema.members.organizationId, id));
    await tx.update(schema.organizations).set({ deletedAt: new Date(), settings: {} }).where(and(eq(schema.organizations.id, id), isNull(schema.organizations.deletedAt)));
    await audit(tx, { orgId: id, actorId: ctx.user.id, action: "org.deleted", entityType: "organization", entityId: id });
  });
}

/** Guard for account deletion: an owner can't orphan an organisation that has other members. */
export async function assertCanDeleteUser(userId: string): Promise<void> {
  const owned = await sysDb.execute<{ org: string; name: string; others: number; owners: number }>(sql`
    select o.id as org, o.name,
      (select count(*)::int from members x where x.organization_id = o.id and x.user_id <> ${userId}) as others,
      (select count(*)::int from members x where x.organization_id = o.id and x.role = 'owner') as owners
    from members m join organizations o on o.id = m.organization_id
    where m.user_id = ${userId} and m.role = 'owner' and o.deleted_at is null
  `);
  const blocking = owned.find((o) => o.owners === 1);
  if (blocking) {
    throw new ForbiddenError(
      blocking.others > 0
        ? `You're the only owner of ${blocking.name}. Make someone else an owner first.`
        : `Delete the organisation ${blocking.name} first (Settings → Danger zone), then your account.`,
    );
  }
}
