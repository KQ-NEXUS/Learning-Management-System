---
phase: 11-certificates-completion-lifecycle
plan: 27
subsystem: database
tags: [postgres, prisma, migration, partial-unique-index, enrolment, certificates, testcontainers]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "Plan 11-24 issuance state machine (ACTIVE to COMPLETED) and the D-06 reversal that this plan protects"
provides:
  - "Migration widening the one-live-enrolment partial unique index to ACTIVE and COMPLETED, with a violation preflight"
  - "Real-Postgres proof of the widened index, REG-03 re-enrolment, the D-06 reversal and the preflight abort path"
  - "CR-05 recorded as a deliberately deferred decision"
affects: [11-33 (human apply of migration to shared databases), certificate revoke and flag reversal]

tech-stack:
  added: []
  patterns:
    - "Hand-written additive migration: preflight DO block, create new index before dropping old, reversal SQL in comments"
    - "Migration statements executed through Testcontainers only, parsed from the file (DO block lifted by $$ delimiters)"

key-files:
  created:
    - prisma/migrations/20260919120000_enrolment_one_live_per_learner_cohort/migration.sql
    - tests/enrolment-live-index.integration.test.ts
  modified:
    - src/server/services/seat-accounting.ts
    - src/server/services/enrolment-service.ts
    - tests/schema-cohort.test.ts
    - .planning/phases/11-certificates-completion-lifecycle/11-DECISIONS.md

key-decisions:
  - "Index renamed to enrolment_one_live_per_learner_cohort because the old name would lie; no src code matches on the index name (P2002 is duck-typed on the code)"
  - "Preflight aborts rather than auto-resolving duplicates: nothing in the data says which of two enrolments is real"
  - "CR-05 deferred with no code change and no Clear-flag control (locked UAT decision)"

patterns-established:
  - "Index creation precedes the drop of the index it supersedes, so there is never an unprotected window"

requirements-completed: [CRD-05, CRD-06]

duration: ~25min
completed: 2026-09-19
---

# Phase 11 Plan 27: One-live-enrolment index (CR-06) and CR-05 deferral Summary

**Additive, preflight-guarded migration widening the enrolment partial unique index to ACTIVE and COMPLETED so the revoke/flag reversal can no longer hit P2002, proven on real Postgres; CR-05 recorded as deferred.**

## Performance

- **Tasks:** 3 of 3
- **Files modified:** 6 (2 created)

## Accomplishments

- New migration `20260919120000_enrolment_one_live_per_learner_cohort`: (1) a `DO $$` preflight that counts violating (userId, cohortId) pairs among ACTIVE and COMPLETED rows and raises an exception naming the index, the count and the diagnostic query, modifying nothing; (2) `CREATE UNIQUE INDEX enrolment_one_live_per_learner_cohort ... WHERE status IN ('ACTIVE', 'COMPLETED')`; (3) `DROP INDEX enrolment_one_active_per_learner_cohort`. Reversal SQL is in comments. No DML, enum or table change.
- Real-Postgres tests prove: COMPLETED plus ACTIVE (and COMPLETED plus COMPLETED) is rejected P2002; `takeSeat` raises `AlreadyEnrolledError` and rolls the seat back; ACTIVE plus ACTIVE still rejected; re-enrolment after WITHDRAWN, CANCELLED and TRANSFERRED still works (REG-03); COMPLETED does not block a WITHDRAWN row; COMPLETED to ACTIVE works alone and a second live row fails P2002; the preflight aborts with the index name and count "2 (userId, cohortId) pair(s)", leaving the old index and all four rows untouched, and the same statements apply cleanly after the duplicates are removed.
- Comments in `seat-accounting.ts` and `enrolment-service.ts` repointed to the new index (comment-only diff, verified by reading it). A static guard in `tests/schema-cohort.test.ts` pins the predicate and CREATE-before-DROP order.
- CR-05 appended as one row in `11-DECISIONS.md`, "Decided by" reads `Human scope decision for this pass (CR-05 deferred)`, no invented quotation. No flag-clearing code exists or was added.

## Task Commits

1. **Task 1: widened index migration + real-Postgres tests** - `8527700` (fix)
2. **Task 2: comment repoint + static guard** - `a98d155` (docs)
3. **Task 3: CR-05 deferral record** - `40db89a` (docs)

## Red/green verification

Tests were written first and run against the tree without the migration: 6 of 10 failed (COMPLETED plus ACTIVE returned no error instead of P2002; `takeSeat` resolved instead of rejecting with `AlreadyEnrolledError`; the catalogue test, the file-order test (ENOENT) and the preflight test failed as the index and file did not exist). After adding the migration all 10 pass, plus `tests/schema-cohort.test.ts` (33 passed across the two files, 88 across schema-cohort, enrolment-service and learning-phase-invariants).

## Verification results

- `tests/enrolment-live-index.integration.test.ts` + `tests/schema-cohort.test.ts`: 33 passed
- `tests/schema-cohort.test.ts`, `tests/enrolment-service.test.ts`, `tests/learning-phase-invariants.test.ts`: 88 passed
- `tests/boundary.test.ts` + `tests/certificate-phase-invariants.test.ts`: 24 passed
- `tests/certificate-concurrency.integration.test.ts`: 2 passed (regression check under the new migration)
- `grep -v '^--' migration.sql | grep -c "DELETE\|UPDATE \|TRUNCATE"` = 0; `grep -rn enrolment_one_active_per_learner_cohort src` returns nothing.
- No change to `.env`, `prisma/schema.prisma`, `prisma/sql/*`, `package.json` or `package-lock.json`.
- Migration order verified by test (CREATE precedes DROP) and by inspection.

## Safety statement

The migration was NOT applied to the remote Neon database or to any shared or local UAT database. It was executed only through `startTestDatabase()` Testcontainers instances (throwaway `postgres:16-alpine`, DATABASE_URL overridden). No `prisma migrate`, `db push` or `db execute` was run from a shell and `.env` was not read. Applying it to shared environments remains the human step in plan 11-33 (run the diagnostic SELECT from the migration header first).

## Audit of enrolment insert sites (finding only, no change)

`grep` over `src/` for `enrolment.create` / `createMany` / `upsert`:

- `seat-accounting.ts` `takeSeat`: the single create, translates P2002 to `AlreadyEnrolledError`.
- `checkout-service.ts:505` and `enrolment-service.ts:357/576`: go through `takeSeat`.
- `enrolment-service.ts:358`: a direct `tx.enrolment.create` only when the row does not take a seat (hold-less PENDING_PAYMENT). PENDING_PAYMENT is outside both the old and the widened index, so this insert cannot raise the index P2002 and needs no translation. Observation for a future pass: a later PENDING_PAYMENT to ACTIVE approval for a learner who already holds an ACTIVE or COMPLETED enrolment in that cohort would hit the index at update time; that path was not changed here.
- No `createMany` or `upsert` sites exist.

## Deviations from Plan

None - plan executed as written.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the migration itself, covered by T-11-109 to T-11-112.

## Issues Encountered

None.

## Self-Check: PASSED

- FOUND: prisma/migrations/20260919120000_enrolment_one_live_per_learner_cohort/migration.sql
- FOUND: tests/enrolment-live-index.integration.test.ts
- FOUND commits: 8527700, a98d155, 40db89a
