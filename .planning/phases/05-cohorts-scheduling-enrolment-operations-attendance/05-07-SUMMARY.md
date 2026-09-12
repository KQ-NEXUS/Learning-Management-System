---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 07
subsystem: api
tags: [enrolment, state-machine, transitions, seat-accounting, outbox, audit, transfer, tdd, testcontainers]

# Dependency graph
requires:
  - phase: 05-01
    provides: "Enrolment.holdExpiresAt / transferredFromId, Cohort.holdMinutes, model DomainEvent, enrolment_hold_expiry_only_when_pending + enrolment_transfer_not_self CHECKs, tests/support/cohort-fixtures.ts"
  - phase: 05-02
    provides: "cohort-scope.ts — cohortResourceScope, enrolmentCohortScope (DB-resolved ResourceScope)"
  - phase: 05-04
    provides: "seat-accounting.ts (takeSeat / releaseSeat / holdsSeat / holdExpiryFrom / CohortNotFoundError / CapacityExceededError / AlreadyEnrolledError), domain-event-service.ts (writeDomainEvent, DomainEventType union)"
provides:
  - "src/server/services/enrolment-service.ts — addEnrolment, approveEnrolment, transferEnrolment, withdrawEnrolment, cancelEnrolment; VALID_TRANSITIONS, assertTransition; IllegalTransitionError, CrossOfferTransferError, EnrolmentNotFoundError, ReasonRequiredError; createEnrolmentService / createPrismaBackedEnrolmentService"
  - "src/server/services/seat-accounting.ts — new claimSeat(tx, {cohortId}): capacity-gated seatsTaken increment for an already-existing enrolment row (approve of a hold-less PENDING_PAYMENT)"
affects: [05-08, 05-09, 05-11, 05-14, 06-checkout, 07-manual-payment, roster-service]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "State machine as an explicit Record<Status, Status[]> table + assertTransition called before every write — no rules engine, no approval workflow (D-16)"
    - "DI factory (createEnrolmentService) + createPrismaBackedEnrolmentService(client, withPermission, audit) bound instance — same shape as publish-service / scheduled-session-service, so the integration test drives the real $transaction and the real seat primitives"
    - "Seat correctness routed exclusively through seat-accounting: takeSeat (insert+claim), claimSeat (claim only, existing row), releaseSeat (status+decrement) — the FOR UPDATE recipe stays in one file"
    - "Transaction body writes the status + the DomainEvent atomically; recordAudit fires after commit (targetType 'Enrolment', targetId = enrolment id) so the 05-10 roster transition history populates"

key-files:
  created:
    - "src/server/services/enrolment-service.ts"
    - "tests/enrolment-service.test.ts"
    - "tests/enrolment-service.integration.test.ts"
  modified:
    - "src/server/services/seat-accounting.ts"

key-decisions:
  - "Added seat-accounting.claimSeat(tx, {cohortId}) — a capacity-gated increment with no row I/O. The plan said approve should 'call takeSeat' for a hold-less PENDING_PAYMENT, but takeSeat INSERTs a new enrolment; the row already exists. claimSeat keeps the blessed FOR UPDATE recipe co-located rather than re-implementing it in enrolment-service (deviation Rule 3)."
  - "enrolment-service is a DI factory + prisma-bound instance, NOT a createResourceService instance — the five actions are transition-validated, reason-bearing, event-emitting surface the CRUD factory cannot express (mirrors publish-service / scheduled-session-service)."
  - "assertTransition(from, to, enrolmentId?) — third arg optional so 2-arg calls in tests compile; IllegalTransitionError carries from / to / enrolmentId."
  - "transferEnrolment resolves authorization on the SOURCE cohort (enrolmentCohortScope) and confines the target to a sibling cohort of the same courseId or programmeId; same-cohort and cross-offer both throw CrossOfferTransferError. Source stays TRANSFERRED (not deleted) so its attendance/progress history is retained (D-13)."
  - "No application-level duplicate-active pre-check — takeSeat's P2002 -> AlreadyEnrolledError translation is the only guard (D-15); grep gate confirms no findFirst on status ACTIVE."

patterns-established:
  - "Explicit transition table + assertTransition before every enrolment write"
  - "claimSeat vs takeSeat vs releaseSeat — three seat primitives, one FOR UPDATE recipe location"
  - "Audit enrolment transitions with targetType 'Enrolment' + targetId = enrolment id (05-10 downstream contract, COH-07)"

requirements-completed: [COH-05, COH-06]

# Metrics
duration: 17min
completed: 2026-09-04
---

# Phase 5 Plan 07: Enrolment State Machine Summary

**The five COH-05 staff actions — add, approve, transfer, withdraw, cancel — each validated against an explicit `VALID_TRANSITIONS` table, reason-mandatory, seat-exact through `seat-accounting`, emitting one `DomainEvent` inside the write transaction and one `AuditEvent` (targetType `Enrolment`) after commit; transfer is same-offer only, atomic, and carries no history across.**

