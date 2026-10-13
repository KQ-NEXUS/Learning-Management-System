/**
 * Shared real-Postgres helpers for every Phase 14 licence integration test
 * (D-13).
 *
 * The migration seeds one `DeploymentIdentity` row (id "deployment") and one
 * `LicenceState` row (id "current"). Tests must never delete those singleton
 * rows (the database has no second copy and the application self-heals only
 * through the service), so these helpers reset them in place instead.
 *
 * ESLint boundary note: this file lives under `tests/`, outside the
 * `src/**` glob that confines `@prisma/client`, so the type import is
 * intentional (same convention as `tests/support/pg.ts`).
 */

import type { PrismaClient } from "@prisma/client";

/** Fixed singleton ids pinned by CHECK constraints in the migration. */
export const DEPLOYMENT_IDENTITY_ID = "deployment";
export const LICENCE_STATE_ID = "current";

/**
 * Returns the licence tables to their freshly migrated shape: every
 * `LicenceRecord` row removed and the `LicenceState` singleton restored to
 * UNLICENSED / everActivated false / version 0 with nulls for the optional
 * columns. The pointer is cleared first so the foreign key never blocks the
 * record delete. Never deletes the `DeploymentIdentity` or `LicenceState`
 * rows.
 */
export async function resetLicenceTables(prisma: PrismaClient): Promise<void> {
  await prisma.licenceState.update({
    where: { id: LICENCE_STATE_ID },
    data: { activeRecordId: null },
  });
  await prisma.licenceRecord.deleteMany();
  await prisma.licenceState.update({
    where: { id: LICENCE_STATE_ID },
    data: {
      activeRecordId: null,
      registeredClientId: null,
      everActivated: false,
      state: "UNLICENSED",
      restrictedAt: null,
      reasonCode: null,
      lastVerifiedAt: null,
      lastVerificationOutcome: null,
      lastGoodAt: null,
      attentionSince: null,
      highWaterAt: new Date(),
      clockAlertAt: null,
      version: 0,
    },
  });
}

/**
 * Sets the singleton deployment identifier so a test can bind a minted
 * licence to a known value (D-13: a licence is bound to the database-seeded
 * deployment ID).
 */
export async function setDeploymentId(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.deploymentIdentity.update({
    where: { id: DEPLOYMENT_IDENTITY_ID },
    data: { deploymentId: id },
  });
}
