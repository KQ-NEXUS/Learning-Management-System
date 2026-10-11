/**
 * Playwright `globalSetup` for the staging configuration (Phase 15, plan 15-30).
 *
 * With STAGING_JOURNEY=1 it makes sure the journey course exists on the staging
 * branch, behind the database guard with the staging target (the host must be
 * in STAGING_DATABASE_HOSTS and ALLOW_STAGING_DATABASE must be 1). Without it,
 * nothing here touches a database: the probe only reads pages.
 *
 * Tasks the journey runs by hand (`runTask`) inherit this process's environment.
 * The preview sends no real email (EMAIL_TRANSPORT=stub), so the tasks must not
 * either: the transport is forced to the stub here whatever the shell carries.
 */

import { ensureJourneyFixtures } from "./journey-fixtures";

export default async function stagingSetup(): Promise<void> {
  process.env.EMAIL_TRANSPORT = "stub";
  process.env.APP_BASE_URL = (process.env.E2E_BASE_URL ?? "").replace(/\/+$/, "");

  if (process.env.STAGING_JOURNEY === "1") {
    await ensureJourneyFixtures({ target: "staging" });
  }
}
