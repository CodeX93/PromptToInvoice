import { BlockList } from "node:net";
import { describe, expect, it } from "vitest";
import { resolveClientIp } from "./client-ip";

const lb = new BlockList();
lb.addSubnet("10.0.0.0", 8, "ipv4");
const behindLb = (xff: string | null) => resolveClientIp(xff, lb, true);
const direct = (xff: string | null) => resolveClientIp(xff, new BlockList(), false);

describe("resolveClientIp", () => {
  it("takes the first untrusted hop from the right", () => {
    expect(behindLb("203.0.113.7, 10.0.0.5")).toBe("203.0.113.7");
  });

  it("ignores a spoofed address the client prepended", () => {
    // Attacker sends X-Forwarded-For: 1.2.3.4; the load balancer appends the real peer.
    expect(behindLb("1.2.3.4, 198.51.100.9, 10.0.0.5")).toBe("198.51.100.9");
  });

  it("returns null for garbage in the trusted walk instead of guessing", () => {
    expect(behindLb("not-an-ip, 10.0.0.5")).toBeNull();
    expect(behindLb("10.0.0.5")).toBeNull();
  });

  it("without trusted proxies, only a single-entry header is believed", () => {
    expect(direct("203.0.113.7")).toBe("203.0.113.7");
    expect(direct("1.2.3.4, 203.0.113.7")).toBeNull();
    expect(direct(null)).toBeNull();
  });

  it("buckets IPv6 to /64 and unwraps IPv4-mapped addresses", () => {
    expect(direct("2001:db8:abcd:12::1")).toBe("2001:0db8:abcd:0012::/64");
    expect(direct("2001:db8:abcd:12:ffff::9")).toBe("2001:0db8:abcd:0012::/64");
    expect(direct("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
});
