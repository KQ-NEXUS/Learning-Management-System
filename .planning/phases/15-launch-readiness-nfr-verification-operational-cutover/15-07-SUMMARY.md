---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 07
subsystem: ops-safety-and-data-integrity
tags: [nfr-14, nfr-08, db-guard, integrity-checks, testcontainers, scripts]
status: complete

requires:
  - phase: 05-cohort-operations
    provides: one-live-enrolment partial unique index (migration 20260919120000), seat accounting, cohort capacity
  - phase: 07-payments
    provides: Order/PaymentAttempt state machine; manual confirmation recorded as a SUCCEEDED MANUAL attempt
  - phase: 11-certificates
    provides: issuance requires an open CompletionRecord for the enrolment and scope
provides:
  - scripts/ops/db-target-guard.ts (assertSafeDatabaseUrl, isLocalHost; STAGING_DATABASE_HOSTS + ALLOW_STAGING_DATABASE)
  - scripts/ops/assert-local-db.ts (exit 0 only for a local shell DATABASE_URL)
  - scripts/ops/integrity-checks.ts (CLI with --target, --out, --fail-on-violation; JSON output)
  - src/server/services/integrity-check-service.ts (INTEGRITY_CHECKS x7, createIntegrityCheckService, integrityCheckService)
affects: [15-11, 15-12, 15-13, 15-28, 15-30]

actuals:
  tokens: 11500
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Guard-before-import: a CLI calls assertSafeDatabaseUrl, then dynamically imports anything that builds a Prisma client"
    - "Integrity check = static SELECT returning text ids, wrapped in a CTE that returns count plus a sorted 20-id sample in one round trip"
    - "Violation tests run inside a rolled-back interactive transaction; unique indexes that block a violation are dropped inside the same transaction (DDL rolls back)"

key-files:
  created:
    - scripts/ops/db-target-guard.ts
    - scripts/ops/assert-local-db.ts
    - scripts/ops/integrity-checks.ts
    - src/server/services/integrity-check-service.ts
    - tests/db-target-guard.test.ts
    - tests/integrity-checks.integration.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/deferred-items.md
  modified:
    - prisma/seed.ts

key-decisions:
  - "\"Paid\" order statuses are PAID, PARTIALLY_REFUNDED and REFUNDED (a refund does not undo the payment and may retain access); both payment checks use this set"
  - "\"Live\" enrolment = ACTIVE or COMPLETED, matching the one-live-enrolment partial unique index; used for the duplicate and capacity checks"
  - "Active certificate check accepts any completion record (open or superseded) for the same enrolment and scope; a later superseded record is the CRD-06 review flag's job"
  - "The guard also refuses URLs carrying a host/hostaddr query parameter, socket-style URLs with no host, and non-Postgres schemes"
  - "Seeded certificates now get a matching CompletionRecord so a fresh migrate plus seed reports zero violations"

patterns-established:
  - "Every Phase 15 DB script: `npx tsx scripts/ops/assert-local-db.ts && <command>` or an in-process assertSafeDatabaseUrl call before any Prisma import"

requirements-completed: [NFR-14, NFR-08]

coverage:
  - id: D1
    description: "Database-target guard allows only local hosts (or an allow-listed staging host with the explicit flag) and prints the host only"
    requirement: NFR-08
    verification:
      - kind: unit
        ref: "tests/db-target-guard.test.ts"
        status: pass
      - kind: other
        ref: "plan 15-07 Task 1 <verify> node spawnSync check (neon.tech URL refused, password not printed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "assert-local-db CLI exits 0 only for a local shell DATABASE_URL and never loads .env"
    requirement: NFR-08
    verification:
      - kind: unit
        ref: "tests/db-target-guard.test.ts#assert-local-db CLI"
        status: pass
    human_judgment: false
  - id: D3
    description: "Seven read-only integrity checks: each detects its own violation only, a broken check reports error without hiding the others, SQL is SELECT/WITH only"
    requirement: NFR-14
    verification:
      - kind: integration
        ref: "tests/integrity-checks.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "integrity-checks CLI runs end to end after the guard; a freshly migrated and seeded database reports zero violations"
    requirement: NFR-14
    verification:
      - kind: other
        ref: "throwaway postgres:16-alpine container on :5441 -> assert-local-db, prisma migrate deploy, tsx prisma/seed.ts (twice), integrity-checks.ts --fail-on-violation exit 0"
        status: pass
    human_judgment: false

duration: 36 min
completed: 2026-10-06
---

# Phase 15 Plan 07: Database-target guard and NFR-14 integrity checks Summary

