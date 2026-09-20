ALTER TABLE "ExportJob"
  ADD COLUMN "datasetVersion" TEXT NOT NULL DEFAULT '1.0',
  ADD COLUMN "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
  ADD COLUMN "scopeSnapshot" JSONB,
  ADD COLUMN "columnSnapshot" JSONB,
  ADD COLUMN "sensitiveReason" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "retryOfId" TEXT,
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "errorMessage" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ExportJob" ALTER COLUMN "rowCount" SET DEFAULT 0;
CREATE UNIQUE INDEX "ExportJob_idempotencyKey_key" ON "ExportJob"("idempotencyKey");
CREATE INDEX "ExportJob_status_createdAt_idx" ON "ExportJob"("status", "createdAt");
CREATE INDEX "ExportJob_retryOfId_idx" ON "ExportJob"("retryOfId");
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_retryOfId_fkey" FOREIGN KEY ("retryOfId") REFERENCES "ExportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ExportSnapshotRow" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExportSnapshotRow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExportSnapshotRow_jobId_ordinal_key" ON "ExportSnapshotRow"("jobId", "ordinal");
ALTER TABLE "ExportSnapshotRow" ADD CONSTRAINT "ExportSnapshotRow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ExportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
