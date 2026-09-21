-- CR-06 (phase 11, plan 11-27): a COMPLETED enrolment must keep holding the
-- one-live-enrolment slot for its learner and cohort.
--
-- Background. `enrolment_one_active_per_learner_cohort` was
-- UNIQUE ("userId", "cohortId") WHERE status = 'ACTIVE'. It is partial on
-- purpose (REG-03): a plain UNIQUE would stop a learner who WITHDREW, was
-- CANCELLED or was TRANSFERRED from ever enrolling again. Phase 11 issuance
-- moves an enrolment to COMPLETED, which freed that slot, so staff or checkout
-- could create a second ACTIVE enrolment for the same learner and cohort. A
-- later revoke, or a CRD-06 review flag (COMPLETED -> ACTIVE), then violated
-- the index (P2002) and failed permanently.
--
-- Fix. Replace it with an index over ACTIVE and COMPLETED. WITHDRAWN,
-- CANCELLED, TRANSFERRED and PENDING_PAYMENT stay outside the index, so
-- re-enrolment after those is unaffected. Application code translates any
-- P2002 on enrolment create to AlreadyEnrolledError and never matches on the
-- index name, so the rename is safe.
--
-- This migration is additive and never deletes or rewrites enrolment data.
-- Step 1 aborts, changing nothing, if existing rows would violate the widened
-- index. Which of two enrolments is the real one is a human call, so nothing is
-- auto-resolved. Postgres DDL is transactional, so an abort leaves the schema
-- exactly as it was.
--
-- Run this read-only diagnostic BEFORE applying to a shared database. It must
-- return no rows:
--
--   SELECT "userId", "cohortId", count(*) AS live_enrolments
--   FROM "Enrolment"
--   WHERE status IN ('ACTIVE', 'COMPLETED')
--   GROUP BY "userId", "cohortId"
--   HAVING count(*) > 1;

-- ---------------------------------------------------------------------------
-- 1. Preflight: abort with a clear message if the widened index cannot be built
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  violating_pairs integer;
BEGIN
  SELECT count(*) INTO violating_pairs
  FROM (
    SELECT 1
    FROM "Enrolment"
    WHERE status IN ('ACTIVE', 'COMPLETED')
    GROUP BY "userId", "cohortId"
    HAVING count(*) > 1
  ) AS duplicates;

  IF violating_pairs > 0 THEN
    RAISE EXCEPTION
      'Cannot create enrolment_one_live_per_learner_cohort: % (userId, cohortId) pair(s) already have more than one ACTIVE or COMPLETED enrolment. No data was changed. Find them with: SELECT "userId", "cohortId", count(*) FROM "Enrolment" WHERE status IN (''ACTIVE'', ''COMPLETED'') GROUP BY "userId", "cohortId" HAVING count(*) > 1; then resolve the duplicates by hand and rerun this migration.',
      violating_pairs;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Create the widened index FIRST, so there is never a window without protection
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX enrolment_one_live_per_learner_cohort
  ON "Enrolment" ("userId", "cohortId")
  WHERE status IN ('ACTIVE', 'COMPLETED');

-- ---------------------------------------------------------------------------
-- 3. Drop the narrower index it supersedes
-- ---------------------------------------------------------------------------
DROP INDEX enrolment_one_active_per_learner_cohort;

-- ---------------------------------------------------------------------------
-- Reversal SQL (NOT executed; for a human rolling this change back)
-- ---------------------------------------------------------------------------
-- CREATE UNIQUE INDEX enrolment_one_active_per_learner_cohort
--   ON "Enrolment" ("userId", "cohortId")
--   WHERE status = 'ACTIVE';
-- DROP INDEX enrolment_one_live_per_learner_cohort;
