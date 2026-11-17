import "server-only";
import { headers } from "next/headers";
import { schema, type DbOrTx } from "@pti/db";

export interface AuditEntry {
  orgId: string | null;
  actorId: string | null;
  actorType?: "user" | "system" | "api_key" | "webhook";
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: Record<string, unknown>;
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    return { ip: ip && /^[\d.:a-fA-F]+$/.test(ip) ? ip : null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
  } catch {
    // Outside a request (jobs): no headers.
    return { ip: null, userAgent: null };
  }
}

/** Append to the audit trail inside the caller's transaction, so it commits atomically with the change. */
export async function audit(tx: DbOrTx, e: AuditEntry): Promise<void> {
  const meta = await requestMeta();
  await tx.insert(schema.auditLog).values({
    orgId: e.orgId,
    actorId: e.actorId,
    actorType: e.actorType ?? "user",
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    diff: e.diff ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}