## Performance

- **Duration:** ~17 min
- **Tasks:** 3 (5 commits — Tasks 1 & 2 TDD: test -> feat; Task 3 test-only)
- **Files:** 3 created, 1 modified

## Accomplishments

- `VALID_TRANSITIONS` + `assertTransition` — `PENDING_PAYMENT -> {ACTIVE, CANCELLED}`, `ACTIVE -> {WITHDRAWN, TRANSFERRED, COMPLETED, CANCELLED}`, every terminal status empty. `COMPLETED` is not a Phase-5 action. Called before every row write.
- `addEnrolment` (D-11): straight to `ACTIVE` (seat via `takeSeat`, `activatedAt` set) or `PENDING_PAYMENT` (seat + `holdExpiresAt` when the cohort has a hold; **no seat and null `holdExpiresAt`** when `holdMinutes` is null/0 — D-02). `orderId` always null (comp/corporate/scholarship). `CapacityExceededError` / `AlreadyEnrolledError` surface as typed refusals.
- `approveEnrolment` (D-12): `PENDING_PAYMENT -> ACTIVE`, no payment record. Consults `holdsSeat(e)` — a hold-holding enrolment keeps its seat (0 increments), a hold-less one gets exactly one via the new `claimSeat` (RESEARCH Pitfall 3). Always nulls `holdExpiresAt` on the way to `ACTIVE`.
- `withdrawEnrolment` / `cancelEnrolment` (D-14): one shared `makeTerminalAction` helper. `releaseSeat` with `heldSeat: holdsSeat(e)` so a hold-less `PENDING_PAYMENT` cancel does not wrongly decrement. `WITHDRAWN` stamps `withdrawnAt`; `CANCELLED` does not.
- `transferEnrolment` (D-13): source cohort authorization; target confined to a sibling cohort of the same `courseId` or `programmeId` (`CrossOfferTransferError` otherwise, including same-cohort). One `$transaction`: `assertTransition(status, "TRANSFERRED")` -> `releaseSeat` on the source -> `takeSeat` on the target (target capacity enforced by the same lock; a full target rolls the whole transfer back) -> `writeDomainEvent`. New row carries `transferredFromId`; attendance/progress stay on the source `TRANSFERRED` row. One `enrolment.transferred` event, one audit row per side.
- `seat-accounting.claimSeat(tx, {cohortId})` — lock the Cohort row, `CapacityExceededError` before touching the counter, `seatsTaken + 1`. No insert, no status write (the caller does that in the same transaction).
- `tests/enrolment-service.test.ts` — 34 unit cases against a staged-commit fake `$transaction` running the **real** `takeSeat`/`claimSeat`/`releaseSeat`: the table, every `addEnrolment`/`approveEnrolment` branch with explicit seat-count assertions, both terminal actions, and every transfer path including the atomic-rollback-on-full-target.
- `tests/enrolment-service.integration.test.ts` — 8 real-Postgres cases: transfer end state (zero attendance carried, source keeps its two), cross-offer refusal, transfer atomicity, `AlreadyEnrolledError` (not a raw Prisma error), seat coherence across add(hold)->approve->withdraw (never above 1), hold-less approve claims exactly one, exactly-one-`DomainEvent`-plus-actor/reason-`AuditEvent` per action, terminal-status withdraw throws with no new event.

## Exact signatures (05-11, 05-14, Phase 6, Phase 7 call these)

```ts
// All five are withPermission("enrolments.manage", <DB-resolved cohort scope>) wrapped.
addEnrolment(input: {
  cohortId: string; userId: string;
  target: "ACTIVE" | "PENDING_PAYMENT";
  reason: string; accessStartsAt?: Date; accessEndsAt?: Date;
}): Promise<{ id: string; status: "ACTIVE" | "PENDING_PAYMENT"; heldSeat: boolean }>;

approveEnrolment(input: { enrolmentId: string; reason: string }):
  Promise<{ id: string; status: "ACTIVE"; claimedSeat: boolean }>;

transferEnrolment(input: { enrolmentId: string; targetCohortId: string; reason: string }):
  Promise<{ sourceEnrolmentId: string; targetEnrolmentId: string }>;

withdrawEnrolment(input: { enrolmentId: string; reason: string }):
  Promise<{ id: string; status: "WITHDRAWN" }>;

cancelEnrolment(input: { enrolmentId: string; reason: string }):
  Promise<{ id: string; status: "CANCELLED" }>;

// Standalone:
function assertTransition(from: EnrolmentStatusValue, to: EnrolmentStatusValue, enrolmentId?: string | null): void;
const VALID_TRANSITIONS: Record<EnrolmentStatusValue, EnrolmentStatusValue[]>;

// Errors: IllegalTransitionError (from, to, enrolmentId), CrossOfferTransferError
//   (sourceCohortId, targetCohortId), EnrolmentNotFoundError (enrolmentId), ReasonRequiredError.
// Re-used from seat-accounting: CapacityExceededError, AlreadyEnrolledError, CohortNotFoundError.

// seat-accounting.ts (new):
function claimSeat(tx: SeatTxClient, args: { cohortId: string }): Promise<void>;
```

