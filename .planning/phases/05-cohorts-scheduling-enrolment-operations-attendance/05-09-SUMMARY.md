---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 09
subsystem: worker
tags: [pg-boss, worker, seat-accounting, outbox, audit, testcontainers, scheduled-job]

# Dependency graph
requires:
  - phase: 05-cohorts-scheduling-enrolment-operations-attendance (plan 05-01)
    provides: "Enrolment.holdExpiresAt, @@index([status, holdExpiresAt]), enrolment_hold_expiry_only_when_pending CHECK"
  - phase: 05-cohorts-scheduling-enrolment-operations-attendance (plan 05-04)
    provides: "seat-accounting.ts (releaseSeat, holdsSeat), domain-event-service.ts (writeDomainEvent)"
  - phase: 04-catalogue-content-versioning-publishing
    provides: "worker/index.ts pg-boss pattern, scan-system-service.ts worker-only-unauthorized template, tests/support/pg.ts Testcontainers harness"
provides:
  - "src/server/services/hold-release-system-service.ts — createHoldReleaseSystemService / releaseExpiredHoldsAsSystem"
  - "worker/handlers/release-expired-holds.ts — createReleaseExpiredHoldsHandler DI factory + bound releaseExpiredHolds"
  - "src/server/jobs/queue.ts — HOLD_SWEEP_QUEUE constant"
  - "worker/index.ts — HOLD_SWEEP_QUEUE created/worked/scheduled every 5 minutes with bounded retry"
affects: [checkout, roster-service, phase-13-drain]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worker-only, deliberately unauthorized system service — same shape as scan-system-service.ts: AsSystem-suffixed export, no caller-supplied filter, resolves its own work set, defensive re-filter, audits actorType SYSTEM"
    - "Per-row transaction inside a batch sweep — one failure caught/counted/logged, never aborts the remaining rows"
    - "pg-boss retry bounded at the queue level via createQueue(name, { retryLimit, retryBackoff }), not at work() — QueueOptions, not WorkOptions, per the installed pg-boss v12 .d.ts"

key-files:
  created:
    - "src/server/services/hold-release-system-service.ts"
    - "worker/handlers/release-expired-holds.ts"
    - "tests/hold-release.integration.test.ts"
  modified:
    - "src/server/jobs/queue.ts"
    - "worker/index.ts"
    - "tests/worker-handlers.test.ts"

key-decisions:
  - "Retry options (retryLimit: 3, retryBackoff: true) are supplied to boss.createQueue(HOLD_SWEEP_QUEUE, {...}), not to boss.work(...) — verified against node_modules/pg-boss/dist/types.d.ts: retryLimit/retryDelay/retryBackoff/retryDelayMax live on QueueOptions (which Queue extends), and WorkOptions carries no retry fields."
  - "Both the schedule cadence (*/5 * * * *) and the default batchLimit (200) match the reconcile job's cadence and a similarly modest bound, so a backlog drains across scheduled runs rather than in one long transaction."
  - "Case 8 (batch resilience) simulates a poison row by deleting the enrolment row between the sweep's findMany read and its per-row transaction (a P2025 on the update), rather than corrupting the cohort row — a more realistic race than a broken FK, and it exercises the exact try/catch-per-row path the service implements."
  - "Task 1 carried tdd=\"true\" in the plan but specifies no dedicated unit-test file, and no unit-test file exists for the sibling worker-only service (scan-system-service.ts) either — the real proof for this class of file is the Testcontainers integration test (Task 3). Implemented directly and verified via tsc + tests/boundary.test.ts per the plan's own Task-1 verify block, then proved behaviourally in Task 3."

patterns-established:
  - "Pattern: worker-only sweep = findMany own work set -> defensive re-filter -> per-row { releaseSeat/other-mutation ; writeDomainEvent } transaction -> recordAudit(actorType SYSTEM) after each commit, catch-count-continue on a per-row failure"

requirements-completed: [COH-06]

# Metrics
duration: 20min
completed: 2026-09-04
---

# Phase 5 Plan 09: Hold-Release Sweep (COH-06) Summary

