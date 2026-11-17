import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Egress guard for requests to user-supplied URLs (outbound webhooks).
 *
 * Two layers:
 *  1. Address policy: anything not globally routable is refused, including
 *     IPv4 hidden inside IPv6 (mapped ::ffff:a.b.c.d / ::ffff:7f00:1,
 *     compatible ::a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16).
 *  2. Connection pinning: the policy runs inside the socket's DNS lookup,
 *     so the address that's checked is the address that's connected to.
 *     A rebinding domain can't pass the check and then point elsewhere.
 */

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, bits, "ipv6");

function expand6(ip: string): number[] | null {
  let v =
    ip
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .split("%")[0] ?? "";
  // Trailing dotted quad → two hex groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (dotted) {
    const [a = 0, b = 0, c = 0, d = 0] = dotted.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    v =
      v.slice(0, -dotted[0].length) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  if (fill < 0) return null;
  const groups = [...h, ...Array<string>(fill).fill("0"), ...t].map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  );
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

const v4 = (hi = 0, lo = 0) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** IPv4 embedded in an IPv6 address by any common transition mechanism, else null. */
function embeddedV4(g: number[]): string | null {
  const [g0, g1, g2, , , g5, g6, g7] = g;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && (g5 === 0xffff || g5 === 0)) return v4(g6, g7); // mapped / compatible
  if (g0 === 0x64 && g1 === 0xff9b && zero(2, 6)) return v4(g6, g7); // NAT64
  if (g0 === 0x2002) return v4(g1, g2); // 6to4
  return null;
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  const family = isIP(bare.split("%")[0] ?? "");
  if (family === 4) return !blocked.check(bare, "ipv4");
  if (family !== 6) return false;
  const g = expand6(bare);
  if (!g) return false;
  // :: and ::1 look like "compatible" addresses; leave them to the IPv6 list.
  const unspecifiedOrLoopback = g.slice(0, 7).every((x) => x === 0) && (g[7] ?? 0) <= 1;
  const inner = unspecifiedOrLoopback ? null : embeddedV4(g);
  if (inner) return isPublicAddress(inner);
  return !blocked.check(g.map((x) => x.toString(16)).join(":"), "ipv6");
}

export class EgressBlockedError extends Error {
  constructor(readonly host: string) {
    super(`Refusing to connect to a non-public address for ${host}`);
  }
}

/** DNS lookup that only ever yields public addresses (used for the socket itself). */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const ok = addresses.filter((a) => isPublicAddress(a.address));
    if (ok.length === 0 || ok.length !== addresses.length)
      return callback(new EgressBlockedError(hostname), "", 0);
    if (options.all) {
      (callback as (e: null, a: LookupAddress[]) => void)(null, ok);
      return;
    }
    const [first] = ok;
    if (first) callback(null, first.address, first.family);
  });
};

export interface PostResult {
  status: number;
}
export type Poster = (
  url: string,
  init: { headers: Record<string, string>; body: string; timeoutMs: number },
) => Promise<PostResult>;

/**
 * POST over https to a user-supplied URL, pinned to vetted addresses.
 * Redirects are not followed (a 3xx is just a non-2xx result); TLS is
 * verified against the hostname as usual; the response body is discarded.
 */
export const pinnedPost: Poster = (url, { headers, body, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== "https:") return reject(new Error("https only"));
    const literal = u.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && !isPublicAddress(literal)) return reject(new EgressBlockedError(literal));
    const req = request(
      u,
      {
        method: "POST",
        headers: { ...headers, "content-length": Buffer.byteLength(body) },
        lookup: publicOnlyLookup,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume(); // drain and discard: we only care about the status
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(body);
  });
