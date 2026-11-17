import "server-only";
import { randomBytes } from "node:crypto";
import { hasFeature, isPlanId } from "@pti/core";
import { and, desc, eq, isNull, schema, withOrg } from "@pti/db";
import { db, sysDb } from "../db";
import { audit } from "../audit";
import { safeEqual, sha256 } from "../crypto";
import { ForbiddenError, UnauthorizedError, ValidationError } from "../errors";
import { authorize, type OrgContext } from "../session";
import { systemContext } from "../jobs/system-context";

const KEY_RE = /^pti_live_([a-z0-9]{10})_([A-Za-z0-9_-]{32,})$/;

/** Create a key; the plaintext is returned exactly once. */
export async function createApiKey(
  ctx: OrgContext,
  name: string,
): Promise<{ id: string; key: string }> {
  authorize(ctx, "apikey:manage");
  if (!hasFeature(ctx.org.plan, "api"))
    throw new ForbiddenError("API access is part of the Enterprise plan.");
  const label = name.trim().slice(0, 60);
  if (!label) throw new ValidationError("Name the key.", { name: ["Required."] });
  const prefix = randomBytes(8).toString("hex").slice(0, 10);
  const secret = randomBytes(24).toString("base64url");
  const key = `pti_live_${prefix}_${secret}`;
  const id = await withOrg(db, ctx.org.id, async (tx) => {
    const [row] = await tx
      .insert(schema.apiKeys)
      .values({ orgId: ctx.org.id, name: label, prefix, hash: sha256(key), createdBy: ctx.user.id })
      .returning({ id: schema.apiKeys.id });
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "api_key.created",
      entityType: "api_key",
      entityId: row?.id,
      diff: { name: label, prefix },
    });
    return row?.id ?? "";
  });
  return { id, key };
}

export async function listApiKeys(ctx: OrgContext) {
  authorize(ctx, "apikey:manage");
  return withOrg(db, ctx.org.id, (tx) =>
    tx
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        prefix: schema.apiKeys.prefix,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(isNull(schema.apiKeys.revokedAt))
      .orderBy(desc(schema.apiKeys.createdAt)),
  );
}

export async function revokeApiKey(ctx: OrgContext, id: string): Promise<void> {
  authorize(ctx, "apikey:manage");
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.id, id));
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "api_key.revoked",
      entityType: "api_key",
      entityId: id,
    });
  });
}

/**
 * Resolve a bearer key to an OrgContext. The key acts as the member who
 * created it, with "member" permissions: it can create, issue and send
 * invoices, but never manage people, billing or settings.
 */
export async function authenticateApiKey(
  raw: string | null,
): Promise<OrgContext & { apiKeyId: string }> {
  const m = raw ? KEY_RE.exec(raw.trim()) : null;
  if (!m?.[1])
    throw new UnauthorizedError("Provide a valid API key: Authorization: Bearer pti_live_…");
  const [row] = await sysDb
    .select({
      id: schema.apiKeys.id,
      orgId: schema.apiKeys.orgId,
      hash: schema.apiKeys.hash,
      createdBy: schema.apiKeys.createdBy,
      plan: schema.organizations.plan,
      deletedAt: schema.organizations.deletedAt,
    })
    .from(schema.apiKeys)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.apiKeys.orgId))
    .where(and(eq(schema.apiKeys.prefix, m[1]), isNull(schema.apiKeys.revokedAt)))
    .limit(1);
  // Hash comparison is constant time; unknown prefixes take the same path.
  const expected = row?.hash ?? sha256("pti_invalid");
  if (!safeEqual(sha256(raw?.trim() ?? ""), expected) || !row || row.deletedAt)
    throw new UnauthorizedError("Invalid or revoked API key.");
  if (!isPlanId(row.plan) || !hasFeature(row.plan, "api"))
    throw new ForbiddenError("API access is part of the Enterprise plan.");
  // The creator may have left the organisation since; fall back to an owner as the acting member.
  const ctx = await systemContext(row.orgId, row.createdBy).catch(() => systemContext(row.orgId));
  void sysDb
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.id))
    .catch(() => undefined);
  return { ...ctx, role: "member", sessionId: `api:${row.id}`, apiKeyId: row.id };
}
