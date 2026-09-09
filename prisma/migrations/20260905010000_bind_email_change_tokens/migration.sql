ALTER TABLE "VerificationToken" ADD COLUMN "userId" TEXT;

-- Existing email-change tokens have no trustworthy account binding.
UPDATE "VerificationToken"
SET "consumedAt" = CURRENT_TIMESTAMP
WHERE "purpose" = 'EMAIL_CHANGE' AND "consumedAt" IS NULL;
