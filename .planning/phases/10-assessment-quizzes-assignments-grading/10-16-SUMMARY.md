---
phase: 10-assessment-quizzes-assignments-grading
plan: 16
subsystem: testing
tags: [vitest, testcontainers, postgres, minio, s3, prisma, integration-test]

# Dependency graph
requires:
  - phase: 10-05
    provides: submission-service.ts (the verified two-step upload pipeline)
  - phase: 10-07
    provides: grading-service.ts (Cohort-scoped grading queue, draft/release, batch release)
  - phase: 10-09
    provides: grade-override-service.ts, learner-results-service.ts
provides:
  - Real Postgres + MinIO proof of ASM-04's never-false-success upload invariant, including three distinct failure modes
  - Real Postgres proof that a COHORT-scoped grant is DENIED (not silently filtered) on a sibling cohort's submission
  - Real Postgres proof that releaseGradesBatch commits exact per-grade/outbox/audit counts atomically, or none of them
  - Real Postgres proof that only overrideGrade may change an already-RELEASED score
  - Real Postgres proof that the learner results read is filtered by status:"RELEASED" in the database, not in memory
  - The first real-MinIO integration-test path in this codebase (env-var-before-dynamic-import technique), reusable by future object-store integration tests
affects: [10-17, phase-15-launch-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-MinIO integration test: set S3_* env vars at module top, then reach storage-service.ts/submission-service.ts only through a dynamic `await import(...)` — a static top-level import would lock the module-scoped S3Client to whatever env vars were present before this file's own assignments ran."
    - "Services with no createPrismaBacked* convenience factory (grading-service.ts, grade-override-service.ts, learner-access.ts, learner-results-service.ts) are built directly from their injectable factory function against testDb.prisma-cast delegates, mirroring the pattern attendance-service.ts's createPrismaBackedAttendanceService already established for services that DO have one."
    - "A real PUT to a presigned URL only signs the `host` header by default (verified empirically against this environment's MinIO) — a mismatched Content-Type header is accepted by the store, which is what makes the app-level content-type-verification test case meaningful rather than redundant with S3's own signature check."

key-files:
  created:
    - tests/submission-service.integration.test.ts
    - tests/grading-service.integration.test.ts
    - tests/learner-results.integration.test.ts
  modified: []

key-decisions:
  - "Reached the real docker-compose MinIO container at its published host port (localhost:9002), not the .env.example's in-network default of 9000 — verified reachable with the .env.example placeholder credentials (lms-minio/change-me-minio) and holding the lms-private bucket before writing any test."
  - "Grading-service.integration.test.ts's Cohort-scope fixture uses a Programme with two Cohorts (both pinned to the same Programme, each carrying a CohortCourse row to a shared Course) rather than two standalone-course Cohorts, so ONE fixture shape supports COHORT-, PROGRAMME- and COURSE-scoped grant assertions without three separate seed helpers."
  - "learner-results.integration.test.ts's submissions reader is built via submission-service.ts's createSubmissionService with throwing stubs for storage/presign/audit — getOwnSubmissions never calls any of those, so a stub that throws loudly if one is ever exercised is a stronger safety net than a silent no-op."

requirements-completed: [ASM-04, ASM-05, ASM-06, ASM-07]

# Metrics
duration: ~65min (across an interrupted session; see Issues Encountered)
completed: 2026-09-15
---

# Phase 10 Plan 16: Real-Infrastructure Proof for Upload, Grading and Results Summary

**Three real-Postgres/MinIO integration suites (25 test cases) proving ASM-04's never-false-success receipt, ASM-05/06's Cohort-scoped grading and override boundary, and ASM-07's released-only learner read — the phase's four riskiest invariants, previously proven only against in-memory fakes.**

## Performance

- **Duration:** ~65 min of active execution (plus an environment-driven pause; see Issues Encountered)
- **Started:** 2026-09-15T22:40:00+01:00 (approx.)
- **Completed:** 2026-09-15T23:37:00+01:00
- **Tasks:** 3
- **Files modified:** 3 (all new test files)

## Accomplishments

- Established this codebase's first real-MinIO integration-test path (`tests/submission-service.integration.test.ts`) — every prior object-store test mocks the S3 client. Proved the happy path, three distinct never-false-success failure modes (no PUT, size mismatch, content-type mismatch), pre-presign constraint refusals, the `dueAt`/`availableUntil` window, resubmission, and a genuine concurrent-duplicate-begin unique-constraint race, all against the real, already-running `learning-management-system-minio-1` container.
- Proved `grading-service.ts`'s Cohort scoping is a real denial (`AuthorizationError` + no written row), not a silently-filtered empty result, against a sibling cohort's submission — and that a PROGRAMME/COURSE-scoped grant reaches both cohorts through the three-key scope resolution rather than a cohort-id equality check.
- Proved `releaseGradesBatch`'s atomicity with exact counts (three grade updates, three outbox rows, three per-grade audit rows plus the batch-level entry) and its all-or-nothing authorization (a mixed-cohort batch under a single-cohort grant leaves every grade unchanged).
- Proved the released-grade write boundary end to end: `saveDraftGrade` refuses a RELEASED grade with the score unchanged; `overrideGrade` is the only path that can change it, and does so with a persisted `previousScore` matching the pre-override database value.
- Proved the learner results read filters `status: "RELEASED"` in the database — a real DRAFT grade row was seeded, confirmed present via a direct Prisma read, and confirmed absent from `getOwnResults`'s full serialised output — closing the "fake happens to never hold a draft row" gap the unit test cannot close.

## Task Commits

Each task was committed atomically:

1. **Task 1: tests/submission-service.integration.test.ts — real Postgres + MinIO** - `ab74569` (test)
2. **Task 2: tests/grading-service.integration.test.ts — real Postgres** - `1afd3b8` (test)
3. **Task 3: tests/learner-results.integration.test.ts — real Postgres** - `36ccbd6` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `tests/submission-service.integration.test.ts` - 11 cases proving ASM-04's verified-upload receipt against real Postgres + real MinIO
- `tests/grading-service.integration.test.ts` - 12 cases proving Cohort scoping, batch atomicity and the override boundary (ASM-05/ASM-06) against real Postgres
- `tests/learner-results.integration.test.ts` - 2 cases (one large scenario + obligations) proving the released-only learner read and cross-learner isolation (ASM-05..ASM-07) against real Postgres

## Decisions Made

- The real MinIO container is reached at `localhost:9002` (its docker-compose-published host port), not the `.env.example` default of `9000` (which is the in-Compose-network address for a process running inside the stack). Verified reachable with the `.env.example` placeholder credentials before writing any test.
- `storage-service.ts`'s module-scoped `S3Client` is constructed once, from `process.env.S3_*`, the first time the module is evaluated. `tests/submission-service.integration.test.ts` therefore sets every `S3_*` var at the very top of the file, then reaches `submission-service.ts`/`storage-service.ts` only through a dynamic `await import(...)` — a static top-level import (even textually placed after the env-var assignments) would still evaluate before them, because static imports are hoisted. This mirrors the technique `tests/learner-journey.integration.test.ts` already uses for `DATABASE_URL`.
- Empirically verified (against the real running MinIO) that a presigned PUT URL from this codebase's `presignLessonUploadUrl` signs only the `host` header (`X-Amz-SignedHeaders=host`) — a PUT with a mismatched `Content-Type` header succeeds at the storage layer. This is what makes `completeSubmissionUpload`'s own content-type verification load-bearing, and is why the "content-type mismatch" test case is meaningful rather than something S3 would already refuse.
- `grading-service.ts` and `grade-override-service.ts` (plan 10-07/10-09) and `learner-access.ts`/`learner-results-service.ts` (plan 10-09) have no `createPrismaBacked*` convenience factory — only `attempt-service.ts` and `attendance-service.ts` do. Every test in this plan builds the remaining services directly from their injectable factory function (`createGradingService`, `createGradeOverrideService`, `createLearnerAccessService`, `createLearnerResultsService`, `createSubmissionService`) against `testDb.prisma`-cast delegates, never the app-singleton-bound live export.
- `tests/grading-service.integration.test.ts`'s cross-cohort fixture uses one Programme with two Cohorts (each carrying a `CohortCourse` row to a shared Course), rather than two standalone-course Cohorts, so a single fixture shape exercises COHORT-, PROGRAMME- and COURSE-scoped grants without three separate seed helpers.

## Deviations from Plan

None - plan executed exactly as written. The plan's own interface note anticipated exactly the situation found (`tests/lesson-resource-service.test.ts` uses an in-memory fake, not real MinIO) and its instruction ("if it does not [exist], establish one here using the same env vars `storage-service.ts` already reads") was followed directly.

## Issues Encountered

- Mid-session, after Tasks 1 and 2 had both run green against the real Docker stack, Docker Desktop's engine began returning persistent `500 Internal Server Error` responses to every API call (`docker ps`, `docker version`), blocking Task 3's first two attempts (`Could not find a working container runtime strategy`, then `P1001: Can't reach database server`). This was a mid-session infrastructure fault, not a pre-existing "Docker unavailable in this sandbox" condition — Tasks 1 and 2 are direct proof Docker was healthy and fully functional for over 10 minutes immediately before this happened. Restarting the Docker Desktop backend was outside this agent's available tool surface (`wsl`/service-manager commands are blocked for worktree-isolated agents), so the engine was left to recover on its own; it did, after roughly 20 minutes, and `learning-management-system-minio-1`/`-postgres-1`/`-clamav-1` came back healthy with their existing data intact (the MinIO `lms-private` bucket persisted through the restart via its volume). Task 3 then ran green on retry, and all three files were re-verified together (25/25 passing) after recovery.
- A full-project `npx vitest run` was started in the background as an extra check beyond the plan's own file-scoped verification but did not finish within the session window before this summary was written; the plan's required verification (the three files together, 25/25 green) is confirmed. A follow-up full-suite run is a reasonable pre-merge check but is not blocking this plan's completion, since Tasks 1-3 touch no existing file — every change in this plan is a wholly new test file, so a pre-existing failure elsewhere cannot be a regression this plan introduced.

## User Setup Required

None - no external service configuration required. The real Postgres/MinIO/ClamAV containers this plan's tests depend on were already running and healthy in this environment (10-RESEARCH.md Environment Availability) before this plan began.

## Next Phase Readiness

- ASM-04, ASM-05, ASM-06 and ASM-07's riskiest claims each now have a real-infrastructure proof, closing the gap the plan's objective named: every other Phase 10 test drives its service with a fake.
- The env-var-before-dynamic-import technique for real-MinIO testing (established here for the first time) is reusable by any future object-store integration test in this codebase.
- No blockers for 10-17 or later phases. Docker/MinIO/Postgres are confirmed healthy as of this plan's completion.

---
*Phase: 10-assessment-quizzes-assignments-grading*
*Completed: 2026-09-15*


## Integrated Wave 5 closeout (2026-09-16)

All four Wave 5 branches are integrated into Khaliddev. The final Turbopack production build and its TypeScript check passed after closeout fixes. Changed production files passed lint.

Verification: 157 focused server tests; 25 real PostgreSQL/MinIO integration cases; 41 assessment UI component cases plus 14 LessonContent cases. The broad unit run passed 119 files / 1,986 tests, with two checkout source-scan cases hitting the default 5-second timeout; the isolated checkout invariant rerun passed 10/10 at 30 seconds. No assertion failure remained in the affected suites. Full historical component/infrastructure limitations are retained in deferred-items.md.

Closeout fixed three fixture compilation issues: explicit draft ID array typing, an optional audit target ID, and a Uint8Array fetch body. Fix commit: 422e018. The changed real upload suite was rerun against PostgreSQL/MinIO and passed 11/11 after these fixes. The original completion summary is committed on the worker branch and merged.

Only plan 10-17 remains: phase invariant gates, validation contract and human walkthrough.