**A host allow-list guard (`assertSafeDatabaseUrl`) that every Phase 15 database script calls before importing Prisma, plus seven read-only SQL integrity checks (payments, enrolments, completion, grades, certificates, capacity) exposed as a service for the ops page and as a JSON CLI with `--fail-on-violation`.**

## Performance

- **Duration:** 36 min
- **Started:** 2026-10-06T18:52:39Z
- **Completed:** 2026-10-06T19:29:32Z
- **Tasks:** 2 (1 tracer, 1 TDD)
- **Files:** 6 created, 1 modified (plus `deferred-items.md`)

## Accomplishments

- `scripts/ops/db-target-guard.ts`: `isLocalHost` and `assertSafeDatabaseUrl(url, { target, env })`. It allows localhost, 127.0.0.1, ::1 and host.docker.internal. A remote host is allowed only with `target: "staging"`, the host listed in `STAGING_DATABASE_HOSTS` and `ALLOW_STAGING_DATABASE=1`. It refuses an unset, blank or unparseable value, a non-Postgres scheme, a URL with no host, and a `host`/`hostaddr` query override. Messages name the host only.
- `scripts/ops/assert-local-db.ts`: exits 1 with the guard message, or 0 with "database target is local (host)". It never reads `.env`.
- `src/server/services/integrity-check-service.ts`: `INTEGRITY_CHECKS` (seven `{ id, label, sql }` entries with plain-word labels for UI-SPEC S1 section 5). `createIntegrityCheckService({ client, log?, checks? })` runs the checks one by one and catches each failure separately. It returns `{ id, label, status: passed|violations|error, violationCount, sampleIds (sorted, at most 20) }`. `integrityCheckService` is bound to prisma for plan 15-13.
- `scripts/ops/integrity-checks.ts`: parses `--target`, `--out` and `--fail-on-violation`. It runs the guard, then dynamically imports the service and db, prints `{ ranAt, target, databaseHost, passed, checks }`, writes it to `--out` when given, and disconnects. Exit codes: 1 for a refusal or failed checks, 2 for bad arguments.
- The seven checks:
  - Paid orders have a successful payment
  - Active enrolments have a paid order (orderless staff enrolments are ignored)
  - One live enrolment per learner and cohort
  - One open completion record per enrolment and course
  - One grade per submission
  - Active certificates have a completion record
  - Cohorts are within capacity

## Task Commits

No commits. The owner commits explicitly.

1. **Task 1 (tracer): guard, CLI, service with one check, end to end.** Not committed. The tracer was verified end to end against the local Docker Postgres (`localhost:5434`, read-only): exit 0 with the one check passing.
2. **Task 2 (TDD): the remaining six checks.** Not committed. RED: 8 of 12 tests failed (missing checks). GREEN: 18 of 18 pass.

## Files Created/Modified

- `scripts/ops/db-target-guard.ts`: guard module with no imports.
- `scripts/ops/assert-local-db.ts`: exit-code CLI for chaining before schema pushes and seeds.
- `scripts/ops/integrity-checks.ts`: JSON CLI over the integrity service.
- `src/server/services/integrity-check-service.ts`: check definitions and runner.
- `tests/db-target-guard.test.ts`: 39 tests covering the allow-list, staging opt-in, refusals, no secret in messages, and the CLI exit codes through `npx tsx`.
- `tests/integrity-checks.integration.test.ts`: 18 tests on Testcontainers:
  - static checks that the SQL is read-only
  - all seven checks pass on a valid fixture set
  - one rolled-back violation per check, asserting that only that check fires
  - the sample is capped at 20 and sorted
  - a broken check reports error while the rest still run
- `prisma/seed.ts`: block "2b" gives each `CERT-SEED-*` certificate a CompletionRecord. It is idempotent.
- `.planning/.../deferred-items.md`: one pre-existing test timeout, logged.

## Decisions Made

See `key-decisions` in the frontmatter. In plain words:

- "Paid" means PAID, PARTIALLY_REFUNDED or REFUNDED. This matches `SETTLED_ORDER_STATUSES`, and refunds can keep the learner's access.
- "Live" means ACTIVE or COMPLETED, which is what the partial unique index covers.
- A certificate passes when any completion record exists for its enrolment and scope.
- Manual confirmations count as successful payments: they go through `activateOrderAsSystem`, which marks the MANUAL attempt SUCCEEDED.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The seed created ACTIVE certificates with no completion record**
- **Found during:** Task 2, running the CLI against the local seeded database.
- **Issue:** `prisma/seed.ts` creates CERT-SEED-0001 and CERT-SEED-0002 (ACTIVE) and CERT-SEED-0003 (REVOKED) with no CompletionRecord. Real issuance refuses to issue without one (`certificate-service.ts`). So "Active certificates have a completion record" reported 2 violations, which broke the must-have truth "On a freshly migrated and seeded database every check reports zero violations". Plans 15-28 and 15-30 would also have failed under `--fail-on-violation`.
- **Fix:** an additive, guarded seed block that creates one CompletionRecord (ruleVersion 1, completedAt = issuedAt) per seeded certificate when none exists.
- **Files modified:** `prisma/seed.ts`. This file is outside the plan's `files_modified`.
- **Verification:** on a fresh `postgres:16-alpine` container (port 5441, removed afterwards), ran `assert-local-db`, `prisma migrate deploy`, the seed, then `integrity-checks --fail-on-violation`: exit 0, all seven checks passed. Re-running the seed left 3 completion records and still exit 0, so the block is idempotent.
- **Commit:** not committed (owner commits explicitly).

