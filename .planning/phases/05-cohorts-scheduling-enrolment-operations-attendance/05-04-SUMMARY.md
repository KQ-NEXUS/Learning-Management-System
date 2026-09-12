---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 04
subsystem: api
tags: [prisma, postgres, transactions, for-update, outbox, testcontainers, concurrency]

# Dependency graph
requires:
  - phase: 05-cohorts-scheduling-enrolment-operations-attendance (plan 05-01)
    provides: "Cohort.holdMinutes, Enrolment.holdExpiresAt, model DomainEvent, enrolment_hold_expiry_only_when_pending CHECK, tests/support/cohort-fixtures.ts"
  - phase: 04-catalogue-content-versioning-publishing
    provides: "tests/support/pg.ts Testcontainers harness, reorder-service.ts $transaction + tagged-template raw-SQL idiom, resource-service.ts P2002 duck-type"
provides:
  - "src/server/services/seat-accounting.ts — takeSeat / releaseSeat / holdsSeat / holdExpiryFrom / HOLD_MINUTES_DEFAULT / CapacityExceededError / AlreadyEnrolledError / CohortNotFoundError"
  - "src/server/services/domain-event-service.ts — writeDomainEvent(tx, event) / buildDomainEventRow / DomainEventType closed union / DomainEventTxClient"
  - "tests/seat-accounting.integration.test.ts — real-Postgres D-05 concurrency, D-15 duplicate-active, D-04 release-floor proofs"
  - "tests/domain-event-service.test.ts — fake-tx unit coverage incl. sink-level redaction"
affects: [enrolment-service, hold-release-worker, attendance-service, transfer-service, checkout, phase-13-drain]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Authorization-free, transaction-taking primitive: takes tx as first arg, imports no permissions/next, structural TxClient type so no @prisma/client import — safe on the worker import closure (tests/boundary.test.ts)"
    - "SELECT ... FOR UPDATE on the Cohort row inside an interactive $transaction, capacity refusal before insert; the CHECK constraint is a proven backstop"
    - "Transactional outbox: writeDomainEvent appends a redacted, typed row inside the caller's transaction, never opening its own — pg-boss enqueue is not transactional on Prisma 6.19.3"
    - "SQL-expressed decrement floor GREATEST(seatsTaken - 1, 0) under the row lock, never read-then-write in app code"

key-files:
  created:
    - "src/server/services/seat-accounting.ts"
    - "src/server/services/domain-event-service.ts"
    - "tests/seat-accounting.integration.test.ts"
    - "tests/domain-event-service.test.ts"
  modified: []

key-decisions:
  - "Typed-error constructors are positional (new CapacityExceededError(cohortId, capacity, seatsTaken), new AlreadyEnrolledError(userId, cohortId), new CohortNotFoundError(cohortId)) matching the 05-RESEARCH sketch — later plans catch by type, not construct."
  - "holdExpiryFrom does NOT fall back to HOLD_MINUTES_DEFAULT: a null holdMinutes column means 'no hold' (D-02), not 'unset'. HOLD_MINUTES_DEFAULT (30) is exported purely as the schema-default reference for display/seed call sites."
  - "SeatTxClient includes $executeRaw (for the GREATEST floor) in addition to the plan's listed $queryRaw/enrolment/cohort surface."
  - "Concurrency test passes { timeout: 15_000 } to the two racing $transaction calls so a slow container lock-wait cannot masquerade as a Prisma transaction timeout."

patterns-established:
  - "Pattern: seat mutation = $transaction(tx => { takeSeat|releaseSeat(tx, ...); writeDomainEvent(tx, ...) }) then recordAudit after commit"
  - "Pattern: holdsSeat is the single seat-occupancy predicate — approve/transfer/withdraw consult it rather than re-deriving 'is a seat held'"

requirements-completed: [COH-05, COH-06]

# Metrics
duration: 6min
completed: 2026-09-04
---

# Phase 5 Plan 04: Seat Accounting + Domain-Event Outbox Summary

**Race-safe `takeSeat`/`releaseSeat` over a `SELECT … FOR UPDATE` Cohort-row lock plus a transactional `writeDomainEvent` outbox, proven against real Postgres with a two-concurrent-take capacity-1 test that shows the CHECK constraint never fires.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-09-04T09:59:55Z
- **Completed:** 2026-09-04T10:05:14Z
- **Tasks:** 3 (4 commits — Task 1 was TDD: test → feat)
- **Files modified:** 4 (all created)

## Accomplishments
- `domain-event-service.ts`: `buildDomainEventRow` (pure, sink-level `redactForAudit`, no `processedAt`) and `writeDomainEvent(tx, event)` — one `tx.domainEvent.create`, never opens a transaction. `DomainEventType` is a closed 12-member union so a later phase cannot invent an undrained event. `DomainEventTxClient` is structural — no `@prisma/client` import.
- `seat-accounting.ts`: `takeSeat` locks the Cohort row, refuses on `seatsTaken >= capacity` before inserting, translates the partial-unique-index P2002 to `AlreadyEnrolledError`, and increments `seatsTaken` by 1 in the same transaction. `releaseSeat` locks the row, nulls `holdExpiresAt` (satisfies `enrolment_hold_expiry_only_when_pending`), and decrements via `GREATEST("seatsTaken" - 1, 0)` only when `heldSeat`. `holdsSeat` is the single seat-occupancy predicate; `holdExpiryFrom` is the single hold-rule definition.
- `tests/seat-accounting.integration.test.ts` (9 cases, real Postgres via Testcontainers): D-05 two-concurrent-take → exactly one enrolment / `seatsTaken === 1` / loser is `CapacityExceededError` / no message matches `/cohort_capacity_not_exceeded/`; capacity refusal inserts nothing; D-15 duplicate-active → `AlreadyEnrolledError` (not a raw Prisma error); re-enrolment after `WITHDRAWN` succeeds; D-04 floor-at-0, decrement-by-1, no-op when `!heldSeat`; `releaseSeat` nulls `holdExpiresAt`; `holdsSeat` true/true/false against real rows.
- `tests/domain-event-service.test.ts` (8 cases): row shape, explicit `occurredAt`, deep + `AUDIT_REDACTED_KEYS` redaction, single `create` call, `@ts-expect-error` guard on the closed union.

