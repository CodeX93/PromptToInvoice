import { describe, expect, it } from "vitest";
import { EgressBlockedError, isPublicAddress, pinnedPost } from "./egress";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "febf::1", // all of fe80::/10, not just the fe80 prefix
    "fec0::1",
    "ff02::1",
    // IPv4 smuggled inside IPv6
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "[::ffff:7f00:1]",
    "::7f00:1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2002:c0a8:101::1",
    "0:0:0:0:0:ffff:7f00:1",
    "fe80::1%eth0",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each([
    "93.184.215.14",
    "8.8.8.8",
    "172.32.0.1",
    "2606:4700::1111",
    "::ffff:8.8.8.8",
    "2002:808:808::1",
  ])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));

  it("rejects garbage", () => {
    for (const v of ["", "localhost", "1.2.3", "::ffff:999.1.1.1", "1:2:3:4:5:6:7:8:9"])
      expect(isPublicAddress(v)).toBe(false);
  });
});

describe("pinnedPost", () => {
  const init = { headers: {}, body: "{}", timeoutMs: 2000 };
  it("refuses at connect time when a hostname resolves to a private address", async () => {
    // "localhost" contains no IP literal; only the pinned DNS lookup can stop it.
    await expect(pinnedPost("https://localhost:9/hook", init)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });
  it("refuses private IP literals without touching the network", async () => {
    await expect(pinnedPost("https://[::ffff:7f00:1]/x", init)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });
  it("is https-only", async () => {
    await expect(pinnedPost("http://93.184.215.14/x", init)).rejects.toThrow(/https/);
  });
});
