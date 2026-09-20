-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "accessDurationDays" INTEGER;

-- CreateTable
CREATE TABLE "LessonWatchProgress" (
    "id" TEXT NOT NULL,
    "enrolmentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "secondsWatched" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER,
    "percentWatched" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonWatchProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LessonWatchProgress_enrolmentId_lessonId_key" ON "LessonWatchProgress"("enrolmentId", "lessonId");

-- AddForeignKey
ALTER TABLE "LessonWatchProgress" ADD CONSTRAINT "LessonWatchProgress_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "Enrolment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonWatchProgress" ADD CONSTRAINT "LessonWatchProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
