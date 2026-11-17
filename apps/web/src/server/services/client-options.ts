import "server-only";
import { parseEuVatId } from "@pti/core";
import { desc, inArray, ne, schema, sql, withOrg } from "@pti/db";
import { db } from "../db";
import type { OrgContext } from "../session";
import { matchClients } from "./clients";
import type { ClientOption } from "@/app/app/clients/actions";

export async function getClientOptions(ctx: OrgContext, q: string): Promise<ClientOption[]> {
  const c = schema.clients;
  const rows = await withOrg(db, ctx.org.id, async (tx) => {
    if (q.trim()) {
      const ids = (await matchClients(ctx, q, 8)).map((m) => m.id);
      if (ids.length === 0) return [];
      const found = await tx.select().from(c).where(inArray(c.id, ids));
      return ids.map((id) => found.find((f) => f.id === id)).filter((x) => x !== undefined);
    }
    // Most recently invoiced first, then newest.
    return tx
      .select()
      .from(c)
      .where(ne(c.status, "archived"))
      .orderBy(
        sql`(select max(issue_date) from invoices i where i.client_id = ${c.id}) desc nulls last`,
        desc(c.createdAt),
      )
      .limit(8);
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.emails[0] ?? null,
    country: r.address?.country ?? null,
    vatId: r.vatId,
    isBusiness: r.isBusiness,
    vatIdValid: Boolean(r.vatId && (r.vatIdVerifiedAt || parseEuVatId(r.vatId))),
    currency: r.currency,
    paymentTermsDays: r.paymentTermsDays,
  }));
}
