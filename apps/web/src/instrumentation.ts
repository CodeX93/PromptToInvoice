/**
 * Runs once when a server instance boots. Validating configuration here
 * turns a bad deploy into a container that exits immediately (and is never
 * marked ready) instead of one that starts and then fails every request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    await import("./server/env");
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
