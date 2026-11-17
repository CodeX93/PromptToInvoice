import "server-only";
import { z } from "zod";

/**
 * Validated server environment. Parsed once at startup; a misconfigured
 * deployment fails fast with a readable list of problems instead of a
 * runtime error deep inside a request.
 */
const optional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),

    DATABASE_URL: z.string().min(1),
    SYSTEM_DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** Set when connecting through a transaction-mode pooler (PgBouncer, Neon pooler). */
    DATABASE_DISABLE_PREPARE: z.stringbool().default(false),

    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    /** 32-byte key, base64. Encrypts bank details at rest. Rotate via ENCRYPTION_KEYS_OLD. */
    ENCRYPTION_KEY: z
      .base64()
      .refine(
        (v) => Buffer.from(v, "base64").length === 32,
        "ENCRYPTION_KEY must decode to 32 bytes",
      ),
    ENCRYPTION_KEYS_OLD: optional,

    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    MICROSOFT_CLIENT_ID: optional,
    MICROSOFT_CLIENT_SECRET: optional,

    ANTHROPIC_API_KEY: optional,
    /** "stub" = deterministic offline extractor for local dev / e2e; refused in production. */
    AI_PROVIDER: z.enum(["anthropic", "stub"]).default("anthropic"),
    AI_MODEL: z.string().default("claude-opus-5-5"),

    STRIPE_SECRET_KEY: optional,
    STRIPE_WEBHOOK_SECRET: optional,
    STRIPE_CONNECT_WEBHOOK_SECRET: optional,
    /** Platform fee on invoice payments in basis points (50 = 0.5%). */
    STRIPE_APPLICATION_FEE_BPS: z.coerce.number().int().min(0).max(500).default(0),

    EMAIL_PROVIDER: z.enum(["log", "smtp", "postmark"]).default("log"),
    EMAIL_FROM: z.string().default("PromptToInvoice <invoices@localhost>"),
    SMTP_URL: optional,
    POSTMARK_SERVER_TOKEN: optional,
    POSTMARK_WEBHOOK_SECRET: optional,

    STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
    STORAGE_FS_ROOT: z.string().default(".data/files"),
    S3_BUCKET: optional,
    S3_REGION: optional,
    S3_ENDPOINT: optional,
    S3_ACCESS_KEY_ID: optional,
    S3_SECRET_ACCESS_KEY: optional,

    TURNSTILE_SITE_KEY: optional,
    TURNSTILE_SECRET_KEY: optional,
    SENTRY_DSN: optional,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    const need = (cond: boolean, keys: string[], why: string) => {
      if (!cond) return;
      for (const k of keys) {
        if (!env[k as keyof typeof env])
          ctx.addIssue({ code: "custom", path: [k], message: `required ${why}` });
      }
    };
    need(env.EMAIL_PROVIDER === "smtp", ["SMTP_URL"], "when EMAIL_PROVIDER=smtp");
    need(
      env.EMAIL_PROVIDER === "postmark",
      ["POSTMARK_SERVER_TOKEN"],
      "when EMAIL_PROVIDER=postmark",
    );
    need(env.STORAGE_DRIVER === "s3", ["S3_BUCKET", "S3_REGION"], "when STORAGE_DRIVER=s3");
    need(!!env.STRIPE_SECRET_KEY, ["STRIPE_WEBHOOK_SECRET"], "when Stripe is enabled");
    if (env.NODE_ENV === "production" && env.AI_PROVIDER === "stub") {
      ctx.addIssue({
        code: "custom",
        path: ["AI_PROVIDER"],
        message: "the stub extractor is not allowed in production",
      });
    }
    if (env.NODE_ENV === "production" && env.EMAIL_PROVIDER === "log") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER"],
        message: "log provider is not allowed in production",
      });
    }
  });

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}

export const env: Env = load();

export const features = {
  ai: env.AI_PROVIDER === "stub" || Boolean(env.ANTHROPIC_API_KEY),
  stripe: Boolean(env.STRIPE_SECRET_KEY),
  google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
  turnstile: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY),
} as const;
