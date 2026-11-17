import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    pool: "forks",
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
