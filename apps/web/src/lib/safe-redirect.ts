/** Only allow same-origin relative paths as post-auth destinations (prevents open redirects). */
export function safeNext(next: string | string[] | undefined | null, fallback = "/app"): string {
  const v = Array.isArray(next) ? next[0] : next;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  try {
    const u = new URL(v, "http://x");
    return u.origin === "http://x" ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}
