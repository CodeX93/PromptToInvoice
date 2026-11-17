import "server-only";
import { BlockList, isIP } from "node:net";
import { env } from "./env";

/**
 * The client's IP for rate limiting and audit, resistant to spoofing.
 *
 * X-Forwarded-For is client-writable: a proxy that *appends* (nginx
 * `$proxy_add_x_forwarded_for`, most load balancers) leaves whatever the
 * client sent at the front. So we walk the list right-to-left and skip hops
 * we trust (TRUSTED_PROXIES, CIDRs); the first untrusted address is the
 * client. With no trusted proxies configured we only accept a single-entry
 * header (platforms that overwrite it), the same rule Better Auth applies.
 *
 * IPv6 is bucketed to /64: one host usually controls a whole /64, so
 * per-address limits would be trivial to rotate around.
 */

function trustedList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const c of cidrs) {
    const [addr = "", bits] = c.split("/");
    const family = isIP(addr) === 6 ? "ipv6" : "ipv4";
    if (!isIP(addr)) continue;
    if (bits === undefined) list.addAddress(addr, family);
    else list.addSubnet(addr, Number(bits), family);
  }
  return list;
}

const trusted = trustedList(env.TRUSTED_PROXIES);

function bucket(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  // Expand, then keep the first four groups (/64).
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups
    .slice(0, 4)
    .map((g) => g.padStart(4, "0"))
    .join(":")}::/64`;
}

export function resolveClientIp(
  forwardedFor: string | null,
  trustedProxies: BlockList = trusted,
  hasTrusted = env.TRUSTED_PROXIES.length > 0,
): string | null {
  const hops = (forwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length === 0) return null;
  if (!hasTrusted) return hops.length === 1 && isIP(hops[0] ?? "") ? bucket(hops[0] ?? "") : null;
  for (let i = hops.length - 1; i >= 0; i--) {
    const ip = hops[i] ?? "";
    const family = isIP(ip);
    if (!family) return null;
    if (trustedProxies.check(ip, family === 6 ? "ipv6" : "ipv4")) continue;
    return bucket(ip);
  }
  return null;
}

/** Client IP from request headers; "unknown" shares one conservative bucket. */
export function clientIp(headers: Headers): string {
  return resolveClientIp(headers.get("x-forwarded-for")) ?? "unknown";
}

/** Same, but null when unknown (for audit rows, where "unknown" would be noise). */
export function clientIpOrNull(headers: Headers): string | null {
  return resolveClientIp(headers.get("x-forwarded-for"));
}
