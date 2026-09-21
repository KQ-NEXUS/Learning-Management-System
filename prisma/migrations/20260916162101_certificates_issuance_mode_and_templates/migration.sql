-- CreateEnum
CREATE TYPE "CertificateIssuanceMode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "certificateIssuanceMode" "CertificateIssuanceMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "certificateTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Programme" ADD COLUMN     "certificateIssuanceMode" "CertificateIssuanceMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "certificateTemplateId" TEXT;

-- CreateTable
CREATE TABLE "CertificateTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "layoutSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificateTemplate_archivedAt_idx" ON "CertificateTemplate"("archivedAt");

-- AddForeignKey
ALTER TABLE "Programme" ADD CONSTRAINT "Programme_certificateTemplateId_fkey" FOREIGN KEY ("certificateTemplateId") REFERENCES "CertificateTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_certificateTemplateId_fkey" FOREIGN KEY ("certificateTemplateId") REFERENCES "CertificateTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- One ACTIVE certificate per enrolment and completion scope
-- ---------------------------------------------------------------------------
-- CRD-01 requires concurrent issuance attempts to converge on one active
-- credential. Application-level checks cannot close this duplicate race.

CREATE UNIQUE INDEX certificate_one_active_per_enrolment_scope
  ON "Certificate" ("enrolmentId", "scope")
  WHERE status = 'ACTIVE';
