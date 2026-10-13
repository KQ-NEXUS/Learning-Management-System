---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 12
subsystem: database
tags: [nfr-03, nfr-14, idempotency, concurrency, partial-unique-index, prisma, testcontainers]
status: complete

requires:
  - phase: 15-07
    provides: integrity checks "one grade per submission" and "one open completion per enrolment/course" (report violations), scripts/ops/assert-local-db.ts guard
  - phase: 10-assessments
    provides: grading-service saveDraftGrade, attempt-service startAttempt with one unique-key retry
  - phase: 09-learner-progress
    provides: completion-service applyVerdict running inside the caller's transaction
  - phase: 07-payments
    provides: WebhookEvent unique key, recordWebhookEventOrSkip, FOR UPDATE settlement
provides:
  - migration 20261006120000_grade_completion_uniqueness (Grade_submissionId_key, CompletionRecord_open_key, two abort-on-duplicates preflights)
  - P2002 handling on the saveDraftGrade create path (loser updates the winner's draft, or GradeAlreadyReleasedError)
  - savepoint-protected P2002 handling in completion-service applyVerdict (loser returns "unchanged", caller's transaction stays usable)
  - four concurrency integration tests (grading, completion, Paystack 10x replay, quiz attempt starts)
affects: [15-13, 15-17, 15-28, 15-30, 15-31]

actuals:
  tokens: 13300
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Deterministic race in an integration test: a delegate wrapper holds the first N reads at a barrier so every caller takes the create path"
    - "Unique violation inside a caller-owned transaction: SAVEPOINT / ROLLBACK TO SAVEPOINT around the insert, so P2002 means 'already exists' without aborting the caller"
    - "Partial and expression unique indexes live only in the migration, documented by a comment on the Prisma model"

key-files:
  created:
    - prisma/migrations/20261006120000_grade_completion_uniqueness/migration.sql
    - tests/grading-concurrency.integration.test.ts
    - tests/completion-concurrency.integration.test.ts
    - tests/webhook-replay-concurrency.integration.test.ts
    - tests/attempt-concurrency.integration.test.ts
  modified:
    - prisma/schema.prisma
    - src/server/services/grading-service.ts
    - src/server/services/completion-service.ts

key-decisions:
  - "applyVerdict wraps the open-record insert in a SAVEPOINT: a bare P2002 catch inside the caller's transaction would leave Postgres in an aborted transaction and fail the lesson-progress / attendance / grade-release write that called it"
  - "CompletionServiceTxClient gains an optional $executeRaw; in-memory fakes without it keep working with the plain catch"
  - "saveDraftGrade's P2002 path re-reads the winner and applies the same DRAFT-only update predicate as the normal update path; a RELEASED winner is GradeAlreadyReleasedError"
  - "Webhook replay and attempt-start concurrency needed no code change; the new tests stay as regression proof"

patterns-established:
  - "Concurrency proof: Promise.allSettled + assert every outcome fulfilled + assert the row count, so a raw database error can never pass as 'one row'"

requirements-completed: [NFR-03, NFR-14]

coverage:
  - id: D1
    description: "Two concurrent grade saves for one submission leave one Grade row; the loser updates the winner's draft or gets GradeAlreadyReleasedError"
    requirement: NFR-14
    verification:
      - kind: integration
        ref: "tests/grading-concurrency.integration.test.ts"
        status: pass
      - kind: integration
        ref: "tests/grading-service.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two concurrent completion evaluations leave one open CompletionRecord and one course.completed event; both transactions commit"
    requirement: NFR-14
    verification:
      - kind: integration
        ref: "tests/completion-concurrency.integration.test.ts"
        status: pass
      - kind: unit
        ref: "tests/completion-service.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "One signed Paystack charge.success delivered 10 times at once settles once"
    requirement: NFR-03
    verification:
      - kind: integration
        ref: "tests/webhook-replay-concurrency.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Concurrent quiz attempt starts never produce two attempts with the same number"
    requirement: NFR-03
    verification:
      - kind: integration
        ref: "tests/attempt-concurrency.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Additive migration applied to the local Docker database through the guard; migrate status up to date; generate and tsc clean"
    requirement: NFR-14
    verification:
      - kind: other
        ref: "npx tsx scripts/ops/assert-local-db.ts && npx prisma migrate deploy && npx prisma migrate status && npx prisma generate && npx tsc --noEmit"
        status: pass
    human_judgment: false

duration: 95min
completed: 2026-10-08
---

# Phase 15 Plan 12: Grade and completion uniqueness with concurrency proofs Summary

**Two partial unique indexes (one grade per submission, one open completion record per enrolment/scope/course) with P2002 handling in grading and a savepoint-protected P2002 path in completion, plus four Testcontainers concurrency proofs including a 10x concurrent Paystack replay.**

## Performance

- **Duration:** about 95 min (much of it waiting on a slow Docker host)
- **Started:** 2026-10-07T22:00:00Z (approximate)
- **Completed:** 2026-10-07T23:40:00Z
- **Tasks:** 3 of 3
- **Files:** 5 created, 3 modified

## Accomplishments

- Proved the double-grade race was real, then closed it. Before the fix the grading concurrency test left 2 Grade rows for one submission (deterministic two-caller race), 3 rows from 10 unsynchronised saves, and a silent second row beside an already RELEASED grade. After the fix: one row, both callers resolve, and the late caller gets `GradeAlreadyReleasedError`.
- Proved the double-completion race was real, then closed it. Before the fix two concurrent evaluations both returned `created` and left two open CompletionRecords; a second open PROGRAMME record (courseId null) was also accepted. After: one `created`, one `unchanged`, one open record, one `course.completed` event, and the loser's later write in the same transaction commits.
- Ten concurrent deliveries of one signed Paystack `charge.success` through the real route: all 200, one WebhookEvent row ending PROCESSED, one Verify Transaction call (nine took the duplicate path), one SUCCEEDED attempt, one ACTIVE enrolment, one `order.paid` event, seat count unchanged. No code change needed.
- Ten concurrent quiz starts converge on one attempt (number 1); two concurrent "start new" calls produce gap-free distinct numbers with exactly one IN_PROGRESS. No code change needed.
- Migration applied to the local Docker database through the guard; both indexes confirmed in `pg_indexes`.

## Task Commits

None. The owner's standing rule is no commits; every change is left unstaged in the working tree for the owner to review and commit.

## Files Created/Modified

- `prisma/migrations/20261006120000_grade_completion_uniqueness/migration.sql` - header with the two read-only diagnostic SELECTs, two Step 1 `DO` blocks that `RAISE EXCEPTION` (changing nothing) on existing duplicates, `CREATE UNIQUE INDEX "Grade_submissionId_key" ... WHERE "submissionId" IS NOT NULL`, `CREATE UNIQUE INDEX "CompletionRecord_open_key" ON ("enrolmentId", "scope", (COALESCE("courseId", ''))) WHERE "supersededAt" IS NULL`, and reversal SQL in comments only. No `DROP` outside comments.
- `prisma/schema.prisma` - comments above `model Grade` and `model CompletionRecord` naming each index, why it lives only in the migration, and a warning not to let `prisma migrate dev` / `db push` drop it.
- `src/server/services/grading-service.ts` - `prismaErrorCode` helper; `saveDraftGrade` update logic moved into `updateDraft`; P2002 on create re-reads the winner and updates its draft, or throws `GradeAlreadyReleasedError`; the audit `before` reflects the winner's row.
- `src/server/services/completion-service.ts` - `createOpenRecord` (SAVEPOINT, create, ROLLBACK TO SAVEPOINT on P2002, RELEASE on success); `applyVerdict` returns `unchanged` and emits no event when it loses; optional `$executeRaw` on `CompletionServiceTxClient`.
- `tests/grading-concurrency.integration.test.ts` - 4 cases (barrier race, 10 unsynchronised saves, released winner, null submissionId unaffected).
- `tests/completion-concurrency.integration.test.ts` - 3 cases (barrier race across two real transactions, superseded plus open, PROGRAMME null-course collision).
- `tests/webhook-replay-concurrency.integration.test.ts` - 1 case, 10 concurrent signed deliveries through the real Paystack route.
- `tests/attempt-concurrency.integration.test.ts` - 2 cases (10 concurrent resumes, 2 concurrent start-new).

## Decisions Made

- Savepoint instead of a bare catch in `applyVerdict` (see Deviations 1).
- Grading needs no savepoint: `saveDraftGrade`'s create runs on the base client, not inside a transaction, so after P2002 the connection is still usable.
- The describe blocks of three new test files set a 60 s case timeout; the default 5 s was too short on this host.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A plain P2002 catch in applyVerdict would still fail the caller's transaction**
- **Found during:** Task 2
- **Issue:** The plan says to catch P2002 on create in `applyVerdict` and return the "already exists" result. `applyVerdict` runs inside the caller's transaction (lesson progress, attendance, grade release, submission, override). In Postgres any error aborts the whole transaction, so after a caught P2002 every later statement fails ("current transaction is aborted"). The caller would still get a 500 and roll back the learner's own write.
- **Fix:** `createOpenRecord` wraps the insert in `SAVEPOINT completion_record_create`, rolls back to it on P2002 and returns false (`applyVerdict` then returns `unchanged`, which is the value it already returns when it finds an open record), and releases it on success. `$executeRaw` is optional on the structural tx type so the unit-test fakes are unchanged. P2002 handling is still what decides the outcome, as the plan asks.
- **Files modified:** src/server/services/completion-service.ts
- **Verification:** `tests/completion-concurrency.integration.test.ts` case 1 writes an audit row in the loser's transaction after the conflict and asserts both rows committed; `tests/completion-service.test.ts`, `tests/certificate-issuance-service.test.ts` and `tests/learner-journey.integration.test.ts` pass.

**2. [Rule 3 - Blocking] Default 5 s test timeout too short on this host**
- **Found during:** Task 2
- **Issue:** On the first run every completion case timed out at 5 s while seeding (Docker API calls were taking 7 to 9 s each, with under 1 GB of host memory free).
- **Fix:** A `{ timeout: 60_000 }` option on the describe block in the grading, completion and attempt concurrency files. The assertions did not change.
- **Files modified:** the three test files above

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Deviation 1 is required for the plan's own truth ("the service treating a unique violation as already completed") to hold inside a real transaction. There is no scope creep.

## RED / GREEN record (TDD evidence)

| Test | Before fix | After fix |
| --- | --- | --- |
| grading-concurrency: two-caller race | FAIL, 2 Grade rows | PASS, 1 row, both callers fulfilled |
| grading-concurrency: 10 unsynchronised saves | FAIL, 3 Grade rows | PASS, 1 row |
| grading-concurrency: released winner | FAIL, a second row was silently created | PASS, GradeAlreadyReleasedError, 1 row |
| grading-concurrency: null submissionId | PASS | PASS |
| completion-concurrency: two-transaction race | FAIL, actions [created, created] | PASS, [created, unchanged], 1 open record, 1 event, both transactions committed |
| completion-concurrency: superseded plus open | FAIL, 3 records (2 open) | PASS, 2 records, 1 open |
| completion-concurrency: PROGRAMME null course | FAIL, second open record accepted | PASS, P2002 |
| webhook-replay-concurrency | PASS without code change | PASS (regression proof) |
| attempt-concurrency (2 cases) | PASS without code change | PASS (regression proof) |

## Checks run

- `npx prisma validate`: valid.
- Task 1 verify: `npx vitest run tests/grading-concurrency.integration.test.ts tests/grading-service.integration.test.ts --no-file-parallelism`: 2 files, 17 tests passed.
- Task 2 verify: `npx vitest run tests/completion-concurrency.integration.test.ts tests/webhook-replay-concurrency.integration.test.ts tests/attempt-concurrency.integration.test.ts --no-file-parallelism`: 3 files, 6 tests passed.
- Unit: `tests/completion-service.test.ts`, `tests/grading-service.test.ts`, `tests/certificate-issuance-service.test.ts`: 107 passed.
- Regression: `tests/integrity-checks.integration.test.ts` 18 passed (its violation cases drop the new indexes inside a rolled-back transaction, and its name match picks them up). `tests/learner-journey.integration.test.ts` 2 passed.
- Task 3 (shell `DATABASE_URL` = the local Docker database, never `.env`): `npx tsx scripts/ops/assert-local-db.ts` printed "database target is local (localhost)". `npx prisma migrate deploy` applied `20261006120000_grade_completion_uniqueness`. `npx prisma migrate status` printed "Database schema is up to date!". `npx prisma generate` succeeded. `npx tsc --noEmit` exited 0 with no errors. `pg_indexes` lists both `CompletionRecord_open_key` and `Grade_submissionId_key`. No command used `db push` or `accept-data-loss`.
- `npx eslint` on the 2 services and 4 new tests: clean.

## Neon go-live list

- `prisma/migrations/20261006120000_grade_completion_uniqueness` (additive; two partial unique indexes). BEFORE applying on Neon, run the two read-only diagnostic SELECTs in the migration header. Each must return no rows. If either returns rows, the migration aborts by design and changes nothing. A human resolves the duplicates first; nothing is auto-resolved. Plan 15-31 copies this into the ordered list.

## Issues Encountered

- Docker Desktop was very slow under host memory pressure (about 0.8 GB free; `docker inspect` took 7 to 9 s). Testcontainers runs failed several times with "(HTTP code 500) server error" on container inspect, before any test code ran. Each failed run was simply repeated, and every reported result comes from a run that started its container. One leaked Testcontainers Postgres container from a failed run was removed. No Testcontainers containers are left running.

## Owner notes

- Future `prisma migrate dev` runs may propose `DROP INDEX` for these two indexes, as they can for the existing partial enrolment index, because Prisma's schema cannot express them. Delete those lines from any generated migration. The schema comments say this too.
- Under concurrency, a second "start a new attempt" click abandons the attempt the first click just created. Attempt numbers stay distinct and only one attempt is left in progress. This is existing behaviour and is unchanged.

## User Setup Required

None.

## Next Phase Readiness

- The local database carries both indexes. Later plans that add migrations must apply on top of `20261006120000`.
- Plan 15-31 must add this migration and its diagnostics to the Neon go-live list.

## Self-Check: PASSED