Domain event types emitted (all in the closed `DomainEventType` union): `enrolment.created`, `enrolment.approved`, `enrolment.transferred`, `enrolment.withdrawn`, `enrolment.cancelled`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `approveEnrolment` hold-less branch could not "call takeSeat"**
- **Found during:** Task 1
- **Issue:** The plan's action text for `approveEnrolment` says to "call `takeSeat` ONLY when [`holdsSeat`] returns false". But `takeSeat` (05-04) does `tx.enrolment.create` — it INSERTs a new enrolment. On approve the `PENDING_PAYMENT` row already exists, so calling `takeSeat` would create a duplicate row.
- **Fix:** Added `claimSeat(tx, { cohortId })` to `src/server/services/seat-accounting.ts` — the same `SELECT … FOR UPDATE` + `CapacityExceededError` + `seatsTaken + 1` as `takeSeat`, minus the insert. Keeps the blessed row-lock recipe in the one file the RESEARCH doc and the threat register (T-05-41) require it to live in, rather than re-implementing it inside `enrolment-service.ts`.
- **Files modified:** `src/server/services/seat-accounting.ts`
- **Commit:** `4a53589`
- **Coverage:** unit test (`approveEnrolment` hold-less branch asserts `seatsTaken` +1; full-cohort hold-less approve asserts `CapacityExceededError`) + integration case 6 (hold-less approve) and case 5 (seat coherence).

**2. [Rule 1 - Bug] `approveEnrolment` audit `before` captured the post-update status**
- **Found during:** Task 1 GREEN
- **Issue:** `return { id: e.id, before: e.status }` was evaluated after `tx.enrolment.update` had mutated the same in-memory row, so the audit `before` read `ACTIVE` instead of `PENDING_PAYMENT`.
- **Fix:** capture `const before = e.status` immediately after the `findUnique`, before any write. Same pattern applied to the terminal and transfer actions from the start.
- **Files modified:** `src/server/services/enrolment-service.ts`
- **Commit:** `4a53589`

### Note (not a deviation)

`transferEnrolment` returns `{ sourceEnrolmentId, targetEnrolmentId }` (the plan did not specify a return shape). 05-11 / 05-14 need the new enrolment id to link the UI.

## Downstream contract honoured (05-10)

Every transition calls `recordAudit` with `targetType: "Enrolment"` and `targetId` = the enrolment id (source id for the source-side transfer row, new id for the target-side row). Integration case 7 asserts the roster's `AuditEvent` key is populated for all five actions.

## Known Stubs

None.

## Threat Flags

None — the file implements mitigations already in the plan's threat register (T-05-38 through T-05-46). No new endpoints, auth paths, or trust-boundary schema changes. `claimSeat` is additive to an existing primitive and imports nothing new (worker import closure unaffected — `tests/boundary.test.ts` green).

## Verification Results

- `npx vitest run tests/enrolment-service.test.ts` — 34/34.
- `npx vitest run tests/enrolment-service.integration.test.ts` — 8/8 (Testcontainers Postgres).
- `npx vitest run tests/seat-accounting.integration.test.ts tests/schema-cohort.test.ts` — 30/30 (seat primitive + DB CHECKs still hold under the new writes).
- `npx vitest run tests/audit-append-only.test.ts tests/permissions.test.ts tests/boundary.test.ts` — 21/21.
- `npx vitest run tests/scheduled-session-service.test.ts tests/cohort-service.test.ts tests/domain-event-service.test.ts tests/cohort-scope.test.ts` — 102/102 (no regression).
- `npx tsc --noEmit` — exit 0. `npm run lint` — exit 0.
- Grep gates: `holdsSeat` x2; `refund|credit|approvalWorkflow|policyEngine` only in the header prose (line 19); `"enrolments.[a-z]+"` -> only `"enrolments.manage"`; `findFirst.*status.*ACTIVE` -> 0; `attendance|lessonProgress` only in header prose (line 23); `transferredFromId` x5.

## Self-Check: PASSED

- `src/server/services/enrolment-service.ts` — FOUND
- `tests/enrolment-service.test.ts` — FOUND
- `tests/enrolment-service.integration.test.ts` — FOUND
- `src/server/services/seat-accounting.ts` (claimSeat) — FOUND
- Commit `85ae0cd` (test) — FOUND
- Commit `4a53589` (feat) — FOUND
- Commit `a06e94e` (test) — FOUND
- Commit `4acfaa1` (feat) — FOUND
- Commit `9d2c895` (test) — FOUND

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
