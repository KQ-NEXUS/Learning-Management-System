/*
  Warnings:

  - The `scanStatus` column on the `LessonResource` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `scanStatus` column on the `Submission` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `scanStatus` column on the `TicketAttachment` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "coursePublicationId" TEXT,
ADD COLUMN     "programmePublicationId" TEXT;

-- AlterTable
ALTER TABLE "CohortCourse" ADD COLUMN     "coursePublicationId" TEXT;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "publiclyListed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publiclyListedAt" TIMESTAMP(3),
ADD COLUMN     "slugLockedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

-- AlterTable
-- scanStatus is converted with an explicit USING cast rather than Prisma's
-- default DROP+ADD, which would silently discard the existing 'PENDING'
-- string values (manual-edit convention documented in prisma/sql/001_integrity.sql).
ALTER TABLE "LessonResource" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scanDetail" TEXT,
ADD COLUMN     "scannedAt" TIMESTAMP(3),
ADD COLUMN     "uploadedById" TEXT,
ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT,
ALTER COLUMN "scanStatus" DROP DEFAULT,
ALTER COLUMN "scanStatus" SET DATA TYPE "ScanStatus" USING "scanStatus"::text::"ScanStatus",
ALTER COLUMN "scanStatus" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Programme" ADD COLUMN     "contentVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "publiclyListed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publiclyListedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "slugLockedAt" TIMESTAMP(3);

-- AlterTable
-- scanStatus is converted with an explicit USING cast rather than Prisma's
-- default DROP+ADD, which would silently discard the existing 'PENDING'
-- string values (manual-edit convention documented in prisma/sql/001_integrity.sql).
ALTER TABLE "Submission" ALTER COLUMN "scanStatus" DROP DEFAULT,
ALTER COLUMN "scanStatus" SET DATA TYPE "ScanStatus" USING "scanStatus"::text::"ScanStatus",
ALTER COLUMN "scanStatus" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "TicketAttachment" ALTER COLUMN "scanStatus" DROP DEFAULT,
ALTER COLUMN "scanStatus" SET DATA TYPE "ScanStatus" USING "scanStatus"::text::"ScanStatus",
ALTER COLUMN "scanStatus" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "ProgrammePublication" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSchema" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "ProgrammePublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoursePublication" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSchema" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "CoursePublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgrammePublication_programmeId_publishedAt_idx" ON "ProgrammePublication"("programmeId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammePublication_programmeId_version_key" ON "ProgrammePublication"("programmeId", "version");

-- CreateIndex
CREATE INDEX "CoursePublication_courseId_publishedAt_idx" ON "CoursePublication"("courseId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoursePublication_courseId_version_key" ON "CoursePublication"("courseId", "version");

-- CreateIndex
CREATE INDEX "Cohort_coursePublicationId_idx" ON "Cohort"("coursePublicationId");

-- CreateIndex
CREATE INDEX "Cohort_programmePublicationId_idx" ON "Cohort"("programmePublicationId");

-- CreateIndex
CREATE INDEX "CohortCourse_coursePublicationId_idx" ON "CohortCourse"("coursePublicationId");

-- CreateIndex
CREATE INDEX "Course_publiclyListed_idx" ON "Course"("publiclyListed");

-- CreateIndex
CREATE INDEX "Lesson_withdrawnAt_idx" ON "Lesson"("withdrawnAt");

-- CreateIndex
CREATE INDEX "LessonResource_scanStatus_idx" ON "LessonResource"("scanStatus");

-- CreateIndex
CREATE INDEX "Programme_publiclyListed_idx" ON "Programme"("publiclyListed");

-- AddForeignKey
ALTER TABLE "ProgrammePublication" ADD CONSTRAINT "ProgrammePublication_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammePublication" ADD CONSTRAINT "ProgrammePublication_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePublication" ADD CONSTRAINT "CoursePublication_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePublication" ADD CONSTRAINT "CoursePublication_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonResource" ADD CONSTRAINT "LessonResource_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_coursePublicationId_fkey" FOREIGN KEY ("coursePublicationId") REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_programmePublicationId_fkey" FOREIGN KEY ("programmePublicationId") REFERENCES "ProgrammePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CohortCourse" ADD CONSTRAINT "CohortCourse_coursePublicationId_fkey" FOREIGN KEY ("coursePublicationId") REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual paste-in from prisma/sql/002_catalogue_integrity.sql — a publication
-- payload must always carry its schema marker (CAT-05/CAT-06, D-02).
ALTER TABLE "CoursePublication"
  ADD CONSTRAINT course_publication_payload_object
  CHECK (jsonb_typeof("payload"::jsonb) = 'object');

ALTER TABLE "ProgrammePublication"
  ADD CONSTRAINT programme_publication_payload_object
  CHECK (jsonb_typeof("payload"::jsonb) = 'object');
