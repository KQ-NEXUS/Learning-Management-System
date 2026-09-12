---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 02
subsystem: api
tags: [timezone, intl, attendance, authorization, scope, prisma, vitest, tdd]

# Dependency graph
requires:
  - phase: 04-catalogue-authoring
    provides: "readiness-service.ts pure-evaluator discipline, resource-service async toScope, permissions/scope.ts ResourceScope + grantMatches, catalogue-guards DI-factory pattern"
  - phase: 05-01
    provides: "Cohort.holdMinutes / Enrolment.holdExpiresAt / DomainEvent schema delta, tests/support/cohort-fixtures.ts"
provides:
  - "src/lib/timezone.ts — isValidTimeZone, wallTimeToUtc, utcToWallParts (pure, zero imports)"
  - "src/lib/attendance-window.ts — ATTENDANCE_MARKING_WINDOW_HOURS=168, isWithinMarkingWindow, isBeforeSessionStart, markingWindowClosesAt (pure, zero imports)"
  - "src/server/services/attendance-component.ts — computeAttendanceComponent + AttendanceComponent discriminated union (pure, zero imports)"
  - "src/server/services/cohort-scope.ts — createCohortScopeResolvers DI factory + bound cohortResourceScope / sessionCohortScope / enrolmentCohortScope"
affects: [05-05, 05-06, 05-07, 05-08, 05-09, 05-10, 05-11, cohort-service, session-service, enrolment-service, attendance-service, roster-service]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure lib modules with a documented single-pass DST caveat for Intl-based wall-clock conversion"
    - "Marking-window math kept strictly to UTC Date arithmetic — grep-gated against Intl on the path"
    - "Discriminated-union third states (no-rule / no-sessions) instead of a fake 0%"
    - "Async DB-derived scope resolvers as a DI factory + bound instance, type-only ResourceScope import"

key-files:
  created:
    - "src/lib/timezone.ts"
    - "src/lib/attendance-window.ts"
    - "src/server/services/attendance-component.ts"
    - "src/server/services/cohort-scope.ts"
    - "tests/timezone.test.ts"
    - "tests/attendance-window.test.ts"
    - "tests/attendance-component.test.ts"
    - "tests/cohort-scope.test.ts"
  modified: []

key-decisions:
  - "utcToWallParts also returns a formatted `label` string for display so callers do not re-implement formatting"
  - "cohortResourceScope always emits `courseIds` (possibly empty) when the row exists, matching the 05-PATTERNS reference body"
  - "cohort-scope delegates are three narrow findUnique slices (cohort / session / enrolment), each injectable, bound to prisma.cohort / prisma.scheduledSession / prisma.enrolment"

patterns-established:
  - "Pure-module grep gates: zero `^import`, no `Intl` in attendance-window, no `Temporal` in timezone"
  - "TDD RED (test commit) → GREEN (feat commit) per task"

requirements-completed: [COH-03, COH-07, ATT-02, ATT-03]

# Metrics
duration: 20min
completed: 2026-09-04
---

# Phase 5 Plan 02: Pure Building Blocks (timezone, marking window, attendance component, cohort scope) Summary

**Four pure, exhaustively unit-tested modules — an Intl-based wall-clock↔UTC converter, a UTC-only 168h attendance marking-window predicate, a discriminated-union attendance-component calculator, and async DB-derived cohort scope resolvers that make COHORT scope load-bearing.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-04T09:32:00Z
- **Completed:** 2026-09-04T09:43:00Z
- **Tasks:** 3 (all TDD, RED + GREEN commits each)
- **Files created:** 8 (4 source, 4 test)

## Accomplishments

