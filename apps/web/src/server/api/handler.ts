import "server-only";
import { createHash } from "node:crypto";
import { and, eq, schema } from "@pti/db";
import type { z } from "zod";
import { sysDb } from "../db";
import {
  AppError,
  ConflictError,
  isAppError,
  NotFound,
  RateLimitedError,
  ValidationError,
} from "../errors";
import { logger } from "../logger";
import { hit, RULES } from "../rate-limit";
import type { OrgContext } from "../session";
import { authenticateApiKey } from "../services/api-keys";

export type ApiContext = OrgContext & { apiKeyId: string };

/** What a handler returns: a JSON body (status defaults to 200) or a raw Response. */
export type ApiResult = { status?: number; body: unknown } | Response;

type Handler<P> = (args: {
  ctx: ApiContext;
  req: Request;
  params: P;
  /** Parsed JSON body (POST/PATCH); `undefined` for other methods. */
  body: unknown;
}) => Promise<ApiResult>;

const IDEMPOTENCY_KEY = /^[\w.:-]{8,200}$/;
const MAX_BODY = 256 * 1024;

/** RFC 9457 problem details. `code` is stable; `detail` is for humans. */
export function problem(
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    {
      type: `https://prompttoinvoice.com/docs/api/errors#${code}`,
      title: code,
      status,
      detail,
      ...extra,
    },
    { status, headers: { "content-type": "application/problem+json", ...headers } },
  );
}

function toProblem(err: unknown, requestId: string): Response {
  if (err instanceof RateLimitedError)
    return problem(
      429,
      err.code,
      err.message,
      {},
      { "retry-after": String(err.retryAfterSeconds) },
    );
  if (err instanceof ValidationError)
    return problem(422, err.code, err.message, { errors: err.fieldErrors });
  if (isAppError(err)) return problem(err.status, err.code, err.message, err.details ?? {});
  logger.error({ err, requestId }, "api request failed");
  return problem(500, "internal_error", "Something went wrong on our side.", { requestId });
}

async function readJson(req: Request): Promise<{ raw: string; value: unknown }> {
  const raw = await req.text();
  if (raw.length > MAX_BODY)
    throw new AppError("payload_too_large", "Request body is too large.", 413);
  if (!raw) return { raw, value: {} };
  if (!(req.headers.get("content-type") ?? "").includes("json"))
    throw new AppError(
      "unsupported_media_type",
      "Send JSON with Content-Type: application/json.",
      415,
    );
  try {
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    throw new AppError("invalid_json", "The request body isn't valid JSON.", 400);
  }
}

export function parse<S extends z.ZodType>(s: S, v: unknown): z.output<S> {
  const r = s.safeParse(v);
  if (r.success) return r.data;
  const fe: Record<string, string[]> = {};
  for (const i of r.error.issues) (fe[i.path.join(".") || "_"] ??= []).push(i.message);
  throw new ValidationError("The request has invalid fields.", fe);
}

/**
 * Stripe-style idempotency. The first request with a key claims it (insert
 * … on conflict do nothing); retries replay the stored response. The same
 * key with a different payload is a client bug and gets a 422. 5xx results
 * release the key so the client can retry; everything else is final.
 */
async function withIdempotency(
  orgId: string,
  key: string,
  fingerprint: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const K = schema.idempotencyKeys;
  const claimed = await sysDb
    .insert(K)
    .values({ orgId, key, requestHash: fingerprint })
    .onConflictDoNothing()
    .returning({ key: K.key });
  if (!claimed.length) {
    const [prev] = await sysDb
      .select()
      .from(K)
      .where(and(eq(K.orgId, orgId), eq(K.key, key)));
    if (prev && prev.requestHash !== fingerprint)
      return problem(
        422,
        "idempotency_mismatch",
        "This Idempotency-Key was used with a different request.",
      );
    if (prev?.responseStatus == null)
      throw new ConflictError(
        "A request with this Idempotency-Key is still in progress.",
        "idempotency_in_progress",
      );
    return Response.json(prev.responseBody, {
      status: prev.responseStatus,
      headers: { "idempotent-replayed": "true" },
    });
  }
  const where = and(eq(K.orgId, orgId), eq(K.key, key));
  let res: Response;
  try {
    res = await run();
  } catch (err) {
    await sysDb.delete(K).where(where);
    throw err;
  }
  if (res.status >= 500 || !(res.headers.get("content-type") ?? "").includes("json")) {
    await sysDb.delete(K).where(where);
    return res;
  }
  const body: unknown = await res.clone().json();
  await sysDb.update(K).set({ responseStatus: res.status, responseBody: body }).where(where);
  return res;
}

/**
 * Wrap a route handler with the public-API contract: bearer key auth,
 * per-key rate limiting with standard headers, JSON parsing, idempotent
 * POSTs and problem+json errors. Handlers only express the operation.
 */
export function apiRoute<P extends Record<string, string> = Record<string, never>>(
  handler: Handler<P>,
) {
  return async (req: Request, route: { params: Promise<P> }): Promise<Response> => {
    const requestId = crypto.randomUUID();
    let limitHeaders: Record<string, string> = {};
    try {
      const auth = req.headers.get("authorization");
      const ctx = await authenticateApiKey(auth?.replace(/^Bearer\s+/i, "") ?? null);
      const rl = await hit(`api:${ctx.apiKeyId}`, RULES.api);
      limitHeaders = {
        "x-ratelimit-limit": String(RULES.api.limit),
        "x-ratelimit-remaining": String(rl.remaining),
        "x-ratelimit-reset": String(rl.resetIn),
      };
      if (!rl.allowed) throw new RateLimitedError(rl.resetIn);

      const params = await route.params;
      const mutating = req.method === "POST" || req.method === "PATCH";
      const { raw, value } = mutating ? await readJson(req) : { raw: "", value: undefined };
      const exec = async () => {
        const out = await handler({ ctx, req, params, body: value });
        return out instanceof Response
          ? out
          : Response.json(out.body, { status: out.status ?? 200 });
      };

      const idemKey = mutating ? req.headers.get("idempotency-key") : null;
      if (idemKey !== null && !IDEMPOTENCY_KEY.test(idemKey))
        throw new AppError(
          "invalid_idempotency_key",
          "Idempotency-Key must be 8–200 characters of [A-Za-z0-9_.:-].",
          400,
        );
      const fingerprint = createHash("sha256")
        .update(`${req.method} ${new URL(req.url).pathname}\n${raw}`)
        .digest("hex");
      const res = idemKey
        ? await withIdempotency(ctx.org.id, idemKey, fingerprint, exec)
        : await exec();
      for (const [k, v] of Object.entries(limitHeaders)) res.headers.set(k, v);
      res.headers.set("x-request-id", requestId);
      return res;
    } catch (err) {
      const res = toProblem(err, requestId);
      for (const [k, v] of Object.entries(limitHeaders)) res.headers.set(k, v);
      res.headers.set("x-request-id", requestId);
      return res;
    }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path ids that aren't UUIDs can't exist; answer 404 before touching the database. */
export function idParam(id: string, what: string): string {
  if (!UUID.test(id)) throw new NotFound(what);
  return id.toLowerCase();
}
