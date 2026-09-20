-- CreateEnum
CREATE TYPE "ReconciliationSubject" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "ReconciliationRisk" AS ENUM ('CAPTURED_MONEY', 'SETTLEMENT_VARIANCE', 'MISSING_PROVIDER_DATA');

-- CreateEnum
CREATE TYPE "ReconciliationCaseStatus" AS ENUM ('OPEN', 'RESOLVED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ReconciliationCaseEventType" AS ENUM ('OPENED', 'EVIDENCE_CHANGED', 'ASSIGNED', 'RESOLVED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ReconciliationResolutionReason" AS ENUM ('MATCHED_PROVIDER_EVIDENCE', 'CORRECTED_UPSTREAM', 'DUPLICATE_RECORD', 'ACCEPTED_VARIANCE', 'OTHER');

-- CreateTable
CREATE TABLE "ReconciliationCase" (
    "id" TEXT NOT NULL,
    "subject" "ReconciliationSubject" NOT NULL,
    "risk" "ReconciliationRisk" NOT NULL,
    "status" "ReconciliationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "paymentAttemptId" TEXT,
    "refundId" TEXT,
    "evidence" JSONB NOT NULL,
    "evidenceFingerprint" TEXT NOT NULL,
    "lastEvidenceAt" TIMESTAMP(3) NOT NULL,
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolutionReason" "ReconciliationResolutionReason",
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationCase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reconciliation_case_exactly_one_subject" CHECK (
      ("subject" = 'PAYMENT' AND "paymentAttemptId" IS NOT NULL AND "refundId" IS NULL)
      OR
      ("subject" = 'REFUND' AND "refundId" IS NOT NULL AND "paymentAttemptId" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "ReconciliationCaseEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "ReconciliationCaseEventType" NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "evidence" JSONB,
    "fingerprint" TEXT,
    "resolutionReason" "ReconciliationResolutionReason",
    "note" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationCaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationCase_status_risk_openedAt_idx" ON "ReconciliationCase"("status", "risk", "openedAt");
CREATE INDEX "ReconciliationCase_paymentAttemptId_idx" ON "ReconciliationCase"("paymentAttemptId");
CREATE INDEX "ReconciliationCase_refundId_idx" ON "ReconciliationCase"("refundId");
CREATE INDEX "ReconciliationCase_assignedToId_idx" ON "ReconciliationCase"("assignedToId");
CREATE INDEX "ReconciliationCaseEvent_caseId_createdAt_idx" ON "ReconciliationCaseEvent"("caseId", "createdAt");
CREATE INDEX "ReconciliationCaseEvent_correlationId_idx" ON "ReconciliationCaseEvent"("correlationId");
CREATE INDEX "ReconciliationCaseEvent_actorId_createdAt_idx" ON "ReconciliationCaseEvent"("actorId", "createdAt");

-- One durable investigation identity per payment/refund subject. These are
-- partial rather than ordinary UNIQUE constraints so NULL in the unused
-- subject column keeps the XOR representation honest.
CREATE UNIQUE INDEX "ReconciliationCase_one_payment_attempt" ON "ReconciliationCase"("paymentAttemptId") WHERE "paymentAttemptId" IS NOT NULL;
CREATE UNIQUE INDEX "ReconciliationCase_one_refund" ON "ReconciliationCase"("refundId") WHERE "refundId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "ReconciliationCase" ADD CONSTRAINT "ReconciliationCase_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReconciliationCase" ADD CONSTRAINT "ReconciliationCase_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReconciliationCase" ADD CONSTRAINT "ReconciliationCase_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReconciliationCase" ADD CONSTRAINT "ReconciliationCase_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReconciliationCaseEvent" ADD CONSTRAINT "ReconciliationCaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReconciliationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReconciliationCaseEvent" ADD CONSTRAINT "ReconciliationCaseEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
