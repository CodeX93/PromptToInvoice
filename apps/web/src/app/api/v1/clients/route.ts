import { apiRoute, parse } from "@/server/api/handler";
import { createClientFromApi } from "@/server/api/operations";
import { apiClientCreate, apiClientList, queryOf } from "@/server/api/schemas";
import { clientResource } from "@/server/api/serialize";
import { listClients } from "@/server/services/clients";

export const GET = apiRoute(async ({ ctx, req }) => {
  const q = parse(apiClientList, queryOf(req));
  const page = await listClients(ctx, q);
  return {
    body: {
      object: "list",
      data: page.items.map((c) => ({
        object: "client",
        id: c.id,
        name: c.name,
        email: c.email,
        country: c.country,
        vat_id: c.vatId,
        vat_id_verified: c.vatVerified,
        status: c.status,
        outstanding: c.outstanding,
      })),
      next_cursor: page.nextCursor,
    },
  };
});

export const POST = apiRoute(async ({ ctx, body }) => ({
  status: 201,
  body: clientResource(await createClientFromApi(ctx, parse(apiClientCreate, body))),
}));
