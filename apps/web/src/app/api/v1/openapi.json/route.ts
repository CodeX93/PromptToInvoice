import { openApiDocument } from "@/server/api/openapi";

/** Public, unauthenticated: the contract integrators generate clients from. */
export function GET(req: Request) {
  return Response.json(openApiDocument(new URL(req.url).origin), {
    headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
  });
}
