import { apiRoute, idParam } from "@/server/api/handler";
import { clientResource } from "@/server/api/serialize";
import { getClient } from "@/server/services/clients";

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => ({
  body: clientResource(await getClient(ctx, idParam(params.id, "Client"))),
}));