**A scheduled, deliberately-unauthorized pg-boss job that finds expired `PENDING_PAYMENT` seat holds with no caller-supplied filter, cancels each with reason `"hold expired"` in its own transaction, and returns the seat — proven against real Postgres including idempotence, the seat floor, and resilience to a poison row.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-04T15:03:00Z (approx, first file write)
- **Completed:** 2026-09-04T15:22:36Z
- **Tasks:** 3 (3 commits)
- **Files:** 4 created, 3 modified

## Accomplishments

- `hold-release-system-service.ts`: `createHoldReleaseSystemService(deps)` + bound `releaseExpiredHoldsAsSystem(batchLimit?)`. Resolves its own work set (`status: "PENDING_PAYMENT"`, `holdExpiresAt: { not: null, lt: now() }`, ordered oldest-expiry-first, capped at a default 200-row `batchLimit`), defensively re-filters the returned rows exactly as `scan-system-service.ts` does, and processes each row in its OWN `$transaction`: `releaseSeat(tx, { toStatus: "CANCELLED", reason: "hold expired", heldSeat: true })` then `writeDomainEvent(tx, { type: "enrolment.hold_expired", ... })`, followed by `recordAudit({ actorId: null, actorType: "SYSTEM", action: "enrolment.hold_expired", ... })` after commit. A per-row failure is caught, logged, and counted — the batch continues. Returns `{ released, failed }`. Carries the same "READ THIS BEFORE FIXING THE MISSING AUTHORIZATION CHECK" header as `scan-system-service.ts`, explaining why this is a named, unauthorized, worker-only module rather than a synthetic GLOBAL actor.
- `src/server/jobs/queue.ts`: added `HOLD_SWEEP_QUEUE = "enrolment.hold-sweep"` beside `SCAN_QUEUE`/`RECONCILE_QUEUE`. No `enqueue*` helper — the sweep is scheduled, not enqueued per row.
- `worker/handlers/release-expired-holds.ts`: `createReleaseExpiredHoldsHandler(deps)` DI factory (mirrors `reconcile-lesson-resources.ts`) + bound `releaseExpiredHolds` wired to `releaseExpiredHoldsAsSystem` and `console.info`. Logs `[worker] released N expired seat holds`.
- `worker/index.ts`: `boss.createQueue(HOLD_SWEEP_QUEUE, { retryLimit: 3, retryBackoff: true })`, `boss.work(HOLD_SWEEP_QUEUE, ...)`, `boss.schedule(HOLD_SWEEP_QUEUE, "*/5 * * * *")` — same cadence as the reconcile job. The startup `console.info` queue list now includes `HOLD_SWEEP_QUEUE`.
- `tests/worker-handlers.test.ts`: two new cases — the handler calls the injected sweep exactly once and logs the released count; a thrown error propagates (uncaught) so pg-boss records the failure and applies its bounded retry.
- `tests/hold-release.integration.test.ts` (9 Testcontainers cases against real Postgres, driving `createHoldReleaseSystemService` directly — no pg-boss started, per 05-RESEARCH Open Question 4): expired hold released with seat returned and `seatsTaken` decremented; unexpired hold untouched; hold-less `PENDING_PAYMENT` (holdMinutes null, D-02) never swept; `ACTIVE`/`WITHDRAWN`/`CANCELLED` rows untouched; a second immediate run is a zero-effect no-op (no new `AuditEvent`/`DomainEvent`); seat floor holds at 0; exactly one `SYSTEM`-actor `AuditEvent` and one `enrolment.hold_expired` `DomainEvent` per release; one poison row (deleted between read and write) does not stall release of the other two; `batchLimit` caps a run and the remainder releases on the next call.

## Exact signatures (Phase 6 checkout, worker deploy notes)

```ts
function createHoldReleaseSystemService(deps: {
  enrolment: { findMany(args): Promise<ExpiredHoldRow[]> };
  audit: (event) => Promise<void>;
  writeEvent: typeof writeDomainEvent;
  runInTransaction: <R>(fn: (tx) => Promise<R>) => Promise<R>;
  now?: () => Date;
}): { releaseExpiredHolds(batchLimit?: number): Promise<{ released: number; failed: number }> };

function releaseExpiredHoldsAsSystem(batchLimit?: number): Promise<{ released: number; failed: number }>;

export const HOLD_SWEEP_QUEUE = "enrolment.hold-sweep";
```

