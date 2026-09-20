---
phase: 09-learning-delivery-progress-tracking
plan: 07
subsystem: api
tags: [prisma, vitest, dashboard, completion-engine]

requires:
  - phase: 09-learning-delivery-progress-tracking
    provides: listOwnActiveEnrolments/loadLearnerPath (09-03), evaluateCompletion (09-02), computeAccessWindow (09-01)
provides:
  - Ownership-scoped enrolment dashboard aggregate read (loadLearnerDashboard)
  - Four typed named gaps (assessmentObligations/results/tickets/certificate) pinned to phases 10/10/12/11
  - Pure deriveNextAction with a four-branch priority order (session/lesson/complete/none)
affects: [09-08 (learner dashboard page consumes this service), 10, 11, 12 (widen the named-gap DeferredColumn fields)]

tech-stack:
  added: []
  patterns:
    - "Typed named gaps (DeferredColumn) instead of fake zeroes for not-yet-built capabilities"
    - "Pure derivation functions (deriveNextAction) taking pre-loaded evidence, unit-testable without a store fake"

key-files:
  created:
    - src/server/services/enrolment-dashboard-service.ts
    - tests/enrolment-dashboard-service.test.ts
  modified:
    - src/server/services/roster-service.ts
    - src/app/staff/cohorts/[id]/RosterTab.tsx

key-decisions:
  - "DD-18: four forward slots are typed DeferredColumn fields pinned to phase 10/10/12/11, imported type-only to keep prisma/withPermission off this module's runtime closure"
  - "DD-19: this service selects its own narrow ScheduledSession fields and never selects meetingUrl at all — a stronger guarantee than gating it post-read"
  - "DD-5: deriveNextAction is a pure, total function taking already-loaded evidence so the four-branch priority order is inspectable and testable in one place"

patterns-established:
  - "Pattern: dashboard/aggregate services call the same evaluateCompletion with the same evidence shape as the write-side service, so displayed figures can never drift from recorded state"

requirements-completed: []

duration: ~90min
completed: 2026-09-14
---

# Phase 09 Plan 07: Enrolment Dashboard Aggregate Read Summary

**Ownership-scoped `loadLearnerDashboard` with typed named gaps and a pure four-branch next-action derivation (DD-5)**

## Performance

- **Duration:** ~90 min (interrupted mid-Task-2 by a session usage-limit error; orchestrator resumed and completed the remaining work directly in the same worktree)
- **Tasks:** 2/2 complete
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `loadLearnerDashboard(actor)` returns one card per own ACTIVE enrolment, never another learner's, with two independent progress components (required-lesson count, attendance) and an access-window notice
- Four typed `DeferredColumn` gaps (`assessmentObligations`→10, `results`→10, `tickets`→12, `certificate`→11) make an unbuilt capability structurally unrepresentable as a fake zero
- `deriveNextAction` — pure, total, four-branch priority (imminent session → open required lesson → satisfied verdict → none) — re-checks `assertLessonOpenable` per D-03 rather than assuming the next required lesson is open
- Upcoming-sessions card never selects `meetingUrl` at the query level (DD-19), not merely filters it post-read

## Task Commits

1. **Task 1: Dashboard aggregate shape with typed named gaps** - `2e51cf1` (feat)
2. **Task 2: Next-action derivation (DD-5)** - `e6654ce` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/server/services/enrolment-dashboard-service.ts` - `loadLearnerDashboard`, `LearnerDashboard`, `LearnerDashboardCard`, `NextAction`, `deriveNextAction`
- `tests/enrolment-dashboard-service.test.ts` - 39 cases covering ownership scoping, deferred-field pinning, progress/attendance, session filtering, and the full `deriveNextAction` priority matrix
- `src/server/services/roster-service.ts` - widened `DeferredColumn.phase` union to `9 | 10 | 11 | 12` (additive only)
- `src/app/staff/cohorts/[id]/RosterTab.tsx` - Rule 1 fix: added a phase-12 label to `DEFERRED_LABEL`, which became non-exhaustive after the widening

## Decisions Made
See `key-decisions` above (DD-18, DD-19, DD-5). No decisions beyond what the plan's `<planner_rulings>` already specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Type-safety] `RosterTab.tsx`'s `DEFERRED_LABEL` map became non-exhaustive**
- **Found during:** Task 1 (widening `DeferredColumn.phase` to include `12`)
- **Issue:** Widening the union in `roster-service.ts` left an existing consumer's exhaustive label map missing the new `12` case
- **Fix:** Added a phase-12 label to `DEFERRED_LABEL`
- **Files modified:** `src/app/staff/cohorts/[id]/RosterTab.tsx`
- **Verification:** `tsc --noEmit` exits 0
- **Committed in:** `2e51cf1` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 type-safety fix required by the plan's own additive widening instruction)
**Impact on plan:** Necessary consequence of Task 1's own instructed change. No scope creep.

## Issues Encountered
The executing agent hit the session's usage-limit mid-Task-2 (after committing Task 1 and drafting most of Task 2's implementation and tests, uncommitted). The orchestrator inspected the worktree, found the in-progress `deriveNextAction` implementation and its 15 new test cases already matched every behavior bullet and acceptance criterion in the plan, verified all checks independently (39/39 plan tests, 53/53 combined with `boundary.test.ts`, `tsc --noEmit` clean, `eslint` clean, all grep-based acceptance checks), and committed the work as Task 2 rather than re-doing it or leaving it stranded uncommitted in a worktree slated for removal.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `enrolment-dashboard-service.ts` is ready for 09-08's `/dashboard` page to consume directly
- `LRN-01` intentionally left "Pending" in `REQUIREMENTS.md` — this plan builds the service layer only; the requirement names a learner-visible dashboard, which 09-08 delivers. Marking it complete here would repeat the over-claim 09-01 had to revert for LRN-04/05.

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-14*
