---
phase: 10-assessment-quizzes-assignments-grading
plan: 15
subsystem: ui
tags: [nextjs, react, server-components, learner-dashboard, assessment, grading]

# Dependency graph
requires:
  - phase: 10-assessment-quizzes-assignments-grading
    provides: "learner-results-service.ts's getOwnResults/getOwnAssessmentObligations (plan 10-09)"
provides:
  - "/learn/[enrolmentId]/results route (ASM-07) with the ResultsList component"
  - "enrolment-dashboard-service.ts's assessmentObligations/results widened from DeferredColumn to a tracked union (AssessmentObligationsColumn/ResultsColumn)"
  - "Dashboard Assessments/Results cards rendering deferred/tracked-empty/tracked-populated states"
affects: [11-certificates, 12-support-tickets]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DD-32-precedent column widening: DeferredColumn | { kind: 'tracked'; ... } for exactly the two Phase-10-owned dashboard columns, deferred inhabitant kept reachable for an unpinned cohort"
    - "Dependency-injected learner-results reads (EnrolmentDashboardLearnerResults) so enrolment-dashboard-service.ts stays unit-testable with in-memory fakes, no Prisma"

key-files:
  created:
    - "src/app/(learner)/learn/[enrolmentId]/results/page.tsx"
    - "src/components/learner/ResultsList.tsx"
    - "tests/learner-results-page.test.ts"
  modified:
    - "src/server/services/enrolment-dashboard-service.ts"
    - "src/server/services/roster-service.ts"
    - "src/app/(learner)/dashboard/page.tsx"
    - "tests/enrolment-dashboard-service.test.ts"

key-decisions:
  - "assessmentObligations/results become tracked only once a course structure is pinned (path resolved); an unpinned cohort still gets the deferred inhabitant, mirroring Progress's own DD-32 unpinned branch rather than a fake empty tracked list"
  - "Dashboard 'Results' slot ranks by each card's own most-recent history entry timestamp (LearnerResultCard carries no top-level releasedAt) and caps at 3"
  - "Unmet-pass copy (ASM-07 §6.1) renders only for QUIZ results, since attemptsRemaining is null-by-construction for ASSIGNMENT results (no attempt-limit concept there)"

patterns-established:
  - "learner-results-service.ts reads injected into enrolment-dashboard-service.ts as deps.learnerResults, matching the existing deps.learnerAccess convention"

requirements-completed: [ASM-07]

duration: ~90min
completed: 2026-09-15
---

# Phase 10 Plan 15: Learner Results Page & Dashboard Named-Gap Widening Summary

**New `/learn/[enrolmentId]/results` route and `ResultsList` component for ASM-07, plus `enrolment-dashboard-service.ts`'s `assessmentObligations`/`results` columns widened from Phase 9's deferred placeholder to real tracked data via a DD-32-style second union inhabitant.**

## Performance

- **Duration:** ~90 min
- **Completed:** 2026-09-15
- **Tasks:** 3
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments
- Learners can now see every released quiz/assignment result in one place, with score/pass state, expandable attempt/submission history, grade overrides, and unmet-pass-requirement copy — DRAFT grades have no representation anywhere in the new surface
- Phase 9's two learner-dashboard named gaps (`assessmentObligations`, `results`) are filled with real data while keeping the deferred inhabitant expressible (DD-32 precedent), and Phase 11/12's own named gaps (`certificate`, `tickets`) are untouched
- Dashboard's "Assessments" and "Results" cards render all three states (deferred / tracked-empty / tracked-populated), with "Results" linking to the new full results page

## Task Commits

Each task was committed atomically:

1. **Task 1: The learner results route and ResultsList component** - `9a58edc` (feat)
2. **Task 2: Widen the two Phase 9 dashboard named gaps to real data** - `886d15c` (feat)
3. **Task 3: Route and dashboard-service tests** - `0e978e6` (test)

**Plan metadata:** committed alongside this SUMMARY (see below)

