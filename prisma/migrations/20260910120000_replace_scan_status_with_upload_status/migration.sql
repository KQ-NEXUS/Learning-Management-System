CREATE TYPE "UploadStatus" AS ENUM ('UPLOADING', 'READY', 'ERROR');

ALTER TABLE "LessonResource" RENAME COLUMN "scannedAt" TO "uploadedAt";
ALTER TABLE "LessonResource" RENAME COLUMN "scanDetail" TO "uploadDetail";
ALTER TABLE "LessonResource" ADD COLUMN "uploadStatus" "UploadStatus";
ALTER TABLE "Submission" ADD COLUMN "uploadStatus" "UploadStatus";
ALTER TABLE "TicketAttachment" ADD COLUMN "uploadStatus" "UploadStatus";

UPDATE "LessonResource"
SET "uploadStatus" = CASE
      WHEN "scanStatus"::text = 'CLEAN' THEN 'READY'::"UploadStatus"
      ELSE 'ERROR'::"UploadStatus"
    END,
    "uploadedAt" = CASE
      WHEN "scanStatus"::text = 'CLEAN' THEN COALESCE("uploadedAt", "createdAt")
      ELSE NULL
    END,
    "uploadDetail" = CASE
      WHEN "scanStatus"::text = 'CLEAN' THEN NULL
      ELSE 'This upload must be removed and submitted again.'
    END;

UPDATE "Submission"
SET "uploadStatus" = CASE
  WHEN "scanStatus"::text = 'CLEAN' THEN 'READY'::"UploadStatus"
  ELSE 'ERROR'::"UploadStatus"
END;

UPDATE "TicketAttachment"
SET "uploadStatus" = CASE
  WHEN "scanStatus"::text = 'CLEAN' THEN 'READY'::"UploadStatus"
  ELSE 'ERROR'::"UploadStatus"
END;

ALTER TABLE "LessonResource" ALTER COLUMN "uploadStatus" SET NOT NULL;
ALTER TABLE "LessonResource" ALTER COLUMN "uploadStatus" SET DEFAULT 'UPLOADING';
ALTER TABLE "Submission" ALTER COLUMN "uploadStatus" SET NOT NULL;
ALTER TABLE "Submission" ALTER COLUMN "uploadStatus" SET DEFAULT 'UPLOADING';
ALTER TABLE "TicketAttachment" ALTER COLUMN "uploadStatus" SET NOT NULL;
ALTER TABLE "TicketAttachment" ALTER COLUMN "uploadStatus" SET DEFAULT 'UPLOADING';

DROP INDEX "LessonResource_scanStatus_idx";
ALTER TABLE "LessonResource" DROP COLUMN "scanStatus";
ALTER TABLE "Submission" DROP COLUMN "scanStatus";
ALTER TABLE "TicketAttachment" DROP COLUMN "scanStatus";
DROP TYPE "ScanStatus";
CREATE INDEX "LessonResource_uploadStatus_idx" ON "LessonResource"("uploadStatus");
