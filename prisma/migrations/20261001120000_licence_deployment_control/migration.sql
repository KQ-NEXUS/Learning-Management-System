-- CreateTable
CREATE TABLE "DeploymentIdentity" (
    "id" TEXT NOT NULL DEFAULT 'deployment',
    "deploymentId" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenceRecord" (
    "id" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "graceEndsAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedById" TEXT,

    CONSTRAINT "LicenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenceState" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "activeRecordId" TEXT,
    "registeredClientId" TEXT,
    "everActivated" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT NOT NULL DEFAULT 'UNLICENSED',
    "restrictedAt" TIMESTAMP(3),
    "reasonCode" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerificationOutcome" TEXT,
    "lastGoodAt" TIMESTAMP(3),
    "attentionSince" TIMESTAMP(3),
    "highWaterAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clockAlertAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenceState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentIdentity_deploymentId_key" ON "DeploymentIdentity"("deploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "LicenceRecord_licenceId_key" ON "LicenceRecord"("licenceId");

-- CreateIndex
CREATE INDEX "LicenceRecord_issuedAt_idx" ON "LicenceRecord"("issuedAt");

-- AddForeignKey
ALTER TABLE "LicenceRecord" ADD CONSTRAINT "LicenceRecord_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenceState" ADD CONSTRAINT "LicenceState_activeRecordId_fkey" FOREIGN KEY ("activeRecordId") REFERENCES "LicenceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Database-level guards for the licence stored state (Phase 14, D-13). Kept in
-- this migration, never in a prisma/sql companion file, so every migrate
-- deploy (Neon, Docker, Testcontainers) enforces them.
ALTER TABLE "DeploymentIdentity"
  ADD CONSTRAINT "DeploymentIdentity_singleton_check"
  CHECK ("id" = 'deployment');

ALTER TABLE "LicenceState"
  ADD CONSTRAINT "LicenceState_singleton_check"
  CHECK ("id" = 'current'),
  ADD CONSTRAINT "LicenceState_state_check"
  CHECK ("state" IN ('UNLICENSED', 'ACTIVE', 'EXPIRING_SOON', 'GRACE', 'RESTRICTED_CONTINUITY', 'INVALID', 'VALIDATION_ATTENTION')),
  ADD CONSTRAINT "LicenceState_version_nonnegative_check"
  CHECK ("version" >= 0);

ALTER TABLE "LicenceRecord"
  ADD CONSTRAINT "LicenceRecord_raw_length_check"
  CHECK (char_length("raw") <= 8192);

-- Seed the singletons (D-13, LIC-04). The deployment identifier is generated
-- once here and survives restore, scaling and migration. The LicenceState
-- seed follows the OQ1 owner decision (option-a): everActivated false and
-- state UNLICENSED, i.e. fully operational until the first activation.
INSERT INTO "DeploymentIdentity" ("id", "deploymentId", "createdAt")
VALUES ('deployment', gen_random_uuid()::text, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "LicenceState" ("id", "highWaterAt", "updatedAt")
VALUES ('current', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
