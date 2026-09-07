-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "holdMinutes" INTEGER DEFAULT 30;

-- AlterTable
ALTER TABLE "Enrolment" ADD COLUMN     "holdExpiresAt" TIMESTAMP(3),
ADD COLUMN     "transferredFromId" TEXT;

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainEvent_processedAt_occurredAt_idx" ON "DomainEvent"("processedAt", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_type_idx" ON "DomainEvent"("type");

-- CreateIndex
CREATE INDEX "Enrolment_status_holdExpiresAt_idx" ON "Enrolment"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "Enrolment_transferredFromId_idx" ON "Enrolment"("transferredFromId");

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_transferredFromId_fkey" FOREIGN KEY ("transferredFromId") REFERENCES "Enrolment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual paste-in from prisma/sql/003_cohort_operations.sql — four integrity
-- constraints Prisma's schema language cannot express (Phase 5).
-- Regression proof: tests/schema-cohort.test.ts.

-- D-02 — a cohort's seat-hold TTL is never negative.
ALTER TABLE "Cohort"
  ADD CONSTRAINT cohort_hold_minutes_non_negative
  CHECK ("holdMinutes" IS NULL OR "holdMinutes" >= 0);

-- D-13 — a transfer never points an enrolment at itself.
ALTER TABLE "Enrolment"
  ADD CONSTRAINT enrolment_transfer_not_self
  CHECK ("transferredFromId" IS NULL OR "transferredFromId" <> "id");

-- D-02/D-03 (RESEARCH Pitfall 3) — a seat hold exists only while the
-- enrolment is PENDING_PAYMENT; every transition out of PENDING_PAYMENT must
-- null holdExpiresAt in the same write.
ALTER TABLE "Enrolment"
  ADD CONSTRAINT enrolment_hold_expiry_only_when_pending
  CHECK ("holdExpiresAt" IS NULL OR "status" = 'PENDING_PAYMENT');

-- ATT-03 — an attendance correction always carries its reason.
ALTER TABLE "AttendanceRecord"
  ADD CONSTRAINT attendance_correction_has_reason
  CHECK (
    ("correctedAt" IS NULL AND "correctedById" IS NULL AND "correctionReason" IS NULL)
    OR
    ("correctedAt" IS NOT NULL AND length(btrim("correctionReason")) > 0)
  );
