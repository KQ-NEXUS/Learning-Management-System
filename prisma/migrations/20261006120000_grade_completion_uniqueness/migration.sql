-- NFR-03 / NFR-14 (phase 15, plan 15-12): one grade per submission and one
-- open completion record per enrolment, scope and course.
--
-- Background. `Grade` had no unique constraint, and `saveDraftGrade`
-- (src/server/services/grading-service.ts) reads the submission's grade and
-- then creates one when none exists. Two graders, or one grader's retried
-- request, saving the same submission at the same moment both read "no grade"
-- and both insert, leaving two Grade rows for one submission (proven by
-- tests/grading-concurrency.integration.test.ts before this migration).
-- `CompletionRecord` had only a plain index on (enrolmentId, scope), and
-- `applyVerdict` (src/server/services/completion-service.ts) is the same
-- find-then-create shape, so two concurrent completion evaluations could open
-- two records for the same enrolment, scope and course.
--
-- Fix. Two PARTIAL unique indexes. Prisma's schema language cannot express a
-- partial or expression index, so both live only in this migration and are
-- documented by comments on the models in prisma/schema.prisma. Never use
-- `prisma db push` against a database carrying them: it does not know them
-- and may propose dropping them.
--   * "Grade_submissionId_key" covers assignment grades only. Quiz attempt
--     grades have submissionId NULL and stay outside the index.
--   * "CompletionRecord_open_key" covers OPEN records only (supersededAt IS
--     NULL), so any number of superseded records may sit beside the one open
--     record. PROGRAMME-scope records have courseId NULL; COALESCE folds NULL
--     to '' so two open programme records also collide (a plain NULL would
--     never be equal to another NULL in a unique index).
-- Application code turns the losing insert's unique violation (Prisma P2002)
-- into the existing outcome: an update of the winner's draft grade or
-- GradeAlreadyReleasedError, and "already completed" for a completion record.
--
-- This migration is additive. It never deletes or rewrites grade or completion
-- data and drops nothing. Step 1 of each part aborts, changing nothing, if
-- existing rows would violate the new index. Which duplicate is the real one is
-- a human call, so nothing is auto-resolved. Postgres DDL is transactional, so
-- an abort leaves the schema exactly as it was.
--
-- Run these read-only diagnostics BEFORE applying to a shared database. Each
-- must return no rows:
--
--   SELECT "submissionId", count(*) AS grades
--   FROM "Grade"
--   WHERE "submissionId" IS NOT NULL
--   GROUP BY "submissionId"
--   HAVING count(*) > 1;
--
--   SELECT "enrolmentId", scope, COALESCE("courseId", '') AS course, count(*) AS open_records
--   FROM "CompletionRecord"
--   WHERE "supersededAt" IS NULL
--   GROUP BY "enrolmentId", scope, COALESCE("courseId", '')
--   HAVING count(*) > 1;

-- ---------------------------------------------------------------------------
-- Part A, step 1. Preflight: abort with a clear message if any submission
-- already has more than one grade
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  violating_submissions integer;
BEGIN
  SELECT count(*) INTO violating_submissions
  FROM (
    SELECT 1
    FROM "Grade"
    WHERE "submissionId" IS NOT NULL
    GROUP BY "submissionId"
    HAVING count(*) > 1
  ) AS duplicates;

  IF violating_submissions > 0 THEN
    RAISE EXCEPTION
      'Cannot create Grade_submissionId_key: % submission(s) already have more than one Grade row. No data was changed. Find them with: SELECT "submissionId", count(*) FROM "Grade" WHERE "submissionId" IS NOT NULL GROUP BY "submissionId" HAVING count(*) > 1; then resolve the duplicates by hand and rerun this migration.',
      violating_submissions;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Part A, step 2. One grade per submission (assignment grades only)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "Grade_submissionId_key"
  ON "Grade" ("submissionId")
  WHERE "submissionId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Part B, step 1. Preflight: abort with a clear message if any enrolment
-- already has more than one open completion record for a scope and course
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  violating_groups integer;
BEGIN
  SELECT count(*) INTO violating_groups
  FROM (
    SELECT 1
    FROM "CompletionRecord"
    WHERE "supersededAt" IS NULL
    GROUP BY "enrolmentId", "scope", COALESCE("courseId", '')
    HAVING count(*) > 1
  ) AS duplicates;

  IF violating_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot create CompletionRecord_open_key: % (enrolmentId, scope, courseId) group(s) already have more than one open CompletionRecord. No data was changed. Find them with: SELECT "enrolmentId", scope, COALESCE("courseId", '''') AS course, count(*) FROM "CompletionRecord" WHERE "supersededAt" IS NULL GROUP BY "enrolmentId", scope, COALESCE("courseId", '''') HAVING count(*) > 1; then resolve the duplicates by hand and rerun this migration.',
      violating_groups;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Part B, step 2. One open completion record per enrolment, scope and course
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "CompletionRecord_open_key"
  ON "CompletionRecord" ("enrolmentId", "scope", (COALESCE("courseId", '')))
  WHERE "supersededAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Reversal SQL (NOT executed; for a human rolling this change back)
-- ---------------------------------------------------------------------------
-- DROP INDEX "CompletionRecord_open_key";
-- DROP INDEX "Grade_submissionId_key";