Schedule cadence: `*/5 * * * *` (every 5 minutes), matching the reconcile job. Default `batchLimit`: 200 rows per run, oldest-expiry-first, so a backlog drains across scheduled runs rather than in one long-running transaction. **A deploy must run the `worker` service (`docker-compose.yml`'s `worker:` target, `npx tsx worker/index.ts`) for expired holds to ever release** — the Next.js app process never runs this sweep.

## Deviations from Plan

### Note (not a Rule 1-4 deviation)

**Task 1's `tdd="true"` tag had no dedicated unit-test file to pair with.** The plan's `<files>` for Task 1 lists only the service file, and its `<verify>` block runs `tsc` + `tests/boundary.test.ts` — both static/structural checks, not a behavioral RED/GREEN pair. The precedent this file explicitly follows, `scan-system-service.ts` (plan 04-10), also has no dedicated unit-test file — its behavioral proof lives entirely in an integration test. Implemented the service directly, verified per the plan's literal Task-1 acceptance criteria, then proved behavior in Task 3's Testcontainers suite. No RED/GREEN commit pair was created for Task 1; a plain `feat` commit was used. Flagging per TDD Gate Compliance below rather than silently treating it as satisfied.

## TDD Gate Compliance

Task 1 was marked `tdd="true"` but the plan supplied no unit-test artifact and no RED-phase verify step — only `tsc --noEmit` and `tests/boundary.test.ts` (structural checks unrelated to the new file's runtime behavior). No `test(...)` commit precedes the `feat(...)` commit for this task; see the deviation note above for why this matches the codebase's existing precedent for this exact class of file (worker-only system service) rather than an oversight.

## Known Stubs

None.

## Threat Flags

None — the two new files implement mitigations already fully specified in the plan's own threat register (T-05-55 through T-05-60): worker-only unauthorized surface, import-closure boundary, hold-less-row protection, idempotence, bounded retry, and SYSTEM-actor audit distinguishability. No new endpoint, auth path, or trust-boundary schema change was introduced.

## Verification Results

- `npx vitest run tests/hold-release.integration.test.ts tests/worker-handlers.test.ts tests/boundary.test.ts tests/seat-accounting.integration.test.ts` — 34/34 passed (Docker/Testcontainers).
- `npx tsc --noEmit` — exit 0.
- `npm run lint` — exit 0 (no ESLint output).
- Grep gates: `@/server/permissions|next/headers|getCurrentActor` in `hold-release-system-service.ts` → 0; `AsSystem` → 2; `actorType` → 4; `hold expired` → 2; `HOLD_SWEEP_QUEUE` present in both `queue.ts` and `worker/index.ts`; `boss.schedule(HOLD_SWEEP_QUEUE` → 1; `retryLimit|retryBackoff` in `worker/index.ts` → 3 occurrences, both names present in the installed `pg-boss/dist/types.d.ts`; `tests/hold-release.integration.test.ts` contains no `pg-boss` import (only a prose comment); both its `beforeAll`/`afterAll` pass `TEST_DB_TIMEOUT_MS`.
- Confirmed `docker-compose.yml`'s `worker:` service already carries `DATABASE_URL` — no compose change was needed.

## Next Phase Readiness

- COH-06's full text — "released or expired reservations become available per policy" — is now closed: capacity enforcement under concurrency was 05-04, and the expiry side is this plan.
- Phase 6 checkout can rely on the sweep to reclaim seats from abandoned checkouts; it should not re-implement hold expiry.
- Any later phase adding a new worker queue should copy this plan's `createQueue(name, { retryLimit, retryBackoff })` placement (queue-level, not `work()`-level) for bounded retry.

## Self-Check: PASSED

- `src/server/services/hold-release-system-service.ts` - FOUND
- `worker/handlers/release-expired-holds.ts` - FOUND
- `src/server/jobs/queue.ts` (HOLD_SWEEP_QUEUE) - FOUND
- `worker/index.ts` (HOLD_SWEEP_QUEUE wiring) - FOUND
- `tests/hold-release.integration.test.ts` - FOUND
- `tests/worker-handlers.test.ts` (new cases) - FOUND
- Commit `72d004c` - FOUND
- Commit `93c9799` - FOUND
- Commit `2efc56c` - FOUND

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
