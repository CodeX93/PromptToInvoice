import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-redirect";

describe("safeNext", () => {
  it.each([
    ["/app/invoices?x=1", "/app/invoices?x=1"],
    [undefined, "/app"],
    ["https://evil.test", "/app"],
    ["//evil.test", "/app"],
    ["/\\evil.test", "/app"],
    ["javascript:alert(1)", "/app"],
    [["/a", "/b"], "/a"],
  ])("%j -> %s", (input, out) => {
    expect(safeNext(input as string)).toBe(out);
  });
});

describe("safeNext normalisation bypasses", () => {
  it.each([
    "/.//evil.com/login",
    "/%2e//evil.com",
    "/a/..//evil.com",
    "/./\\evil.com",
    "/%2E%2E//evil.com",
    "/\\/evil.com",
  ])("rejects %s", (v) => {
    expect(safeNext(v, "/app")).toBe("/app");
  });
  it("keeps legitimate paths with dot segments", () => {
    expect(safeNext("/app/./invoices/../clients?q=1", "/x")).toBe("/app/clients?q=1");
  });
});
