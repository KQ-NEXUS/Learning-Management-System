-- CreateEnum
CREATE TYPE "AttemptGradingMethod" AS ENUM ('HIGHEST', 'LATEST', 'AVERAGE');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "attemptGradingMethod" "AttemptGradingMethod" NOT NULL DEFAULT 'HIGHEST';