- `src/lib/timezone.ts` — `isValidTimeZone` (rejects `""` and typos via `Intl.supportedValuesOf`), `wallTimeToUtc` (formatToParts offset correction), `utcToWallParts` (round-trips for `Africa/Lagos` and `America/New_York` in both EST and EDT), with the single-pass DST-gap caveat documented in the header.
- `src/lib/attendance-window.ts` — `ATTENDANCE_MARKING_WINDOW_HOURS = 168` project constant plus `isWithinMarkingWindow` / `isBeforeSessionStart` / `markingWindowClosesAt`, pure UTC `Date` arithmetic with the four boundary instants pinned (`startsAt - 1ms`, `startsAt`, `endsAt + 168h`, `endsAt + 168h + 1ms`).
- `src/server/services/attendance-component.ts` — `computeAttendanceComponent` returns a discriminated union: `{ kind: "computed", earnedPct, requiredPct, attendedCount, countableCount, meetsThreshold }` | `{ kind: "no-rule" }` | `{ kind: "no-sessions" }`. LATE counts as attended, EXCUSED leaves the denominator, NOT_RECORDED/ABSENT stay in the denominator, cancelled and `attendanceExpected: false` sessions are excluded, `earnedPct` rounds to nearest integer. No completion verdict (reserved for Phase 9/11).
- `src/server/services/cohort-scope.ts` — `createCohortScopeResolvers(deps)` DI factory + bound `cohortResourceScope` / `sessionCohortScope` / `enrolmentCohortScope`. `cohortResourceScope` reads one `findUnique` and returns a `ResourceScope` populating `cohortId`, `programmeId` (when set) and `courseIds` (`[courseId]` for a standalone-Course cohort, `CohortCourse` member ids for a Programme cohort). Missing row → `{}` (deny by default). Composed test proves a `COURSE` grant on a member course reaches a Programme cohort via `grantMatches`.

## Exported signatures (consumed by plans 05-05 → 05-10)

```typescript
// src/lib/timezone.ts
export type WallTimeParts = { year: number; month: number; day: number; hour: number; minute: number };
export function isValidTimeZone(timeZone: string): boolean;
export function wallTimeToUtc(parts: WallTimeParts, timeZone: string): Date;
export function utcToWallParts(instant: Date, timeZone: string): WallTimeParts & { label: string };

// src/lib/attendance-window.ts
export const ATTENDANCE_MARKING_WINDOW_HOURS = 168;
export function isWithinMarkingWindow(session: { startsAt: Date; endsAt: Date }, now: Date): boolean;
export function isBeforeSessionStart(session: { startsAt: Date }, now: Date): boolean;
export function markingWindowClosesAt(session: { endsAt: Date }): Date;

// src/server/services/attendance-component.ts
export type AttendanceStateValue = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "NOT_RECORDED";
export type AttendanceComponentEntry = { state: AttendanceStateValue; attendanceExpected: boolean; cancelledAt: Date | string | null };
export type AttendanceComponentInput = { thresholdPct: number | null; entries: AttendanceComponentEntry[] };
export type AttendanceComponent =
  | { kind: "computed"; earnedPct: number; requiredPct: number; attendedCount: number; countableCount: number; meetsThreshold: boolean }
  | { kind: "no-rule" }
  | { kind: "no-sessions" };
export function computeAttendanceComponent(input: AttendanceComponentInput): AttendanceComponent;

// src/server/services/cohort-scope.ts
export type CohortScopeDelegate = { findUnique(args: { where: { id: string }; select: {...} }): Promise<CohortScopeRow | null> };
export type SessionScopeDelegate = { findUnique(args: { where: { id: string }; select: { cohortId: true } }): Promise<{ cohortId: string } | null> };
export type EnrolmentScopeDelegate = { findUnique(args: { where: { id: string }; select: { cohortId: true } }): Promise<{ cohortId: string } | null> };
export type CohortScopeDeps = { cohort: CohortScopeDelegate; session: SessionScopeDelegate; enrolment: EnrolmentScopeDelegate };
export function createCohortScopeResolvers(deps: CohortScopeDeps): {
  cohortResourceScope: (cohortId: string) => Promise<ResourceScope>;
  sessionCohortScope: (sessionId: string) => Promise<ResourceScope>;
  enrolmentCohortScope: (enrolmentId: string) => Promise<ResourceScope>;
};
export const cohortResourceScope: (cohortId: string) => Promise<ResourceScope>;
export const sessionCohortScope: (sessionId: string) => Promise<ResourceScope>;
export const enrolmentCohortScope: (enrolmentId: string) => Promise<ResourceScope>;
```

