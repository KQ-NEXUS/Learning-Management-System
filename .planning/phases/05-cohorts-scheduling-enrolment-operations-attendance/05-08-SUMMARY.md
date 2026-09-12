---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 08
subsystem: api
tags: [attendance, authorization, scope, prisma, postgres, vitest, tdd, domain-events]

# Dependency graph
requires:
  - phase: 05-02
    provides: "isWithinMarkingWindow/isBeforeSessionStart/markingWindowClosesAt (attendance-window.ts), computeAttendanceComponent (attendance-component.ts), sessionCohortScope/createCohortScopeResolvers (cohort-scope.ts)"
  - phase: 05-04
    provides: "writeDomainEvent(tx, event) transactional outbox writer, closed DomainEventType union incl. 'attendance.changed'"
provides:
  - "src/server/services/attendance-service.ts — createAttendanceService DI factory + createPrismaBackedAttendanceService binding; markAttendance, saveSessionAttendance, loadSessionRegister"
  - "PreMarkingStateError, CorrectionReasonRequiredError, LearnerNotOnRosterError, SessionNotFoundError typed refusals"
  - "The verbatim attendance.changed payload shape Phase 9/11 and Phase 13 consume"
affects: [05-14, 09, 11, 13, roster-ui, attendance-marking-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Roster-scoped bulk write: derive the valid enrolment set from Enrolment where cohortId = session.cohortId, validate every submitted id + reject duplicates BEFORE any write, so an out-of-roster id refuses the whole batch atomically (reorder-service.ts verifyArrangement precedent)"
    - "Component recompute happens INSIDE the same $transaction as the upsert, reading through tx (not the outer deps), so the recomputed component and the emitted event reflect the write that just happened"
    - "Correction-vs-mark timing is derived from two pure predicates only (isBeforeSessionStart, isWithinMarkingWindow) — afterClose = !beforeStart && !inWindow, never a third ad-hoc comparison"
    - "Skip-unchanged bulk write: an entry whose state AND note already match the stored row produces no event and no audit row"

key-files:
  created:
    - "src/server/services/attendance-service.ts"
    - "tests/attendance-service.test.ts"
    - "tests/attendance-service.integration.test.ts"
  modified: []

key-decisions:
  - "createPrismaBackedAttendanceService binds its OWN createCohortScopeResolvers instance to the injected client, rather than importing the production-bound sessionCohortScope singleton — this is what lets the integration test's COHORT-scoped grant resolve against the Testcontainers database instead of the dev Neon database the production singleton points at (a GLOBAL grant would have masked this bug, since grantMatches short-circuits before looking at the resource)."
  - "Correction timing is computed as afterClose = !isBeforeSessionStart && !isWithinMarkingWindow — a correction reason is required only once the window has CLOSED, never during the pre-start period (EXCUSED/NOT_RECORDED must succeed with no reason before a session starts)."
  - "The attendance.changed payload carries before, after, component (the discriminated AttendanceComponent), cohortId, sessionId, enrolmentId, actorId and a correction boolean — recorded verbatim below for Phase 9/11 and Phase 13."
  - "Every mutation audits with targetType: \"Enrolment\", targetId = enrolmentId (the 05-10 downstream contract) — action \"attendance.changed\" for both a mark and a correction, reason null inside the window."
  - "saveSessionAttendance validates ALL entries (roster membership, duplicates, then per-entry timing) before opening the transaction — a bad id or an illegal state anywhere in the batch writes nothing, not even for other valid entries in the same call."

patterns-established:
  - "TDD RED (test commit) -> GREEN (feat commit) per task"
  - "Bulk-write roster scoping via a DB-resolved set + pre-transaction validation (no partial writes on refusal)"

requirements-completed: [ATT-01, ATT-02, ATT-03]

# Metrics
duration: 45min
completed: 2026-09-04
---

# Phase 5 Plan 08: Attendance Service (mark/correct, roster-scoped bulk, marking window) Summary

**Single and bulk attendance marking scoped to the cohort roster via a DB-resolved enrolment set, the pre-marking restriction to EXCUSED/NOT_RECORDED, the 168-hour correction window with mandatory reason and preserved original stamps, and one `attendance.changed` domain event per changed record carrying the recomputed attendance component — no completion verdict anywhere in this file.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-09-04T12:33:00Z
- **Completed:** 2026-09-04T15:10:00Z
- **Tasks:** 3 (Tasks 1–2 TDD: test + feat commits each; Task 3 integration test)
- **Files created:** 3 (1 source, 2 test)

## Accomplishments

- `createAttendanceService(deps)` DI factory + `createPrismaBackedAttendanceService(client, withPermission, audit)` binding, mirroring the `enrolment-service.ts` shape. Exposes `markAttendance`, `saveSessionAttendance`, `loadSessionRegister`.
- `markAttendance` — `withPermission("attendance.manage", sessionCohortScope)`. Validates the enrolment belongs to the session's own cohort (`LearnerNotOnRosterError` otherwise, D-10). Refuses `PRESENT`/`ABSENT`/`LATE` before `startsAt` (`PreMarkingStateError`, D-09) while allowing `EXCUSED`/`NOT_RECORDED` freely, including at exactly `startsAt`/`endsAt+168h`. Inside the window: upserts on `[sessionId, enrolmentId]`, stamps `recordedById`/`recordedAt`. Past the window: requires a non-empty trimmed reason (`CorrectionReasonRequiredError` otherwise, D-08) and stamps `correctedById`/`correctedAt`/`correctionReason` **without disturbing** the original `recordedById`/`recordedAt`. Every write recomputes the component (via `computeAttendanceComponent`, reading through the same transaction) and emits exactly one `attendance.changed` event, then audits after commit with `targetType: "Enrolment"`.
- `saveSessionAttendance` — same authorization/window/pre-marking rules, applied to a whole session in one call. The roster is derived from `Enrolment where cohortId = session.cohortId` — **never** the caller's list. Every submitted `enrolmentId` is checked against that DB-resolved set and duplicates are rejected, **all before opening the transaction**, so one bad id refuses the entire batch with zero writes (proven at both unit and integration level). Entries whose state+note already match the stored row are skipped — no event, no audit row — so a "save all" over an unchanged register is a no-op.
- `loadSessionRegister` — `withPermission("attendance.view", sessionCohortScope)`. Returns one row per enrolment not `TRANSFERRED`/`CANCELLED`, with learner identity, current state (defaulting `NOT_RECORDED`), note, `isCorrection` (from `correctionReason !== null`), `windowClosesAt` (`markingWindowClosesAt`), and `canSetLiveStates` (`!isBeforeSessionStart`) — the courtesy echo the marking screen uses to disable live states, not the enforcement itself.
- `tests/attendance-service.test.ts` — 32 unit tests against an in-memory staged-commit fake (real `computeAttendanceComponent` + real `writeDomainEvent` run against the fake tx): authorization, roster scoping, every D-09/D-06/D-08 timing boundary (including the exact `startsAt`, `endsAt+168h`, and `+168h+1ms` instants), event payload shape, audit rows, atomic bulk refusal, and unchanged-entry skipping.
- `tests/attendance-service.integration.test.ts` — 9 cases against real Postgres (Testcontainers): out-of-scope bulk refusal writes zero rows for either cohort; a COHORT-scoped grant on a sibling cohort is denied with `AuthorizationError` (not filtered); pre-marking refusal/allowance; the exact 167h/169h window boundary with `recordedById` surviving a correction; append-only `AuditEvent` history across a mark + correction; the `attendance.changed` payload with a `computed` component (`earnedPct`/`requiredPct`) and a `no-rule` component for a null-threshold cohort; the `attendance_correction_has_reason` DB CHECK as the backstop.

## Task Commits

1. **Task 1: Single-record marking with the pre-marking and correction-window rules**
   - `5fd8a0c` test(05-08): add failing tests for single-record attendance marking
   - `c4b246a` feat(05-08): single-record attendance marking with pre-marking and correction-window rules
2. **Task 2: Roster-scoped bulk save and the session register read**
   - `76b9f7f` test(05-08): add failing tests for roster-scoped bulk save and the session register
   - `061cc87` feat(05-08): roster-scoped bulk save and the session register read
3. **Task 3: Real-Postgres scoping, window and event proofs**
   - `7bab2d4` test(05-08): real-Postgres proofs for roster scoping, the window boundary and event emission

_Plan metadata (SUMMARY.md / STATE.md / ROADMAP.md) is disk-only — `.planning/` is gitignored in this repo, so no metadata commit was made (sequential-mode execution note)._

## Files Created/Modified

- `src/server/services/attendance-service.ts` — Mark/correct + roster-scoped bulk save + session register read; DI factory `createAttendanceService` + `createPrismaBackedAttendanceService` binding.
- `tests/attendance-service.test.ts` — 32 unit tests (staged-commit fake, injected `now`).
- `tests/attendance-service.integration.test.ts` — 9 real-Postgres tests (Testcontainers).

## The `attendance.changed` event payload (verbatim — Phase 9/11 and Phase 13 consume this)

```typescript
{
  type: "attendance.changed",
  payload: {
    sessionId: string;
    enrolmentId: string;
    cohortId: string;
    before: AttendanceStateValue;   // the state prior to this write ("NOT_RECORDED" if no prior row)
    after: AttendanceStateValue;    // the newly written state
    correction: boolean;            // true iff this write happened after the 168h window closed
    component: AttendanceComponent; // computeAttendanceComponent's discriminated union, recomputed post-write
    actorId: string;
  },
}
```

`AttendanceComponent` (from `src/server/services/attendance-component.ts`, plan 05-02):
```typescript
| { kind: "computed"; earnedPct: number; requiredPct: number; attendedCount: number; countableCount: number; meetsThreshold: boolean }
| { kind: "no-rule" }      // cohort has no attendanceThresholdPct
| { kind: "no-sessions" }  // no countable session exists yet
```

## Exported signatures

```typescript
export function createAttendanceService(deps: AttendanceServiceDeps): {
  markAttendance: (input: { sessionId: string; enrolmentId: string; state: AttendanceStateValue; note?: string; reason?: string }) => Promise<{ sessionId: string; enrolmentId: string; state: AttendanceStateValue; before: AttendanceStateValue; corrected: boolean }>;
  saveSessionAttendance: (input: { sessionId: string; entries: Array<{ enrolmentId: string; state: AttendanceStateValue; note?: string; reason?: string }> }) => Promise<{ sessionId: string; total: number; changed: number }>;
  loadSessionRegister: (input: { sessionId: string }) => Promise<Array<{
    enrolmentId: string; learnerId: string; learnerName: string; learnerEmail: string;
    status: string; state: AttendanceStateValue; note: string | null;
    isCorrection: boolean; windowClosesAt: Date; canSetLiveStates: boolean;
  }>>;
};

export function createPrismaBackedAttendanceService(client, withPermission, audit?): ReturnType<typeof createAttendanceService>;

export const markAttendance: ReturnType<typeof createAttendanceService>["markAttendance"];
export const saveSessionAttendance: ReturnType<typeof createAttendanceService>["saveSessionAttendance"];
export const loadSessionRegister: ReturnType<typeof createAttendanceService>["loadSessionRegister"];

export class PreMarkingStateError extends Error { sessionId; enrolmentId; state; }
export class CorrectionReasonRequiredError extends Error { sessionId; enrolmentId; windowClosedAt; }
export class LearnerNotOnRosterError extends Error { sessionId; enrolmentId; }
export class SessionNotFoundError extends Error { sessionId; }
```

## Decisions Made

- **`createPrismaBackedAttendanceService` binds its own `createCohortScopeResolvers` instance to the injected client** rather than the production-bound `sessionCohortScope` singleton (which is wired to the dev Neon database). This is what let the integration test's D-21 case genuinely prove a COHORT-scoped grant is denied against a Testcontainers-seeded sibling cohort — a GLOBAL grant (as `enrolment-service`'s integration test uses) would never have exercised the resolver at all, since `grantMatches` short-circuits on `scopeType === "GLOBAL"` before looking at the resource.
- **Timing split into two orthogonal checks**: `isBeforeSessionStart` gates the live-state restriction (D-09); `afterClose = !beforeStart && !inWindow` gates the correction-reason requirement (D-06/D-08). The two are deliberately NOT the same condition — a pre-start `EXCUSED`/`NOT_RECORDED` mark needs no reason even though `isWithinMarkingWindow` is false before `startsAt`.
- **Bulk save validates everything before opening the transaction**: roster membership, duplicate ids, then per-entry pre-marking/window rules are all checked in plain application code first. Only a fully-valid, changed subset ever reaches `$transaction`, so the "atomic refusal" behaviour falls out of validation order rather than needing a rollback.
- **Component recompute reads through the transaction client (`tx`), not the outer `deps`** — the just-written upsert must be visible to `computeAttendanceComponent`'s inputs before the event commits.
- **Audit action stays a single `"attendance.changed"` string** for both a plain mark and a correction — the audit row's `reason` field (`null` vs. non-null) is what distinguishes them, matching how `enrolment-service.ts` uses one action name per transition rather than a `.corrected` variant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The integration test's DB-backstop case used a `null` `correctionReason`, which the CHECK constraint does not actually reject**
- **Found during:** Task 3 (integration test, case 7)
- **Issue:** `attendance_correction_has_reason`'s second branch is `correctedAt IS NOT NULL AND length(btrim(correctionReason)) > 0`. Under SQL three-valued logic, `length(btrim(NULL))` is `NULL`, so `TRUE AND NULL` is `NULL` (unknown) rather than `FALSE` — and Postgres only rejects a `CHECK` when it evaluates to `FALSE`, not `NULL`. A direct update setting `correctedAt` with `correctionReason: null` therefore silently succeeds; only an **empty string** (`length(btrim("")) > 0` is `FALSE`) actually triggers the constraint.
- **Fix:** Changed the test's update payload from `correctionReason: null` to `correctionReason: ""`, with a header comment explaining the NULL-semantics gap so a future reader does not "fix" the test back to `null`. This is a pre-existing constraint from plan 05-01, not modified here — it is a documented characteristic of the backstop, not a regression this plan introduced.
- **Files modified:** `tests/attendance-service.integration.test.ts`
- **Verification:** The corrected test rejects with a thrown error, as the acceptance criterion requires.
- **Committed in:** `7bab2d4` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, test-only — no production code change)
**Impact on plan:** No scope creep; the underlying `attendance_correction_has_reason` CHECK (05-01) is out of this plan's file set and was not modified. Flagging the NULL-vs-empty-string gap here so a future correction-flow author does not assume `correctionReason: null` is caught by the DB.

