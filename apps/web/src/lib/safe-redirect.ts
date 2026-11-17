/**
 * Only allow same-origin relative paths as post-auth destinations (prevents
 * open redirects). The check runs on the *normalised* result: dot segments
 * and encodings can turn "/.//evil.com" into the protocol-relative
 * "//evil.com", which browsers and routers treat as another origin.
 */
export function safeNext(next: string | string[] | undefined | null, fallback = "/app"): string {
  const v = Array.isArray(next) ? next[0] : next;
  if (!v?.startsWith("/")) return fallback;
  try {
    const u = new URL(v, "http://x");
    if (u.origin !== "http://x") return fallback;
    const out = u.pathname + u.search + u.hash;
    return /^\/[/\\]/.test(out) || /^\/[/\\]/.test(v) ? fallback : out;
  } catch {
    return fallback;
  }
}
