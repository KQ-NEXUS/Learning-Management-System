---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 01
subsystem: database
tags: [prisma, postgres, migrations, testcontainers, check-constraints, outbox]

# Dependency graph
requires:
  - phase: 04-catalogue-content-versioning-publishing
    provides: "prisma/sql paste-in convention (002_catalogue_integrity.sql), tests/support/pg.ts Testcontainers harness, CoursePublication/ProgrammePublication pins"
provides:
  - "Cohort.holdMinutes Int? @default(30) — per-cohort seat-hold TTL (D-02)"
  - "Enrolment.holdExpiresAt DateTime? + @@index([status, holdExpiresAt]) — cheap indexed hold-sweep lookup (D-03)"
  - "Enrolment.transferredFromId + named EnrolmentTransfer self-relation (D-13)"
  - "model DomainEvent — append-only transactional outbox (type/payload/occurredAt/processedAt) (D-14, D-20)"
  - "Migration 20260904092220_cohort_operations, applied, with 4 raw-SQL CHECK constraints pasted in"
  - "tests/support/cohort-fixtures.ts — seedCohortFixture / seedLearnerFixture / seedSessionFixture / seedEnrolmentFixture / seedAttendanceFixture"
  - "tests/schema-cohort.test.ts — static + Testcontainers regression proof for the delta"