### Acceptance-gate deviation (documented, not auto-fixed)

The plan's Task 1 acceptance criterion `grep -oE '"attendance\.[a-z]+"' … | sort -u` is specified to return only `"attendance.manage"` (plus `"attendance.view")`. In practice it also matches the domain-event type literal `"attendance.changed"`, which the plan's own Task 1 `<action>` text mandates (`writeDomainEvent(tx, { type: "attendance.changed", … })`) and which is a member of the closed `DomainEventType` union from plan 05-04 — it is not a permission identifier. The intent of the gate (no permission string beyond `attendance.manage`/`attendance.view`) is met; the regex is simply broader than the property it was written to check. No code change was made to work around this (e.g. constructing the string to dodge the grep) since that would reduce grep-ability for real maintainers with zero security benefit.

## Issues Encountered

- Three integration-test cases (ATT-03 audit history, both ATT-02 event-payload cases) initially used the `seedSessionFixture` default (`startsAt` one day in the future), which correctly tripped `PreMarkingStateError` for a `PRESENT`/`ABSENT` mark — those tests were not testing pre-marking, so the sessions were re-seeded with `startsAt`/`endsAt` in the recent past (still inside the 168h window) before the fix. Caught during the first integration test run; no production code change needed.

## Threat Flags

None — all four request-facing operations (`markAttendance`, `saveSessionAttendance`, `loadSessionRegister`, plus the internal component recompute) implement mitigations already enumerated in the plan's own `<threat_model>` (T-05-47 through T-05-54). No new endpoint, schema change, or file-access path was introduced.

