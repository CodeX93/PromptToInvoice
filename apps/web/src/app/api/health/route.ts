import { sql } from "@pti/db";
import { sysDb } from "@/server/db";

/**
 * Liveness by default (process is up, no dependencies touched, so a database
 * blip never gets healthy containers killed). `?ready=1` is the readiness
 * probe: it round-trips to Postgres with a short timeout.
 */
export async function GET(req: Request) {
  const headers = { "cache-control": "no-store" };
  if (new URL(req.url).searchParams.get("ready") !== "1")
    return Response.json({ status: "ok" }, { headers });
  const started = performance.now();
  try {
    await Promise.race([
      sysDb.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    return Response.json(
      { status: "ok", db: { latencyMs: Math.round(performance.now() - started) } },
      { headers },
    );
  } catch {
    return Response.json({ status: "unavailable", db: "unreachable" }, { status: 503, headers });
  }
}
