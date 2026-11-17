import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite against a real dev server + worker + Postgres.
 * Emails are read from a file outbox (EMAIL_OUTBOX_DIR), AI drafting uses the
 * deterministic stub, so the suite runs offline and is repeatable.
 *
 *   pnpm e2e                      # starts the app + worker unless already running
 *   E2E_BASE_URL=… pnpm e2e       # against a running deployment (dev settings)
 */
const PORT = 3000;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
export const OUTBOX = process.env.EMAIL_OUTBOX_DIR ?? `${import.meta.dirname}/e2e/.outbox`;

const serverEnv = {
  AI_PROVIDER: "stub",
  EMAIL_PROVIDER: "log",
  EMAIL_OUTBOX_DIR: OUTBOX,
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    locale: "en-GB",
    timezoneId: "Europe/Berlin",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /(marketing|public)\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "pnpm exec next dev --port 3000",
          url: `${baseURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          env: serverEnv,
          timeout: 120_000,
        },
        {
          command:
            "pnpm exec tsx --env-file-if-exists=.env.local --tsconfig scripts/tsconfig.json worker/index.ts",
          // Readiness is the "worker started" log line, so keep info level here.
          wait: { stdout: /worker started/ },
          env: { ...serverEnv, LOG_LEVEL: "info" },
        },
      ],
});
