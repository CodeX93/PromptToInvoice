import { openApiDocument } from "@/server/api/openapi";

/** Public, unauthenticated: the contract integrators generate clients from. */
export function GET() {
  return Response.json(openApiDocument(), {
    headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
  });
}
