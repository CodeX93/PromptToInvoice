import "server-only";
import { z } from "zod";
import { addressSchema, currencySchema, emailSchema, normalizeVatId, parseEuVatId } from "@pti/core";
import { and, asc, eq, ne, one, schema, sql, withOrg, type SQL } from "@pti/db";
import { db } from "../db";
import { audit } from "../audit";
import { authorize, type OrgContext } from "../session";
import { NotFound } from "../errors";
import { checkVies, type ViesResult } from "../vies";

const blankToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Enter the client's name.").max(160),
  contactName: blankToNull(120),
  emails: z.array(emailSchema).max(5).default([]),
  phone: blankToNull(40),
  address: addressSchema.nullish(),
  isBusiness: z.boolean().default(true),
  vatId: z
    .string()
    .trim()
    .max(40)
    .transform((v) => (v ? normalizeVatId(v) : null))
    .nullish(),
  taxId: blankToNull(40),
  currency: currencySchema.nullish(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).nullish(),
  language: blankToNull(10),
  buyerReference: blankToNull(100),
  notes: z.string().trim().max(4000).default(""),
});
export type ClientInput = z.infer<typeof clientSchema>;

export type ClientRow = typeof schema.clients.$inferSelect;

export interface ClientListItem {
  id: string;
  name: string;
  email: string | null;
  country: string | null;
  vatId: string | null;
  vatVerified: boolean;
  status: string;
  /** Outstanding per currency, minor units. */
  outstanding: { currency: string; amount: number }[];
  invoiceCount: number;
  lastInvoiceDate: string | null;
}

export interface ListClientsArgs {
  q?: string;
  status?: "active" | "archived";
  /** Opaque cursor: base64url JSON of [name, id]. */
  cursor?: string;
  limit?: number;
}

function decodeCursor(c: string | undefined): [string, string] | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString()) as unknown;
    return Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "string" ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

/**
 * Keyset-paginated client list with per-currency outstanding balances,
 * computed in one round-trip (lateral aggregate) instead of N+1 queries.
 */
export async function listClients(ctx: OrgContext, args: ListClientsArgs = {}) {
  const limit = Math.min(args.limit ?? 50, 100);
  const c = schema.clients;
  const where: SQL[] = [eq(c.status, args.status ?? "active")];
  const q = args.q?.trim();
  if (q) where.push(sql`(${c.name} ilike ${"%" + q.replace(/[%_\\]/g, "\\$&") + "%"} or ${c.vatId} ilike ${q + "%"} or ${q} = any(${c.emails}))`);
  const cur = decodeCursor(args.cursor);
  if (cur) where.push(sql`(${c.name}, ${c.id}) > (${cur[0]}, ${cur[1]}::uuid)`);

  const rows = await withOrg(db, ctx.org.id, (tx) =>
    tx
      .select({
        id: c.id,
        name: c.name,
        emails: c.emails,
        address: c.address,
        vatId: c.vatId,
        vatIdVerifiedAt: c.vatIdVerifiedAt,
        status: c.status,
        stats: sql<{ outstanding: { currency: string; amount: number }[] | null; count: number; last: string | null }>`(
          select json_build_object(
            'outstanding', (select json_agg(json_build_object('currency', o.currency, 'amount', o.amt)) from (
              select currency, sum(total - amount_paid)::bigint as amt from invoices
              where client_id = ${c.id} and status = 'open' and doc_type = 'invoice' group by currency
            ) o where o.amt > 0),
            'count', (select count(*) from invoices where client_id = ${c.id} and status <> 'draft'),
            'last', (select max(issue_date) from invoices where client_id = ${c.id} and status <> 'draft')
          ))`,
      })
      .from(c)
      .where(and(...where))
      .orderBy(asc(c.name), asc(c.id))
      .limit(limit + 1),
  );

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(
      (r): ClientListItem => ({
        id: r.id,
        name: r.name,
        email: r.emails[0] ?? null,
        country: r.address?.country ?? null,
        vatId: r.vatId,
        vatVerified: Boolean(r.vatIdVerifiedAt),
        status: r.status,
        outstanding: (r.stats.outstanding ?? []).map((o) => ({ currency: o.currency, amount: Number(o.amount) })),
        invoiceCount: Number(r.stats.count),
        lastInvoiceDate: r.stats.last,
      }),
    ),
    nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.name, last.id])).toString("base64url") : null,
  };
}

