import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

const handler = toNextJsHandler(auth);

/**
 * The organisation plugin exposes endpoints (invite, change role, remove,
 * delete org…) that would bypass the app's own services: seat limits, the
 * last-owner rule, audit log, Stripe cancellation and legal-hold deletion.
 * The app calls those through `auth.api` on the server after its checks, so
 * over HTTP only the invitee's own actions are allowed.
 */
const PUBLIC_ORG_ENDPOINTS = new Set(["accept-invitation", "reject-invitation"]);

function blocked(req: Request): boolean {
  const m = /\/api\/auth\/organization\/([^/?#]+)/.exec(new URL(req.url).pathname);
  return Boolean(m?.[1] && !PUBLIC_ORG_ENDPOINTS.has(m[1]));
}

const notFound = () => Response.json({ code: "NOT_FOUND" }, { status: 404 });

export const GET = (req: Request) => (blocked(req) ? notFound() : handler.GET(req));
export const POST = (req: Request) => (blocked(req) ? notFound() : handler.POST(req));
