-- Learner numbers (owner decisions, 2026-10-04): a readable, permanent reference
-- for each learner, issued in order from a pattern an administrator sets.
-- Existing learners are deliberately NOT given a number.

ALTER TABLE "User" ADD COLUMN "learnerNumber" TEXT;
CREATE UNIQUE INDEX "User_learnerNumber_key" ON "User"("learnerNumber");

CREATE TABLE "LearnerNumberConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "pattern" TEXT,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerNumberConfig_pkey" PRIMARY KEY ("id")
);

-- The single settings row. No pattern yet: nothing is issued until one is saved.
INSERT INTO "LearnerNumberConfig" ("id", "pattern", "nextSequence", "updatedAt")
VALUES ('default', NULL, 1, CURRENT_TIMESTAMP);