**2. [Rule 2 - Security] Extra guard refusals**
- **Found during:** Task 1.
- **Issue:** the plan's host check alone would accept `postgresql://...@localhost/db?host=<remote>`, where a driver honours the query host. It also did not cover socket-style URLs or other schemes.
- **Fix:** the guard refuses `host`/`hostaddr` query parameters, empty hosts and non-`postgres(ql)://` schemes. Tests cover each case.
- **Files modified:** `scripts/ops/db-target-guard.ts`, `tests/db-target-guard.test.ts`.
- **Commit:** not committed.

**Total deviations:** 2 auto-fixed (1 bug, 1 security hardening). **Impact:** the seed change adds 3 CompletionRecord rows to demo data. They are consistent with the certificates that already exist, and no UI reads `CompletionRecord.evidence`. No scope creep beyond the must-have truths.

## Issues Encountered

- `tests/licence-enforcement-boundary.test.ts` has a test ("only runtime importer of licence-activation-service") that times out at Vitest's 5 s default (5.2 to 5.8 s). It fails identically with the new service file moved out of `src/`, so it predates this plan. It is logged in `deferred-items.md` and was not fixed. The other 40 tests in that file and all of `tests/boundary.test.ts` pass, and the new service is not flagged as a writer.

- Tracking:
  - `requirements.ready-ids` reports NFR-14 and NFR-08 as blocked: sibling Phase 15 plans that also declare them have no SUMMARY yet. Neither ID was marked complete.
  - `state.advance-plan`, `record-metric`, `add-decision` (x2), `record-session` and `roadmap.update-plan-progress` succeeded.
  - `state.update-progress` skipped itself ("phase scope is unscoped, not complete"). STATE.md's Progress field was left as it was and not hand-edited.

## Known Stubs

None.

## Threat Flags

None. The guard and the read-only checks are the mitigations for T-15-07-01 to T-15-07-03. Sample ids are opaque record ids only (T-15-07-04, accepted).

## User Setup Required

None. For staging runs later (plan 15-30), the operator sets `STAGING_DATABASE_HOSTS=<staging branch host>` and `ALLOW_STAGING_DATABASE=1`, and passes `--target staging`.

## Next Phase Readiness

- Plans 15-11, 15-12, 15-28 and 15-30 can chain `npx tsx scripts/ops/assert-local-db.ts` or call `assertSafeDatabaseUrl` directly.
- Plan 15-13 can render `integrityCheckService.runIntegrityChecks()` in "Data integrity checks".
- Plan 15-12's new partial unique indexes will not break the integration test: it finds unique indexes on the affected column at run time and drops them inside the rolled-back transaction.
- Ready for the next plan in the phase.

## Verification Run

- `npx vitest run tests/db-target-guard.test.ts`: 39 passed.
- Task 1 `<verify>` node check (neon.tech URL refused, password not printed): exit 0.
- `npx vitest run tests/integrity-checks.integration.test.ts --no-file-parallelism`: 18 passed, no BLOCKED.
- `npx tsc --noEmit`: exit 0.
- `npx eslint` on all 7 touched source and test files: exit 0.
- `tests/boundary.test.ts`: all pass. `tests/licence-enforcement-boundary.test.ts`: 40 pass, plus 1 pre-existing timeout (see Issues).
- Acceptance greps:
  - both guard exports are present
  - the guard call (line 73) comes before the dynamic service import (line 80) in `integrity-checks.ts`
  - there are 7 check ids

## Self-Check: PASSED

- FOUND: scripts/ops/db-target-guard.ts
- FOUND: scripts/ops/assert-local-db.ts
- FOUND: scripts/ops/integrity-checks.ts
- FOUND: src/server/services/integrity-check-service.ts
- FOUND: tests/db-target-guard.test.ts
- FOUND: tests/integrity-checks.integration.test.ts
- Commits: none expected (run override: no git commits). Nothing staged.
