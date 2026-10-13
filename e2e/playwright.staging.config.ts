/**
 * Playwright configuration for the staging target (Phase 15, plan 15-30; D-01):
 * the Netlify deploy preview and the staging Neon branch recorded in 15-STAGING.md.
 *
 * It differs from playwright.config.ts in three ways. It starts no server (the
 * preview is already running). It refuses any address that is not a Netlify
 * deploy preview, so a staging run can never be pointed at the production site.
 * And its setup makes the journey course on the staging branch behind the
 * database guard with the staging target, only when STAGING_JOURNEY=1 (the
 * probe needs no database access).
 *
 *   E2E_BASE_URL=<preview URL> E2E_TARGET=staging \
 *     npx playwright test -c e2e/playwright.staging.config.ts journey.spec.ts -g "staging journey" --project chromium --headed
 *
 * The shell must carry DATABASE_URL (the staging branch), STAGING_DATABASE_HOSTS
 * and ALLOW_STAGING_DATABASE=1 for the journey and the quiet-resend check.
 */

import { defineConfig, devices } from "@playwright/test";

const DEPLOY_PREVIEW = /^https:\/\/deploy-preview-\d+--[a-z0-9-]+\.netlify\.app$/;

const baseURL = (process.env.E2E_BASE_URL ?? "").replace(/\/+$/, "");
if (!DEPLOY_PREVIEW.test(baseURL)) {
  throw new Error(
    "E2E_BASE_URL must be the Netlify deploy preview from 15-STAGING.md (https://deploy-preview-N--site.netlify.app). It has no default, so a staging run can never reach the production site.",
  );
}
if (process.env.E2E_TARGET !== "staging") {
  throw new Error("Set E2E_TARGET=staging to use the staging configuration.");
}

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./support/staging-setup.ts",
  outputDir: "../test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  // A function that has been idle starts cold: the first answer can take several seconds.
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
