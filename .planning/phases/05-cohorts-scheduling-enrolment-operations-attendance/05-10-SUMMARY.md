---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 10
subsystem: api
tags: [authorization, scope, cohort, roster, attendance, csv, prisma, vitest, tdd]

# Dependency graph
requires:
  - phase: 05-01
    provides: "Cohort/Enrolment/ScheduledSession/AttendanceRecord schema + DomainEvent, tests/support/cohort-fixtures.ts"
  - phase: 05-02
    provides: "computeAttendanceComponent + AttendanceComponent union, cohortResourceScope, markingWindowClosesAt"
provides:
  - "src/server/services/roster-service.ts — loadCohortRoster, loadAttendanceExceptions, exceptionsToCsv, EXCEPTION_CATEGORIES, the RosterRow + AttendanceException types, MissingCohortIdError"
  - "The DeferredColumn discriminated union ({ kind: 'deferred'; phase: 9 | 10 | 11 }) — the roster's structural guard against a fake zero for a Phase 9/10/11 column (D-18)"
affects: [05-14, 09, 10, 11, roster-ui, attendance-exceptions-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Authorized-read helper as a DI factory + bound instance (createRosterService / built), like createAuditReadService — a narrow store slice injected for unit tests, real prisma bound in production"
    - "Deferred columns typed as a literal discriminated union ONLY (no number, no null) so a `?? 0` is a compile error, not a code-review catch"
    - "Bounded synchronous CSV: a pure serialiser takes the already-authorized, already-filtered rows — screen/CSV parity is structural, not re-derived (ATT-04)"
    - "CSV formula-injection defence: prefix a leading = + - @ with a single quote, then RFC-4180 quote/escape comma/quote/newline"

key-files:
  created:
    - "src/server/services/roster-service.ts"
    - "tests/roster-service.test.ts"
  modified: []

key-decisions:
  - "roster-service is a createRosterService(deps) DI factory + a prisma-bound `built` instance (mirrors audit-read-service), NOT the resource-service factory — it is read-only surface the factory list/get cannot express"
  - "transition history is read from AuditEvent (targetType: 'Enrolment', targetId in enrolmentIds) — no EnrolmentTransition table (T-05-67); plans 05-07/05-08 must write enrolment transitions with targetType 'Enrolment'"
  - "loadRosterInputs is shared by both public functions: cohort (threshold + instructor names), enrolments (all for the roster; ACTIVE-only for exceptions), all non-cancelled+cancelled sessions, and attendance records for those enrolments — a bounded, fixed number of queries regardless of learner count"
  - "missing-register fires when a non-cancelled attendance-expected session has STARTED (startsAt <= now) and an active learner has a NOT_RECORDED or absent record; markingWindowClosesAt supplies the displayed deadline; future sessions never fire"
  - "at-risk requires a non-null threshold AND at least one future non-cancelled session AND a computed component below threshold; a null threshold can never be at-risk (there is no rule)"
  - "exceptionsToCsv takes AttendanceException[] as its only argument and issues no query — the CSV column set flattens the three-member union into Category/Learner/Session/Detail/Timestamp"

patterns-established:
  - "DI factory + bound instance for authorized reads with a narrow injected store slice"
  - "Literal-union deferred columns as the compile-time guard against fake zeroes (D-18, Pitfall 7)"
  - "Pure, injection-safe CSV serialiser that receives pre-filtered rows for structural filter/CSV parity"
  - "TDD RED (test commit) -> GREEN (feat commit) per task"

requirements-completed: [COH-07, ATT-04]

# Metrics
duration: 30min
completed: 2026-09-04
---

# Phase 5 Plan 10: Cohort Roster Service + Attendance Exceptions & Bounded CSV Summary

**A `cohorts.view`-scoped cohort roster (learner identity, AuditEvent-derived transition history, access window, instructor assignment, the discriminated attendance component, and Progress/Assessment/Completion typed so only the named Phase 9/10/11 gap is representable) plus an `attendance.view`-scoped three-category exceptions view whose bounded synchronous CSV is a pure serialiser of the already-filtered rows, injection-safe against spreadsheet formula execution.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-04T11:48:00Z
- **Completed:** 2026-09-04T11:58:00Z
- **Tasks:** 2 (both TDD — RED test commit + GREEN feat commit each)
- **Files created:** 2 (1 source, 1 test)

## Accomplishments

- `loadCohortRoster({ cohortId })` — `withPermission("cohorts.view", cohortResourceScope)`. One row per enrolment, ordered by learner name. An out-of-scope cohort throws `AuthorizationError` (proven by test) — never a filtered-to-empty roster, and the message is identical whether or not the cohort exists (T-05-61/62). A COURSE-scoped grant on a Programme cohort's member course reaches the roster via the `courseIds` the scope resolver populates.
- Each row carries `learnerId/Name/Email`, `enrolmentId`, `status`, `transitionCount` + `latestTransition` (actor id/name, action, reason, time) drawn from `AuditEvent` — there is no `EnrolmentTransition` table (T-05-67), `accessStartsAt/EndsAt`, the cohort's `instructors` names, and `attendance: AttendanceComponent` via `computeAttendanceComponent` (a null threshold yields `{ kind: "no-rule" }`).
- `progress` / `assessment` / `completion` are typed as `DeferredColumn` (`{ kind: "deferred"; phase: 9 | 10 | 11 }`) **only** — a `@ts-expect-error` test proves a numeric `progress` does not compile (D-18, Pitfall 7). `grep -cE '\?\? 0|\|\| 0|\|\| "-"'` returns 0.
- `EXCEPTION_CATEGORIES` — the frozen tuple `["missing-register", "at-risk", "disputed"]`.
- `loadAttendanceExceptions({ cohortId, categories?, search? })` — `withPermission("attendance.view", cohortResourceScope)`, bounded to one cohort (`MissingCohortIdError` on an empty id, T-05-65). Computes all three categories for real over ACTIVE enrolments / non-cancelled sessions / records / threshold; honours a category filter and a case-insensitive learner-name search.
- `exceptionsToCsv(rows)` — pure, no query. Header + exactly one line per supplied row (parity test: `csv.split("\n").length - 1 === rows.length`). A value starting with `= + - @` gets a leading `'`; commas/quotes/newlines are RFC-4180 quoted and escaped (T-05-64).

## Exported types (recorded verbatim — plan 05-14 renders these directly)

```typescript
export type DeferredColumn = { kind: "deferred"; phase: 9 | 10 | 11 };

export type RosterTransition = {
  action: string;
  reason: string | null;
  actorId: string | null;
  actorName: string | null;
  at: Date;
};

export type RosterRow = {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  enrolmentId: string;
  status: string;
  /** How many `AuditEvent` rows target this enrolment. */
  transitionCount: number;
  /** The latest of those rows, or `null` when the enrolment has no audit history. */
  latestTransition: RosterTransition | null;
  accessStartsAt: Date | null;
  accessEndsAt: Date | null;
  /** The cohort's assigned instructor names (D-17). */
  instructors: string[];
  /** `{ kind: "no-rule" }` when the cohort has no `attendanceThresholdPct`. */
  attendance: AttendanceComponent;
  progress: DeferredColumn;
  assessment: DeferredColumn;
  completion: DeferredColumn;
};

export const EXCEPTION_CATEGORIES: readonly ["missing-register", "at-risk", "disputed"];
export type ExceptionCategory = (typeof EXCEPTION_CATEGORIES)[number];

export type MissingRegisterException = {
  category: "missing-register";
  sessionId: string;
  sessionTitle: string;
  sessionStartsAt: Date;
  /** `endsAt + 168h` — the instant the normal marking window closes. */
  markingClosesAt: Date;
  unmarkedLearnerCount: number;
};

export type AtRiskException = {
  category: "at-risk";
  enrolmentId: string;
  learnerName: string;
  earnedPct: number;
  requiredPct: number;
};

export type DisputedException = {
  category: "disputed";
  enrolmentId: string;
  learnerName: string;
  sessionId: string;
  sessionTitle: string;
  correctionReason: string;
  correctedByName: string | null;
  correctedAt: Date | null;
};

export type AttendanceException =
  | MissingRegisterException
  | AtRiskException
  | DisputedException;

export type AttendanceExceptionFilters = {
  categories?: ExceptionCategory[];
  search?: string;
};

export class MissingCohortIdError extends Error {}

// From ./attendance-component (plan 05-02), re-consumed here:
// AttendanceComponent =
//   | { kind: "computed"; earnedPct; requiredPct; attendedCount; countableCount; meetsThreshold }
//   | { kind: "no-rule" }
//   | { kind: "no-sessions" }
```

Signatures:

```typescript
export function createRosterService(deps: {
  store: RosterStore;
  resolveCohortScope: (cohortId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: ReturnType<typeof createWithPermission>;
  now?: () => Date;
}): {
  loadCohortRoster: (input: { cohortId: string }) => Promise<RosterRow[]>;
  loadAttendanceExceptions: (
    input: { cohortId: string } & AttendanceExceptionFilters,
  ) => Promise<AttendanceException[]>;
};

export const loadCohortRoster: (input: { cohortId: string }) => Promise<RosterRow[]>;
export const loadAttendanceExceptions: (
  input: { cohortId: string } & AttendanceExceptionFilters,
) => Promise<AttendanceException[]>;
export function exceptionsToCsv(rows: AttendanceException[]): string;
```

## Task Commits

1. **Task 1: Scoped cohort roster with named deferred columns**
   - `890fa8c` test(05-10): add failing tests for the scoped cohort roster
   - `0ca6bc4` feat(05-10): scoped cohort roster with named deferred columns
2. **Task 2: Attendance exceptions and the bounded, filter-parity CSV**
   - `f5f55b5` test(05-10): add failing tests for attendance exceptions and the parity CSV
   - `1493723` feat(05-10): attendance exceptions and the bounded, filter-parity CSV

_Plan metadata (SUMMARY.md / STATE.md / ROADMAP.md) is disk-only — `.planning/` is gitignored in this repo, so no metadata commit was made (sequential-mode execution note)._

## Files Created/Modified

- `src/server/services/roster-service.ts` - Authorized-read cohort roster + attendance exceptions + pure bounded CSV; DI factory `createRosterService` + prisma-bound instance.
- `tests/roster-service.test.ts` - 23 unit tests: scoping denial (D-21), row contents (D-17), deferred columns + `@ts-expect-error` type guard (D-18), the three exception categories incl. the negative cases (future session, null threshold), and CSV parity + formula-injection (ATT-04, T-05-63/64).

## Decisions Made

- **`roster-service` is a DI factory + bound instance, not a `createResourceService` instance.** It is read-only surface the CRUD factory's `list`/`get` cannot express (audit-derived history, per-learner attendance component, `_count`-style aggregates), matching the `createAuditReadService` shape.
- **Transition history comes from `AuditEvent`, keyed `targetType: "Enrolment"`.** No second table. Plans 05-07 / 05-08 must record enrolment transitions with `targetType: "Enrolment"` and `targetId` = the enrolment id for the roster's `latestTransition` / `transitionCount` to populate.
- **`loadRosterInputs` is a shared bounded read** taking an optional `status` filter — the roster loads all enrolments, the exceptions view loads `ACTIVE` only.
- **CSV column set** flattens the union into `Category, Learner, Session, Detail, Timestamp` — `Detail` carries `"{n} learners unmarked"` / `"{earned}% / {required}%"` / the correction reason depending on category.

## Deviations from Plan

None - plan executed exactly as written. Both tasks completed via TDD (RED test commit, GREEN feat commit); no REFACTOR commits needed. One in-comment reword: the `DeferredColumn` doc comment originally contained the literal token `?? 0`, which tripped the plan's `grep -cE '\?\? 0...'` acceptance gate (expected 0) — reworded to "a numeric fallback (a zero, ...)" with no code change, exactly as plan 05-02 did for its own grep gates.

## Issues Encountered

- The `DeferredColumn` header comment contained `?? 0` verbatim and failed the `grep -cE` acceptance gate. Reworded the prose; gate now returns 0. No behaviour change.

## Threat surface scan

No new security-relevant surface beyond the plan's `<threat_model>`. Both reads route through `withPermission` + `cohortResourceScope` (the choke point, unmodified `AuthorizationError`); the CSV is a pure function of pre-authorized rows; no new endpoint, schema change, or file access.

## Next Phase Readiness

- `RosterRow` / `AttendanceException` / `DeferredColumn` are ready for plan 05-14's roster and exceptions tables and the bounded-CSV download button. `exceptionsToCsv` is the exact function the CSV route should call with the on-screen filtered rows.
- **Blocker for full COH-07 population:** enrolment transitions are not yet written anywhere — plans 05-07 (enrolment state machine) and 05-08 (attendance) must audit with `targetType: "Enrolment"` for `transitionCount` / `latestTransition` to be non-empty. Until then those fields are correctly `0` / `null` (not a stub — the audit trail is genuinely empty pre-05-07).
- Phase 9/10/11 will each widen its `DeferredColumn` field deliberately when its engine lands.

## Self-Check: PASSED

- FOUND: src/server/services/roster-service.ts
- FOUND: tests/roster-service.test.ts
- FOUND commits: 890fa8c, 0ca6bc4, f5f55b5, 1493723

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
