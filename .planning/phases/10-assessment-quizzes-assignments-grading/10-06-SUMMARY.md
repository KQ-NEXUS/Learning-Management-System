---
phase: 10-assessment-quizzes-assignments-grading
plan: 06
subsystem: assessment
status: complete
tags: [quiz, scoring, snapshot, expiry, postgres]
provides:
  - Server-scored quiz submission and automatically released grades
  - Lazy expiry and effective assessment results
  - Real-Postgres snapshot and evidence tests
key-files:
  modified: [src/server/services/attempt-service.ts, tests/attempt-service.test.ts]
  created: [tests/attempt-service.integration.test.ts]
---

# Phase 10 Plan 06 Summary

Resumed the existing Wave 3 worktree after Claude's session limit. Preserved implementation commit d151fea and completed the integration-test closeout on the main branch.

## Delivered

- Submission merges accepted responses into the frozen question snapshot, scores on the server, persists the terminal attempt, and creates an already RELEASED quiz grade with system attribution.
- The shared submission path writes attempt and grade domain events in the transaction and audits the learner trigger.
- Reads lazily resolve expired attempts, and effective results honour HIGHEST, LATEST, and AVERAGE while excluding abandoned attempts.
- Six real-Postgres cases verify JSON evidence, snapshot immunity, scoring reproducibility, grades/events/audit, attempt limits, and expiry.

## Verification

- Attempt-service and quiz-scoring unit suites: 62 passed.
- Real-Postgres integration suite: 6 passed, exit 0; all 11 migrations deployed to a throwaway postgres:16-alpine container.
- Initial sandbox integration attempt could not reach Docker. Re-run with Docker access passed; the blocked attempt was not counted as passing.
- Focused service/test lint: exit 0.
- Worktree type-check reported missing generated LayoutProps in the untouched root layout. Production build generates framework route types; integrated production build passed and generated route types.

## Integrated closeout

Integrated production build passed, focused lint passed, and all 110 combined Wave 3 unit/route/boundary tests passed. Broader Node regression results are recorded below. No new packages or schema changes.

## Broader regression findings

The Node regression run found pre-existing enrolment integration failures (missing DATABASE_URL in the existing global cohort-scope client), reproduced on pre-Wave 3 HEAD 0b0b2b3. A payment source-invariant scan hit the default 5-second timeout; isolated rerun at 15 seconds passed 10/10. See deferred-items.md.

Final full Node regression result: 128 files passed / 3 failed; 2101 tests passed / 17 failed; exit 1, 755.61 seconds. Failures: ten enrolment integration cases and six cohort lifecycle cases using the existing global cohort-scope client without DATABASE_URL, plus one payment-invariant timeout (isolated rerun passed 10/10 at a 15-second timeout). No assessment Wave 3 tests failed in the full run.

## Self-Check: PASSED

Required artifacts exist on Khaliddev. Integrated production build, TypeScript check, focused lint, and 110 combined Wave 3 tests passed. Plan 10-06 also passed its six real-Postgres cases. Broader-suite limitations are recorded above and in deferred-items.md.
