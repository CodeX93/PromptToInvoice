/**
 * Background worker: `pnpm --filter @pti/web worker`.
 * Runs queue handlers and cron scans. Safe to run several replicas: jobs
 * are claimed with SKIP LOCKED and scans enqueue singleton jobs.
 */
import { todayIn } from "@pti/core";
import { boss, enqueue, type JobPayloads } from "@/server/jobs/queue";
import { systemContext } from "@/server/jobs/system-context";
import { purge } from "@/server/jobs/maintenance";
import { logger } from "@/server/logger";
import { archivePdf } from "@/server/documents/service";
import { deliverInvoiceEmail, deliverReminder } from "@/server/services/emails";
import { findDueReminders } from "@/server/services/reminders";
import { findDueSchedules, runSchedule } from "@/server/services/recurring";

type Handler<N extends keyof JobPayloads> = (data: JobPayloads[N]) => Promise<void>;

const handlers: { [N in keyof JobPayloads]: Handler<N> } = {
  "invoice.send": async (d) => deliverInvoiceEmail(await systemContext(d.orgId, d.actorId), d),
  "invoice.archive-pdf": async (d) => archivePdf(await systemContext(d.orgId), d.invoiceId),
  "stripe.event": async () => {
    /* webhooks are applied inline; queue reserved for replays */
  },
  "reminders.scan": async () => {
    const due = await findDueReminders();
    const day = todayIn("UTC");
    for (const r of due) await enqueue("reminders.send", r, { singletonKey: `${r.invoiceId}:${r.offset}:${day}` });
    logger.info({ count: due.length }, "reminders scheduled");
  },
  "reminders.send": async (d) => {
    await deliverReminder(await systemContext(d.orgId), d.invoiceId, d.offset);
  },
  "recurring.scan": async () => {
    const due = await findDueSchedules();
    for (const s of due) await enqueue("recurring.run", s, { singletonKey: `${s.scheduleId}:${s.runOn}` });
    logger.info({ count: due.length }, "recurring runs scheduled");
  },
  "recurring.run": async (d) => {
    const id = await runSchedule(await systemContext(d.orgId), d.scheduleId, d.runOn);
    logger.info({ scheduleId: d.scheduleId, invoiceId: id }, "recurring run complete");
  },
  "maintenance.purge": async () => {
    logger.info(await purge(), "maintenance purge");
  },
};

async function main() {
  const b = await boss({ worker: true });
  for (const [name, handler] of Object.entries(handlers) as [keyof JobPayloads, Handler<keyof JobPayloads>][]) {
    await b.work<JobPayloads[typeof name]>(name, { localConcurrency: name === "invoice.send" ? 4 : 2, batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        const started = performance.now();
        try {
          await handler(job.data as never);
          logger.info({ job: name, id: job.id, ms: Math.round(performance.now() - started) }, "job done");
        } catch (err) {
          logger.error({ err, job: name, id: job.id }, "job failed");
          throw err;
        }
      }
    });
  }
  // Hourly scans: each org's "today" depends on its time zone; singleton keys stop duplicates.
  await b.schedule("reminders.scan", "5 * * * *");
  await b.schedule("recurring.scan", "10 * * * *");
  await b.schedule("maintenance.purge", "30 3 * * *");
  logger.info("worker started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker stopping");
    await b.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
