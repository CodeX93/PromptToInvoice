import "server-only";
import { PgBoss } from "pg-boss";
import { env } from "../env";
import { logger } from "../logger";

/**
 * Durable background jobs on Postgres (pg-boss): retries with backoff,
 * singleton keys for idempotency, cron schedules — no extra infrastructure.
 * The web process only *sends*; the worker process (worker.ts) consumes.
 */
export interface JobPayloads {
  "invoice.send": {
    orgId: string;
    invoiceId: string;
    actorId: string;
    to: string[];
    cc: string[];
    message: string;
    emailId: string;
  };
  "invoice.archive-pdf": { orgId: string; invoiceId: string };
  "stripe.event": { eventId: string; account: string | null };
  "reminders.scan": Record<string, never>;
  "reminders.send": { orgId: string; invoiceId: string; offset: number };
  "recurring.scan": Record<string, never>;
  "recurring.run": { orgId: string; scheduleId: string; runOn: string };
  "maintenance.purge": Record<string, never>;
  "org.export": { orgId: string; requestedBy: string };
  "fx.refresh": Record<string, never>;
}
export type JobName = keyof JobPayloads;

export const QUEUES: { name: JobName; retryLimit: number; expireInSeconds: number }[] = [
  { name: "invoice.send", retryLimit: 5, expireInSeconds: 120 },
  { name: "invoice.archive-pdf", retryLimit: 8, expireInSeconds: 120 },
  { name: "stripe.event", retryLimit: 10, expireInSeconds: 60 },
  { name: "reminders.scan", retryLimit: 2, expireInSeconds: 300 },
  { name: "reminders.send", retryLimit: 5, expireInSeconds: 120 },
  { name: "recurring.scan", retryLimit: 2, expireInSeconds: 300 },
  { name: "recurring.run", retryLimit: 5, expireInSeconds: 300 },
  { name: "maintenance.purge", retryLimit: 2, expireInSeconds: 900 },
  { name: "org.export", retryLimit: 3, expireInSeconds: 900 },
  { name: "fx.refresh", retryLimit: 5, expireInSeconds: 120 },
];

const g = globalThis as typeof globalThis & { __ptiBoss?: Promise<PgBoss> };

export function boss(opts: { worker?: boolean } = {}): Promise<PgBoss> {
  g.__ptiBoss ??= (async () => {
    const b = new PgBoss({
      connectionString: env.SYSTEM_DATABASE_URL,
      schema: "pgboss",
      max: opts.worker ? 10 : 3,
      application_name: opts.worker ? "pti-worker" : "pti-web-queue",
      // Only the worker runs maintenance and cron; senders stay lightweight.
      supervise: Boolean(opts.worker),
      schedule: Boolean(opts.worker),
    });
    b.on("error", (err: unknown) => logger.error({ err }, "pg-boss error"));
    await b.start();
    for (const q of QUEUES) {
      await b.createQueue(q.name, {
        retryLimit: q.retryLimit,
        retryBackoff: true,
        expireInSeconds: q.expireInSeconds,
      });
    }
    return b;
  })();
  return g.__ptiBoss;
}

export async function enqueue<N extends JobName>(
  name: N,
  data: JobPayloads[N],
  opts: { singletonKey?: string; startAfter?: number | Date } = {},
): Promise<string | null> {
  return (await boss()).send(name, data, {
    singletonKey: opts.singletonKey,
    startAfter: opts.startAfter,
  });
}
