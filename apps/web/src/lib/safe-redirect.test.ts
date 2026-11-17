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