export async function getClient(ctx: OrgContext, id: string): Promise<ClientRow> {
  const [row] = await withOrg(db, ctx.org.id, (tx) => tx.select().from(schema.clients).where(eq(schema.clients.id, id)).limit(1));
  if (!row) throw new NotFound("Client");
  return row;
}

export async function createClient(ctx: OrgContext, input: ClientInput, status: "active" | "pending" = "active"): Promise<ClientRow> {
  authorize(ctx, "client:write");
  return withOrg(db, ctx.org.id, async (tx) => {
    const row = one(await tx.insert(schema.clients).values({ orgId: ctx.org.id, ...input, status }).returning());
    await audit(tx, { orgId: ctx.org.id, actorId: ctx.user.id, action: "client.created", entityType: "client", entityId: row.id });
    return row;
  });
}

export async function updateClient(ctx: OrgContext, id: string, input: ClientInput): Promise<void> {
  authorize(ctx, "client:write");
  await withOrg(db, ctx.org.id, async (tx) => {
    const before = one(await tx.select().from(schema.clients).where(eq(schema.clients.id, id)), "Client");
    const vatChanged = (before.vatId ?? null) !== (input.vatId ?? null);
    await tx
      .update(schema.clients)
      .set({ ...input, status: before.status === "pending" ? "active" : before.status, ...(vatChanged && { vatIdVerifiedAt: null, vatIdVerifiedName: null }) })
      .where(eq(schema.clients.id, id));
    await audit(tx, { orgId: ctx.org.id, actorId: ctx.user.id, action: "client.updated", entityType: "client", entityId: id });
  });
}

export async function setClientArchived(ctx: OrgContext, id: string, archived: boolean): Promise<void> {
  authorize(ctx, "client:write");
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx.update(schema.clients).set({ status: archived ? "archived" : "active" }).where(eq(schema.clients.id, id));
    await audit(tx, { orgId: ctx.org.id, actorId: ctx.user.id, action: archived ? "client.archived" : "client.restored", entityType: "client", entityId: id });
  });
}

/** Verify the client's VAT number with VIES and record the outcome. */
export async function verifyClientVat(ctx: OrgContext, id: string): Promise<ViesResult> {
  authorize(ctx, "client:write");
  const client = await getClient(ctx, id);
  if (!client.vatId) return { status: "malformed" };
  const result = await checkVies(client.vatId);
  if (result.status === "valid" || result.status === "invalid") {
    await withOrg(db, ctx.org.id, async (tx) => {
      await tx
        .update(schema.clients)
        .set(result.status === "valid" ? { vatIdVerifiedAt: result.checkedAt, vatIdVerifiedName: result.name } : { vatIdVerifiedAt: null, vatIdVerifiedName: null })
        .where(eq(schema.clients.id, id));
      await audit(tx, { orgId: ctx.org.id, actorId: ctx.user.id, action: "client.vat_checked", entityType: "client", entityId: id, diff: { result: result.status } });
    });
  }
  return result;
}

export interface ClientMatch {
  id: string;
  name: string;
  score: number;
}

/**
 * Fuzzy name match using pg_trgm similarity (GIN-indexed). Used by the AI
 * draft resolver and the client picker; returns the best few candidates.
 */
export async function matchClients(ctx: OrgContext, name: string, limit = 5): Promise<ClientMatch[]> {
  const n = name.trim();
  if (!n) return [];
  const c = schema.clients;
  const rows = await withOrg(db, ctx.org.id, (tx) =>
    tx
      .select({ id: c.id, name: c.name, score: sql<number>`greatest(similarity(${c.name}, ${n}), word_similarity(${n}, ${c.name}))` })
      .from(c)
      .where(and(ne(c.status, "archived"), sql`(${c.name} % ${n} or ${c.name} ilike ${"%" + n.replace(/[%_\\]/g, "\\$&") + "%"})`))
      .orderBy(sql`3 desc`)
      .limit(limit),
  );
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

/** Is reverse charge applicable for this client (EU B2B, other member state, verified VAT ID)? */
export function clientTaxContext(client: Pick<ClientRow, "isBusiness" | "vatId" | "vatIdVerifiedAt" | "address">) {
  return {
    buyerCountry: client.address?.country ?? null,
    buyerIsBusiness: client.isBusiness,
    // An unverified-but-well-formed EU VAT ID still counts; VIES outages shouldn't block invoicing.
    buyerVatIdValid: Boolean(client.vatId && (client.vatIdVerifiedAt || parseEuVatId(client.vatId))),
  };
}
