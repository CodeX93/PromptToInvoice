import "server-only";

/**
 * Domain errors with a stable machine code and an HTTP status. Route
 * handlers and server actions translate them into problem+json / form state;
 * anything else becomes a 500 with no internals leaked.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super("validation_failed", message, 422, { fieldErrors });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue.") {
    super("unauthorized", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super("forbidden", message, 403);
  }
}

export class NotFound extends AppError {
  constructor(what = "Resource") {
    super("not_found", `${what} not found.`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super(code, message, 409);
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("quota_exceeded", message, 402, details);
  }
}

export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("rate_limited", "Too many requests. Please slow down.", 429, { retryAfterSeconds });
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
