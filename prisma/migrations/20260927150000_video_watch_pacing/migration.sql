-- F-15: staff-set video length and watch pacing anchor.
ALTER TABLE "Lesson" ADD COLUMN "videoDurationSeconds" INTEGER;

-- Existing rows get their last update as the anchor, so a learner mid-video
-- is not paced from the migration time.
ALTER TABLE "LessonWatchProgress" ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "LessonWatchProgress" SET "startedAt" = "updatedAt" - ("secondsWatched" * INTERVAL '1 second');
