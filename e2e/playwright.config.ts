/**
 * Playwright configuration for the browser journey (Phase 15, plan 15-15;
 * D-08, NFR-12).
 *
 * Runs against the production build (`npm run build`, then `next start`) and a
 * local email capture server, on the host name `localhost` (never the numeric
 * loopback address) so Secure cookie handling matches across engines. One
 * worker: the journey writes to one shared database and the laptop has limited
 * memory.
 */

import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { APP_ORIGIN, APP_PORT, CAPTURE_ORIGIN, appServerEnv } from "./support/server-env";

// The webServer commands run from the repository root, not from this folder.
const REPO_ROOT = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  // Makes sure the catalogue has the open priced cohort, session, assignment and certificate
  // template the full journey needs. Runs the database guard before it writes anything.
  globalSetup: "./support/journey-fixtures.ts",
  outputDir: "../test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? APP_ORIGIN,
    trace: "on-first-retry",
    // A step that stalls fails after a minute instead of eating the whole test timeout, so the
    // failure is still in flight when the diagnostics attach (plan 15-17).
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  },
  // Branded Chrome and Edge need those browsers installed on the machine (Edge ships
  // with Windows 11). Playwright WebKit is not Safari: the manual Safari and iPhone
  // check in the launch plan stays.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "npx tsx e2e/support/email-capture-server.ts",
      cwd: REPO_ROOT,
      url: `${CAPTURE_ORIGIN}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `npx next start -p ${APP_PORT}`,
      cwd: REPO_ROOT,
      url: `${APP_ORIGIN}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: appServerEnv(),
    },
  ],
});
