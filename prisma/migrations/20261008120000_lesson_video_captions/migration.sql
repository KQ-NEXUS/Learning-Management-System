-- NFR-09 (plan 15-23): WebVTT caption tracks for lesson video. A caption is a
-- text/vtt LessonResource linked to the VIDEO resource it captions. Additive only:
-- three nullable columns, one index and a self-referencing foreign key. Existing
-- rows are untouched (all three columns stay NULL).
ALTER TABLE "LessonResource" ADD COLUMN "captionForResourceId" TEXT;
ALTER TABLE "LessonResource" ADD COLUMN "captionLanguage" TEXT;
ALTER TABLE "LessonResource" ADD COLUMN "captionLabel" TEXT;

CREATE INDEX "LessonResource_captionForResourceId_idx" ON "LessonResource"("captionForResourceId");

ALTER TABLE "LessonResource" ADD CONSTRAINT "LessonResource_captionForResourceId_fkey" FOREIGN KEY ("captionForResourceId") REFERENCES "LessonResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
