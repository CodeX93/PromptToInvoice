import "server-only";
import pino from "pino";
import { env } from "./env";

/**
 * Structured JSON logs (one line per event) for ingestion by the log
 * pipeline. Secrets are redacted by path so a careless `log.info({ req })`
 * can't leak them.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "pti-web", env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.secret",
      "*.authorization",
      "*.cookie",
      "*.iban",
      "*.accountNumber",
      "headers.authorization",
      "headers.cookie",
    ],
    censor: "[redacted]",
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export type Logger = typeof logger;