## Files Created/Modified
- `src/app/(learner)/learn/[enrolmentId]/results/page.tsx` - New ASM-07 route; re-resolves the actor, reuses `loadLearnerPath` for the established ownership check, renders `getOwnResults` via `ResultsList` inside `LearnerShell`'s existing layout
- `src/components/learner/ResultsList.tsx` - Per-Assessment result cards: type icon, score/pass pill, feedback, expandable history (always a list, even at length 1), override rows, unmet-pass copy (QUIZ only); never sorts its input, never renders a DRAFT branch
- `src/server/services/enrolment-dashboard-service.ts` - `assessmentObligations`/`results` widened to `AssessmentObligationsColumn`/`ResultsColumn` unions; new `EnrolmentDashboardLearnerResults` injected dep wired to `learner-results-service.ts`'s `getOwnAssessmentObligations`/`getOwnResults`; tracked only once a course structure is pinned, deferred otherwise
- `src/server/services/roster-service.ts` - Doc-comment-only addition recording the plan-10-15 widening next to `DeferredColumn`'s existing DD-32 note; the type itself and roster's own `assessment`/`completion` columns are untouched
- `src/app/(learner)/dashboard/page.tsx` - `AssessmentsCard`/`ResultsCard` replace two of the four `DeferredSlot` grid entries, each branching on `kind` (deferred / tracked-empty / tracked-populated); "Results" card's "View all" links to the new route
- `tests/learner-results-page.test.ts` - New: sign-out redirect, ownership refusal via `notFound()`, empty state, course-order card rendering, no-trace-of-a-draft assertion on the full serialised markup, unmet-pass/used-all-attempts copy switch, override row
- `tests/enrolment-dashboard-service.test.ts` - Updated: replaced the old "all four deferred" assertion with tracked-populated/tracked-empty/deferred-when-unpinned cases for `assessmentObligations`/`results`, a recency-cap-at-3 case for `results`; pre-existing `tickets`/`certificate` deferred assertions kept passing unchanged

## Decisions Made
- Tracked-vs-deferred split for the two widened columns follows the pinned/unpinned branch already established for `progress` (DD-32), rather than inventing a new condition — an unpinned cohort has no computable obligation set for either column
- Dashboard "Results" recency ranking reads each card's `history[0].at` (the most recent attempt/submission) since `LearnerResultCard` carries no top-level `releasedAt`
- Unmet-pass copy restricted to `type === "QUIZ"` because `attemptsRemaining` is always `null` for `ASSIGNMENT` results in `learner-results-service.ts` (no attempt-limit concept for assignments)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- This worktree had no `node_modules` (unlike sibling wave-5 worktrees, which already had a junction). Created a `node_modules` junction pointing at the main repo's install via `ln -s` (resolved to a Windows junction/reparse point on this filesystem, not a deep copy — confirmed via `stat`) so `tsc`/`eslint`/`next build`/`vitest` could run. This is a local sandbox artifact, not a code change, and nothing was committed for it.
- A full-repo `npx vitest run` was executed for verification. 26 test files failed, none of them touching this plan's files (`learner-results-page.test.ts` and `enrolment-dashboard-service.test.ts` both pass, 53/53). All failures are pre-existing: real-Postgres integration tests that need Docker (documented as Docker-BLOCKED throughout STATE.md's Phase 6/7/9 notes), plus unrelated component-test failures (`readiness-panel.test.tsx`'s "Grading" heading count, `lesson-content.test.tsx`'s stale QUIZ-placeholder expectation, `order-confirmation`/`checkout-summary`/`cohort-cards` snapshot mismatches) in files this plan never touched. Not fixed — out of this plan's scope per the deviation rules' scope boundary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ASM-07 is complete: learners have a dedicated results surface and the dashboard's obligations/results slots show real data
- Phase 11 (certificates) and Phase 12 (support tickets) can widen their own dashboard columns (`certificate`, `tickets`) following the same DD-32/plan-10-15 precedent whenever they land — nothing here blocks that
- The pre-existing Docker-BLOCKED integration-test gap and the unrelated component-test failures noted above remain open for whichever plan owns them; not introduced or worsened by this plan

---
*Phase: 10-assessment-quizzes-assignments-grading*
*Completed: 2026-09-15*

## Self-Check: PASSED

- FOUND: src/app/(learner)/learn/[enrolmentId]/results/page.tsx
- FOUND: src/components/learner/ResultsList.tsx
- FOUND: tests/learner-results-page.test.ts
- FOUND: .planning/phases/10-assessment-quizzes-assignments-grading/10-15-SUMMARY.md
- FOUND: commit 9a58edc (Task 1)
- FOUND: commit 886d15c (Task 2)
- FOUND: commit 0e978e6 (Task 3)


## Integrated Wave 5 closeout (2026-09-16)

All four Wave 5 branches are integrated into Khaliddev. The final Turbopack production build and its TypeScript check passed after closeout fixes. Changed production files passed lint.

Verification: 157 focused server tests; 25 real PostgreSQL/MinIO integration cases; 41 assessment UI component cases plus 14 LessonContent cases. The broad unit run passed 119 files / 1,986 tests, with two checkout source-scan cases hitting the default 5-second timeout; the isolated checkout invariant rerun passed 10/10 at 30 seconds. No assertion failure remained in the affected suites. Full historical component/infrastructure limitations are retained in deferred-items.md.

The merged results route and dashboard widening passed the final production build and focused server regression. The two owned dashboard columns are populated with real data; certificate/ticket dependencies remain separate.

Only plan 10-17 remains: phase invariant gates, validation contract and human walkthrough.
