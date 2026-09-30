-- AlterTable
ALTER TABLE "DomainEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT;

-- AlterTable
ALTER TABLE "EmailDispatch" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "resentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skipReason" TEXT,
ADD COLUMN     "templateParams" JSONB;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailPreference" (
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailPreference_pkey" PRIMARY KEY ("userId","category")
);

-- CreateIndex
CREATE INDEX "Notification_recipientId_archivedAt_createdAt_id_idx" ON "Notification"("recipientId", "archivedAt", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Notification_recipientId_archivedAt_readAt_idx" ON "Notification"("recipientId", "archivedAt", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_recipientId_type_sourceEventId_key" ON "Notification"("recipientId", "type", "sourceEventId");

-- CreateIndex
CREATE INDEX "EmailDispatch_status_nextAttemptAt_idx" ON "EmailDispatch"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailPreference" ADD CONSTRAINT "EmailPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level guards for the persisted communications vocabulary (COM-02).
ALTER TABLE "DomainEvent"
  ADD CONSTRAINT "DomainEvent_attempts_nonnegative_check"
  CHECK ("attempts" >= 0);

ALTER TABLE "EmailDispatch"
  ADD CONSTRAINT "EmailDispatch_attempts_nonnegative_check"
  CHECK ("attempts" >= 0),
  ADD CONSTRAINT "EmailDispatch_status_check"
  CHECK ("status" IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'));
