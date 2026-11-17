import "server-only";
import type { z } from "zod";
import { CalculationError, LifecycleError } from "@pti/core";
import { PG, pgErrorCode } from "@pti/db";
import { isAppError, ValidationError } from "./errors";
import { logger } from "./logger";

/**
 * Result shape for server actions. Actions never throw to the client: they
 * return a discriminated union the form can render (field errors, banner),
 * and unexpected failures are logged with a correlation id.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]>; ref?: string };



export function fieldErrorsFromZod(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError("Please check the highlighted fields.", fieldErrorsFromZod(r.error));
  return r.data;
}

export function toActionError(err: unknown, context: string): ActionResult<never> {
  if (err instanceof ValidationError) {
    return { ok: false, code: err.code, error: err.message, fieldErrors: err.fieldErrors };
  }
  if (isAppError(err)) return { ok: false, code: err.code, error: err.message };
  if (err instanceof CalculationError) {
    return { ok: false, code: "invalid_amounts", error: err.message, fieldErrors: { [err.path.join(".")]: [err.message] } };
  }
  if (err instanceof LifecycleError) return { ok: false, code: "invalid_state", error: err.message };
  if (pgErrorCode(err) === PG.raiseException) {
    return { ok: false, code: "integrity", error: "This document is locked because it has been issued." };
  }
  // Next.js navigation (redirect/notFound) is signalled by throwing; let it propagate.
  if (err instanceof Error && "digest" in err && typeof err.digest === "string" && err.digest.startsWith("NEXT_")) {
    throw err;
  }
  const ref = crypto.randomUUID().slice(0, 8);
  logger.error({ err, context, ref }, "action failed");
  return { ok: false, code: "internal", error: `Something went wrong. Reference ${ref}.`, ref };
}

/** Wrap an action body: returns ActionResult, never throws (except navigation). */
export async function run<T>(context: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return toActionError(err, context);
  }
}