## Task Commits

1. **Task 1: Transactional domain-event outbox writer (TDD)** - `07c0541` (test) → `fcc17fe` (feat)
2. **Task 2: Seat-accounting helper (takeSeat / releaseSeat / holdsSeat)** - `d378bbe` (feat)
3. **Task 3: Real-Postgres concurrency and duplicate-active proofs** - `a5d756c` (test)

**Plan metadata:** not committed — `.planning/` is gitignored (see execution-mode note).

## Files Created/Modified
- `src/server/services/domain-event-service.ts` - Append-only transactional outbox writer + closed `DomainEventType` union
- `src/server/services/seat-accounting.ts` - Authorization-free, transaction-taking seat primitive
- `tests/domain-event-service.test.ts` - Fake-tx unit coverage
- `tests/seat-accounting.integration.test.ts` - Testcontainers concurrency / duplicate-active / release-floor proofs

## Exact signatures (plans 05-07, 05-09, Phase 6 call these unchanged)

```ts
function takeSeat(
  tx: SeatTxClient,
  args: { cohortId: string; enrolment: Record<string, unknown> },
): Promise<{ id: string }>;

function releaseSeat(
  tx: SeatTxClient,
  args: {
    cohortId: string;
    enrolmentId: string;
    toStatus: "WITHDRAWN" | "CANCELLED" | "TRANSFERRED";
    reason: string;
    heldSeat: boolean;
    withdrawnAt?: Date;
  },
): Promise<void>;

function holdsSeat(enrolment: { status: string; holdExpiresAt: Date | null }): boolean;

function holdExpiryFrom(cohortHoldMinutes: number | null, now: Date): Date | null;
const HOLD_MINUTES_DEFAULT = 30;

function writeDomainEvent(tx: DomainEventTxClient, event: {
  type: DomainEventType;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}): Promise<void>;
function buildDomainEventRow(event: { type: DomainEventType; payload: Record<string, unknown>; occurredAt?: Date }): Record<string, unknown>;
```

Note: `takeSeat` does NOT itself write the `enrolment.created` domain event — the caller does, inside the same `$transaction`, so the event type/payload stays a caller concern.

## Decisions Made
- Positional typed-error constructors (matches 05-RESEARCH sketch).
- `holdExpiryFrom(null, …) → null` (no hold), never a `HOLD_MINUTES_DEFAULT` fallback — a null column is "no hold" per D-02, not "unset".
- `SeatTxClient` also exposes `$executeRaw` for the `GREATEST` floor.
- Concurrency-test transactions get an explicit `{ timeout: 15_000 }` so lock-wait time on a cold container is not misread as a Prisma timeout.

## Deviations from Plan

None - plan executed exactly as written.

### Environment note (not a code deviation)

Executed sequentially on the main working tree, branch `Khaliddev` (developer's feature branch, not a protected ref), no worktree isolation — per the orchestrator's execution-mode instructions. Each task committed atomically with hooks (no `--no-verify`). `.planning/` is gitignored, so this SUMMARY / STATE / ROADMAP are disk-only writes and are not committed.

## Issues Encountered
None. All grep gates pass (`@/server/permissions` 0, `*RawUnsafe` 0, `FOR UPDATE` 2, `GREATEST` 2, `$transaction(` 0 in domain-event-service, `redactForAudit` 4). `npx tsc --noEmit` and `npm run lint` both clean.

## Known Stubs
None.

## Threat Flags
None — the two files implement mitigations already in the plan's threat register (T-05-16 through T-05-22); no new endpoints, auth paths, or trust-boundary schema changes were introduced.

## Verification Results
- `npx vitest run tests/seat-accounting.integration.test.ts` — 9/9 passed (Docker/Testcontainers).
- `npx vitest run tests/domain-event-service.test.ts` — 8/8 passed.
- `npx vitest run tests/boundary.test.ts` — 9/9 passed (worker import closure still clean).
- `npx vitest run tests/schema-cohort.test.ts` — 21/21 passed (plan-05-01 constraints still hold under the new writes).
- `npx tsc --noEmit` — exit 0. `npm run lint` — exit 0.

## Next Phase Readiness
- The two transaction-level primitives the rest of Phase 5 depends on exist and are proven.
- Plan 05-07 (enrolment state machine) and 05-09 (hold-expiry worker) can call `takeSeat` / `releaseSeat` / `holdsSeat` / `writeDomainEvent` unchanged; the worker path must import `seat-accounting.ts` only (never a permissions module) to keep `tests/boundary.test.ts` green.
- Callers must consult `holdsSeat` before deciding whether "approve" needs a `takeSeat` (D-12 / RESEARCH Pitfall 3 — avoids double-counting).

## Self-Check: PASSED
- `src/server/services/domain-event-service.ts` - FOUND
- `src/server/services/seat-accounting.ts` - FOUND
- `tests/domain-event-service.test.ts` - FOUND
- `tests/seat-accounting.integration.test.ts` - FOUND
- Commit `07c0541` - FOUND
- Commit `fcc17fe` - FOUND
- Commit `d378bbe` - FOUND
- Commit `a5d756c` - FOUND

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
