---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 03
subsystem: api
tags: [readiness, publish-gate, cohort, react, vitest, tdd]

# Dependency graph
requires:
  - phase: 04-catalogue-authoring
    provides: "readiness-service.ts pure four-state evaluator + blockingFailures; ReadinessPanel shared render + CATEGORY_ORDER; NOT_YET_CHECKED third-state treatment"
  - phase: 05-01
    provides: "Cohort operations schema delta (coursePublicationId / programmePublicationId pins, attendanceThresholdPct, capacity, priceMinor)"
provides:
  - "src/server/services/readiness-service.ts — evaluateCohortReadiness(cohort: ReadinessCohortInput): ReadinessItem[] (pure, zero imports)"
  - "ReadinessCohortInput structural input type — plan 05-05 builds it from the cohort aggregate"
  - "'Catalogue' ReadinessCategory + CATEGORY_ORDER entry in the shared ReadinessPanel"
  - "evaluateCourseReadiness no longer emits schedule/price/capacity/instructors (moved to the cohort evaluator)"
affects: [05-05, 05-15, cohort-service, cohort publish action, cohort detail page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One pure readiness evaluator per aggregate kind (Course / Programme / Cohort), all feeding the same ReadinessItem[] and the same panel + blockingFailures gate"
    - "Cohort readiness slots are all real checks — no NOT_YET_CHECKED, no deferredTo — with a concrete `detail` string the publish-blocked UI copy quotes verbatim"

key-files:
  created:
    - "tests/cohort-readiness.test.ts"
  modified:
    - "src/server/services/readiness-service.ts"
    - "src/components/catalogue/ReadinessPanel.tsx"
    - "tests/readiness.test.ts"
    - "tests/components/readiness-panel.test.tsx"

key-decisions:
  - "schedule-dates and attendance-threshold-self-paced are always emitted (PASS when no issue, WARN when triggered) rather than conditionally pushed — matches the success-criteria list of eight ids each with a detail"
  - "Catalogue is the FIRST entry in CATEGORY_ORDER (before Content) per plan Task 2 wording; the Course/Programme panels render it as an empty heading, consistent with the pre-existing empty-heading behaviour for Schedule/Price/Capacity/Instructors"
  - "The `deferredTo` union is left as `\"Phase 5\" | \"Phase 10\"` — narrowing would break the existing `deferredTo: \"Phase 5\"` fixtures in readiness-panel.test.tsx and the roster columns in plan 05-14 (D-18) need flexible phase tags"

patterns-established:
  - "Pure-module grep gates hold: zero `^import` in readiness-service.ts, zero `deferredTo: \"Phase 5\"`, exactly one `deferredTo: \"Phase 10\"`"
  - "TDD RED (test commit) -> GREEN (feat commit) for the evaluator task"

requirements-completed: [COH-04]

# Metrics
duration: 18min
completed: 2026-09-04
---

# Phase 5 Plan 03: Cohort Publication Readiness Evaluator Summary

**`evaluateCohortReadiness` — one pure function scoring a cohort across Catalogue / Schedule / Price / Capacity / Instructors / Completion, feeding the same `ReadinessPanel` and `blockingFailures` gate Phase 4 built, with the misplaced per-Course stubs retired.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-09-04T10:46Z
- **Completed:** 2026-09-04T10:53Z
- **Tasks:** 2
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- `evaluateCohortReadiness(cohort: ReadinessCohortInput)` emits eight items with exact ids — `catalogue`, `schedule`, `schedule-dates`, `price`, `capacity`, `instructors`, `completion`, `attendance-threshold-self-paced` — each with a concrete `detail` string.
- Blocking + FAIL-capable: Catalogue (D-29), Schedule, Capacity, Instructors. Price is `blocking: true` but effectively always PASS. Completion and the two `schedule-dates` / `attendance-threshold-self-paced` WARN items are advisory.
- No cohort slot is ever `NOT_YET_CHECKED` — D-28 turns every reserved slot into a real check (mitigates T-05-13).
- Retired the four `deferredTo: "Phase 5"` stubs from `evaluateCourseReadiness`; `assessments` (`deferredTo: "Phase 10"`) left untouched. Comment cites RESEARCH Open Question 1 (RESOLVED).
- Added `"Catalogue"` to the shared `ReadinessCategory` union and to `CATEGORY_ORDER` as the leading entry.
- `tests/readiness.test.ts` locked expectation deliberately and traceably updated: schedule/price/capacity/instructors are now asserted ABSENT from the Course evaluator.
- 40 new cohort-readiness tests + 3 new/updated panel tests; Phase-4 publish suites (publish-service, publish.integration, public-catalogue-service — 42 tests) stay green.

## ReadinessCohortInput shape (verbatim — plan 05-05 builds this from the cohort aggregate)

```typescript
export type ReadinessCohortInput = {
  deliveryMode: string;
  startsAt: Date | string;
  endsAt: Date | string;
  capacity: number;
  seatsTaken: number;
  priceMinor: number;
  currency: string | null;
  attendanceThresholdPct: number | null;
  instructorCount: number;
  nonCancelledSessionCount: number;
  sessions: Array<{ startsAt: Date | string; endsAt: Date | string; cancelledAt: Date | string | null }>;
  pin: {
    kind: "course" | "programme";
    publicationId: string | null;
    targetStatus: string | null;
    completionRule: unknown;
  } | null;
};
```

## Rule reference (as implemented)

| id | category | blocking | PASS when | FAIL / WARN when |
|----|----------|----------|-----------|------------------|
| `catalogue` | Catalogue | true | `pin != null && pin.publicationId != null && pin.targetStatus === "PUBLISHED"` | FAIL when pin null, no publicationId, or targetStatus != PUBLISHED |
| `schedule` | Schedule | true | `deliveryMode === "SELF_PACED"` or `nonCancelledSessionCount > 0` | FAIL otherwise |
| `schedule-dates` | Schedule | false | no non-cancelled session starts before `startsAt` / ends after `endsAt` | WARN when any does (cancelled sessions ignored) |
| `price` | Price | true | `currency` non-empty and `priceMinor >= 0` (0 is a legal free cohort) | FAIL when currency missing or priceMinor negative |
| `capacity` | Capacity | true | `capacity > 0 && capacity >= seatsTaken` | FAIL when `capacity < 1` or `capacity < seatsTaken` |
| `instructors` | Instructors | true | `deliveryMode === "SELF_PACED"` or `instructorCount > 0` | FAIL for INSTRUCTOR_LED / BLENDED with none |
| `completion` | Completion | false | pinned publication carries a non-null `completionRule` | WARN otherwise (incl. no pin) |
| `attendance-threshold-self-paced` | Completion | false | not (`attendanceThresholdPct != null && deliveryMode === "SELF_PACED"`) | WARN when a threshold is set on a self-paced cohort |

## Task Commits

1. **Task 1 (RED): failing cohort-readiness tests** — `3ae2046` (test)
2. **Task 1 (GREEN): evaluateCohortReadiness + Catalogue category + stub removal** — `3d15cd4` (feat)
3. **Task 2: Catalogue in the shared panel + locked Course test update** — `2fede2b` (feat)

_No REFACTOR commit — GREEN implementation needed no cleanup._

_Plan metadata (SUMMARY / STATE / ROADMAP) is disk-only this phase (.planning/ is gitignored) — not committed._

## Files Created/Modified
- `src/server/services/readiness-service.ts` — added `ReadinessCohortInput`, `evaluateCohortReadiness`, `"Catalogue"` category; removed 4 Phase-5 stubs from `evaluateCourseReadiness`.
- `src/components/catalogue/ReadinessPanel.tsx` — `CATEGORY_ORDER` now leads with `"Catalogue"`.
- `tests/cohort-readiness.test.ts` — 40 tests: PASS/FAIL/WARN per slot + `blockingFailures` for the ready case and every blocking FAIL.
- `tests/readiness.test.ts` — locked stub assertion replaced with an ABSENT assertion (+ traceability comment).
- `tests/components/readiness-panel.test.tsx` — Catalogue-before-Schedule ordering; NOT_YET_CHECKED renders `•`, never `✓`/`✗`; fixed-order + all-deferred heading counts bumped to 7.

## Decisions Made
- `schedule-dates` / `attendance-threshold-self-paced` always emitted (PASS or WARN) — aligns with the success-criteria eight-id list and keeps the panel stable.
- `"Catalogue"` placed first in `CATEGORY_ORDER` per the plan's explicit "FIRST entry" wording. Trade-off: the Course/Programme readiness panels now show an empty "Catalogue" heading, exactly as they already show empty Schedule/Price/Capacity/Instructors headings. Plan said "change nothing else" about `CATEGORY_ORDER`.
- `deferredTo` union kept as `"Phase 5" | "Phase 10"` — `"Phase 5"` still has consumers in `readiness-panel.test.tsx` fixtures, and D-18 roster columns (plan 05-14) will need the union widened, not narrowed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated two existing panel-test assertions for the new category count**
- **Found during:** Task 2
- **Issue:** Adding `"Catalogue"` to `CATEGORY_ORDER` broke `tests/components/readiness-panel.test.tsx` — the "fixed order" test asserted a 6-item array and the "all NOT_YET_CHECKED" test asserted `toHaveLength(6)`.
- **Fix:** Added `"Catalogue"` to the expected order array; bumped the heading count to 7. These are the mechanical consequence of the planned `CATEGORY_ORDER` change, in the same file Task 2 already edits.
- **Files modified:** tests/components/readiness-panel.test.tsx
- **Verification:** `npx vitest run tests/components/readiness-panel.test.tsx` — 9 passed.
- **Committed in:** `2fede2b` (Task 2 commit)

**2. [Rule 3 - Blocking] Reworded a source comment to satisfy the pure-module grep gate**
- **Found during:** Task 1
- **Issue:** The comment recording where the stubs moved contained the literal string `deferredTo: "Phase 5"`, tripping the acceptance gate `grep -c 'deferredTo: "Phase 5"' … returns 0`.
- **Fix:** Reworded to "NOT_YET_CHECKED stubs reserved for Phase 5" — same meaning, no gate trip.
- **Files modified:** src/server/services/readiness-service.ts
- **Verification:** `grep -c 'deferredTo: "Phase 5"'` returns 0; `grep -c 'deferredTo: "Phase 10"'` returns 1.
- **Committed in:** `3d15cd4` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both are mechanical consequences of planned edits within files the plan already touches. No scope creep, no behaviour change beyond the plan.

## Issues Encountered
None.

## Verification Run

- `npx vitest run tests/cohort-readiness.test.ts tests/readiness.test.ts tests/components/readiness-panel.test.tsx` — 75 passed.
- `npx vitest run tests/publish-service.test.ts tests/publish.integration.test.ts tests/public-catalogue-service.test.ts` — 42 passed (Phase-4 publish + public listing unaffected).
- `npx tsc --noEmit` — exit 0.
- `npx eslint` on all 5 changed files — exit 0.
- Grep gates: `^import` count 0; `deferredTo: "Phase 5"` count 0; `deferredTo: "Phase 10"` count 1; `"Catalogue"` present in both `readiness-service.ts` and `ReadinessPanel.tsx`.

## Known Stubs
None introduced. The four `deferredTo: "Phase 5"` Course stubs were *removed*; the `assessments` `deferredTo: "Phase 10"` stub is pre-existing and intentional (Phase 10 owns assessments).

## Threat Flags
None. The evaluator stays pure (zero imports); T-05-11 (catalogue), T-05-12 (oversell), T-05-13 (silent PASS), T-05-14 (rule duplication) are all mitigated as the threat register specified and asserted in `tests/cohort-readiness.test.ts`.

## Next Phase Readiness
- Plan 05-05 (`cohort-service`) can now build `ReadinessCohortInput` from the cohort aggregate and call `evaluateCohortReadiness`.
- Plan 05-15 (cohort publish action) calls `blockingFailures(evaluateCohortReadiness(...))` — never its own rules.
- The shared `ReadinessPanel` renders the Catalogue category; the cohort detail page (Overview tab) can pass server-evaluated `ReadinessItem[]` straight in.

## Self-Check: PASSED

- Files: all 5 present (1 created, 4 modified).
- Commits: `3ae2046`, `3d15cd4`, `2fede2b` all in `git log`.

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
