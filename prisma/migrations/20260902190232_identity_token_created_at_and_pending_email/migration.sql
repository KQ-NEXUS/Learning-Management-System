-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pendingEmail" TEXT;

-- AlterTable
ALTER TABLE "VerificationToken" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