affects: [seat-accounting, enrolment-service, hold-release-worker, attendance-service, domain-event-service, roster-service, cohort-readiness, deploy-runbook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New raw-SQL CHECK: companion prisma/sql/NNN_*.sql + verbatim paste into migration.sql + tests/schema-*.test.ts asserting the name appears in an applied migration (RESEARCH Pitfall 2)"
    - "Transactional outbox table (DomainEvent) written in the same $transaction as its mutation"
    - "Shared, self-parenting, counter-suffixed test fixtures for a whole cohort graph"

key-files:
  created:
    - "prisma/sql/003_cohort_operations.sql"
    - "prisma/migrations/20260904092220_cohort_operations/migration.sql"
    - "tests/support/cohort-fixtures.ts"
    - "tests/schema-cohort.test.ts"
  modified:
    - "prisma/schema.prisma"

key-decisions:
  - "DomainEvent indexes: @@index([processedAt, occurredAt]) for the Phase-13 drain scan + @@index([type]); plan specified processedAt so a composite with occurredAt was chosen for drain ordering"
  - "attendance_correction_has_reason uses length(btrim(...)) > 0 so whitespace-only reasons are rejected at the DB"
  - "Migration directory name: 20260904092220_cohort_operations (referenced by later plans and the deploy runbook)"

patterns-established:
  - "Pattern: additive Prisma delta + pasted raw CHECK + schema regression test, mirroring 002_catalogue_integrity.sql"
  - "Pattern: cohort-fixtures module is the single seed shape for every DB-dependent Phase-5 test"

requirements-completed: [COH-01, COH-02, COH-06]

# Metrics
duration: 13min
completed: 2026-09-04
---

# Phase 5 Plan 01: Cohort Operations Schema Delta Summary

**Additive Prisma delta (Cohort.holdMinutes, Enrolment.holdExpiresAt + transfer self-relation, DomainEvent outbox) applied as migration 20260904092220_cohort_operations with four raw-SQL CHECK constraints pasted in and proven by tests/schema-cohort.test.ts against real Postgres.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-09-04T09:16:00Z
- **Completed:** 2026-09-04T09:29:08Z
- **Tasks:** 3
- **Files modified:** 5 (1 modified, 4 created)

## Accomplishments
- Schema delta: `Cohort.holdMinutes Int? @default(30)`, `Enrolment.holdExpiresAt`, `Enrolment.transferredFromId` + named `EnrolmentTransfer` self-relation, `@@index([status, holdExpiresAt])`, `@@index([transferredFromId])`, and new `model DomainEvent` (append-only outbox).
- `prisma/sql/003_cohort_operations.sql` declaring exactly four constraints Prisma cannot express: `cohort_hold_minutes_non_negative`, `enrolment_transfer_not_self`, `enrolment_hold_expiry_only_when_pending`, `attendance_correction_has_reason` — and duplicating none of the four already in the init migration.
- Migration `20260904092220_cohort_operations` generated `--create-only`, the four `ALTER TABLE ... ADD CONSTRAINT` statements pasted in verbatim, then applied to the Neon dev database; `npx prisma migrate status` reports no drift.
- `tests/support/cohort-fixtures.ts` — five self-parenting, counter-suffixed seed helpers covering the full cohort → learner → session → enrolment → attendance graph.
- `tests/schema-cohort.test.ts` — 21 tests: static assertions over the schema + joined migration text, Testcontainers rejection proofs for each new CHECK (plus accept-path proofs), and a regression guard that `cohort_targets_exactly_one_offer` and `cohort_dates_ordered` still bite.

## Task Commits

1. **Task 1: Schema delta and raw-SQL companion** - `a7022b0` (feat)
2. **Task 2: Generate and apply the migration with raw SQL pasted in** - `6afe490` (feat)
3. **Task 3: Constraint regression test and shared cohort fixtures** - `0fc6c43` (test)

## Files Created/Modified
- `prisma/schema.prisma` - Cohort.holdMinutes; Enrolment.holdExpiresAt / transferredFromId / EnrolmentTransfer self-relation / two indexes; new model DomainEvent
- `prisma/sql/003_cohort_operations.sql` - Four CHECK constraints + header stating the paste-in and regression-test obligation
- `prisma/migrations/20260904092220_cohort_operations/migration.sql` - Generated additive migration with the four constraints appended verbatim
- `tests/support/cohort-fixtures.ts` - seedCohortFixture / seedLearnerFixture / seedSessionFixture / seedEnrolmentFixture / seedAttendanceFixture
- `tests/schema-cohort.test.ts` - Static + Testcontainers regression proof of the delta

## Decisions Made
- `DomainEvent` given a composite `@@index([processedAt, occurredAt])` (plus `@@index([type])`) rather than the plan's bare `@@index([processedAt])` — the Phase-13 drain scans unprocessed rows oldest-first, so ordering the index by `occurredAt` serves that query directly. Non-breaking superset of the plan.
- `attendance_correction_has_reason` written with `length(btrim("correctionReason")) > 0` so a whitespace-only reason is rejected at the database, matching ATT-03's intent.

## Deviations from Plan

### Environment deviation (not a code deviation)

**1. Executed in the main checkout on branch `Khaliddev`, not a `worktree-agent-*` worktree**
- **Found during:** Startup (worktree_branch_check)
- **Issue:** The spawn environment placed the working directory at the main repo root (`.git` is a directory, HEAD on `Khaliddev`), not in a linked worktree. The three existing `.claude/worktrees/agent-*` worktrees hold unrelated stale Phase-4 work.
- **Handling:** Proceeded on `Khaliddev` (the developer's own feature branch per project memory, not a protected ref — main/master/develop/trunk/release/*). Per-commit worktree HEAD/path assertions are worktree-only (`.git` as a file) and do not apply here. Each task was still committed atomically with hooks (no `--no-verify`).
- **Impact:** None on deliverables. `.planning/` is gitignored (commit `da5d31a`), so this SUMMARY.md is written to disk but is not tracked/committed.

### Auto-fixed Issues

None - the three tasks executed as written.

---

**Total deviations:** 0 code deviations; 1 environment note.
**Impact on plan:** None. All acceptance criteria met.

## Issues Encountered
- Removing one `ADD CONSTRAINT` line from the new `migration.sql` was verified to fail `tests/schema-cohort.test.ts` (the "appears in an applied migration file" assertion), then restored — the migration.sql shows no diff against its committed state.

## User Setup Required
None - no external service configuration required. Note for the deploy runbook: `npx prisma migrate deploy` must run on deploy to apply `20260904092220_cohort_operations`.

## Next Phase Readiness
- The generated Prisma client knows `DomainEvent`, `Cohort.holdMinutes`, `Enrolment.holdExpiresAt`, `Enrolment.transferredFromId`.
- `tests/support/cohort-fixtures.ts` is ready for the seat-accounting, enrolment-state-machine, hold-sweep and attendance plans to seed from.
- Verification suites `tests/schema-catalogue.test.ts`, `tests/schema-auth.test.ts`, `tests/schema-identity.test.ts`, `tests/prisma-contract.test.ts`, `tests/boundary.test.ts`, `tests/readiness.test.ts` all stay green (68 tests).

## Self-Check: PASSED
- `prisma/sql/003_cohort_operations.sql` - FOUND
- `prisma/migrations/20260904092220_cohort_operations/migration.sql` - FOUND
- `tests/support/cohort-fixtures.ts` - FOUND
- `tests/schema-cohort.test.ts` - FOUND
- Commit `a7022b0` - FOUND
- Commit `6afe490` - FOUND
- Commit `0fc6c43` - FOUND

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