## Task Commits

1. **Task 1: Timezone converter + marking-window predicate**
   - `3cddb42` test(05-02): add failing tests for timezone converter and marking window
   - `d1ebf92` feat(05-02): pure timezone converter and attendance marking-window predicate
2. **Task 2: Pure attendance component calculator**
   - `b6bc60d` test(05-02): add failing tests for attendance component calculator
   - `0941564` feat(05-02): pure attendance component calculator
3. **Task 3: Async cohort scope resolvers**
   - `c45d9a3` test(05-02): add failing tests for async cohort scope resolvers
   - `122a6d7` feat(05-02): async cohort scope resolvers

## Files Created/Modified

- `src/lib/timezone.ts` - Pure wall-clock ↔ UTC conversion + IANA validation (D-23)
- `src/lib/attendance-window.ts` - Pure 168h marking-window predicates, UTC-only (D-06)
- `src/server/services/attendance-component.ts` - Pure earned/required attendance component, discriminated third states (D-20)
- `src/server/services/cohort-scope.ts` - Async DB-derived cohort/session/enrolment ResourceScope resolvers (D-21)
- `tests/timezone.test.ts`, `tests/attendance-window.test.ts`, `tests/attendance-component.test.ts`, `tests/cohort-scope.test.ts` - Exhaustive unit coverage

## Decisions Made

- `utcToWallParts` returns a `label` string in addition to the parts, so form/roster callers do not re-derive display formatting.
- `cohortResourceScope` always emits `courseIds` when the row exists (matches the 05-PATTERNS reference); an empty array and `undefined` are equivalent under `grantMatches`.
- Header prose in `attendance-window.ts` and `cohort-scope.ts` was worded to avoid the literal tokens `Intl` / `@/server/permissions` value-import so the plan's grep gates read cleanly; the `import type { ResourceScope }` line is the only permissions reference and is type-only.

## Deviations from Plan

None - plan executed exactly as written. All three tasks completed via TDD (RED test commit, GREEN feat commit), no REFACTOR commits needed.

## Issues Encountered

- Initial `attendance-window.ts` / `timezone.ts` headers contained the literal words "Intl" and "Temporal", which tripped the plan's `grep -c` gates (expected 0). Reworded the doc comments; gates now pass. No code change.

## Verification

- `npx vitest run tests/timezone.test.ts tests/attendance-window.test.ts tests/attendance-component.test.ts tests/cohort-scope.test.ts` — 44 tests green
- `npx vitest run tests/boundary.test.ts tests/structure.test.ts` — green (worker closure unaffected)
- `npx tsc --noEmit` — exit 0
- `npm run lint` — clean
- Full node suite (excl. integration): 703 tests / 54 files green; `tests/schema-cohort.test.ts` green against Testcontainers Postgres

## Next Phase Readiness

- All four building blocks are ready for Wave 2/3 composition. `cohortResourceScope` drops straight into `createResourceService({ toScope })`; `sessionCohortScope` / `enrolmentCohortScope` are the two-hop resolvers for `session-service` / `attendance-service` / `enrolment-service`.
- `computeAttendanceComponent` is ready for the roster (05-10) and the "attendance changed" DomainEvent payload (05-08).
- `wallTimeToUtc` is ready for the session create/edit action (05-06); the DST caveat is a documented non-issue for the `Africa/Lagos` default.

## Self-Check: PASSED

- FOUND: src/lib/timezone.ts
- FOUND: src/lib/attendance-window.ts
- FOUND: src/server/services/attendance-component.ts
- FOUND: src/server/services/cohort-scope.ts
- FOUND: tests/timezone.test.ts, tests/attendance-window.test.ts, tests/attendance-component.test.ts, tests/cohort-scope.test.ts
- FOUND commits: 3cddb42, d1ebf92, b6bc60d, 0941564, c45d9a3, 122a6d7

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