## Known Stubs

None. Both `markAttendance` and `saveSessionAttendance` are fully wired to real roster/session/cohort data with no placeholder branches; `loadSessionRegister` is consumed directly by the plan 05-14 marking-screen UI with real data, not mock data.

## Next Phase Readiness

- The `attendance.changed` payload shape above is the exact contract Phase 9/11's completion engine and Phase 13's email drain will subscribe to — no completion verdict is computed anywhere in this file (D-20 honoured).
- `loadSessionRegister` and `saveSessionAttendance` are ready for plan 05-14's "arrange-board-style" attendance marking screen (one state control per learner, one "Save attendance" commit) — `canSetLiveStates` and `windowClosesAt` are the exact fields that screen needs to disable pre-start controls and show the closed-window copy from `05-UI-SPEC.md`.
- Every mutation audits with `targetType: "Enrolment"`, satisfying the 05-10 roster's downstream contract for `transitionCount`/`latestTransition` — combined with 05-07's enrolment-transition audits, the roster's transition history now has real attendance-change entries alongside status transitions.
- The one documented gap: the `attendance_correction_has_reason` CHECK (05-01) does not reject a `correctionReason: null` update via SQL NULL semantics — only an empty string. The service-level `CorrectionReasonRequiredError` is the real guard (it rejects both `null` and blank/whitespace-only reasons before any write); the DB CHECK remains a partial backstop. Worth a follow-up note if plan 05-01's constraint is ever revisited.

## Self-Check: PASSED

- FOUND: src/server/services/attendance-service.ts
- FOUND: tests/attendance-service.test.ts
- FOUND: tests/attendance-service.integration.test.ts
- FOUND commits: 5fd8a0c, c4b246a, 76b9f7f, 061cc87, 7bab2d4

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
