---
phase: 09-learning-delivery-progress-tracking
plan: 13
subsystem: ui
tags: [staff-console, rbac, confirmmodal, server-actions, progress-tracking, prisma]

# Dependency graph
requires:
  - phase: 09-06 (lesson-progress-service)
    provides: overrideLessonProgress (D-14, mandatory-reason staff override), OverrideReasonRequiredError, LessonNotOpenableError
  - phase: 09-07 (enrolment-dashboard-service)
    provides: the enrolment-dashboard aggregate-read pattern this plan's roster widening mirrors
  - phase: 05 (cohorts-scheduling)
    provides: roster-service.ts's DeferredColumn named-gap convention and RosterTab.tsx's Progress column placeholder
provides:
  - The cohort roster's Progress column shows real "{completed} of {total}" counts for a pinned cohort
  - A staff-facing per-learner progress page (/staff/cohorts/{id}/learners/{enrolmentId}) with a mandatory-reason override affordance
  - overrideLessonProgressAction, the FormData-reading Server Action delegating authorization to the service layer
affects: [09-14, phase-10-assessment-grading, phase-11-certificates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Staff read-escalation on a learner's own data: establish RBAC scope via an EXISTING withPermission-gated read (loadCohortRoster), then call the ownership-scoped loadLearnerPath on the learner's behalf ({ userId: rosterRow.learnerId }) — the same technique overrideLessonProgress itself already uses internally"
    - "Server Component page tests: invoke the async page function directly and walk its returned React-element tree (no jsdom) — established precedent (arrange-page-route.test.ts, lesson-preview-route.test.ts), extended here with a DetailLayout-aware sections[].content walker"
    - "Client-island tests requiring hooks/DOM (ConfirmModal, useState, useRouter) live in tests/components/*.test.tsx (jsdom project), never in the node-project tests/*.test.ts files, per vitest.config.mts's project split"

key-files:
  created:
    - src/app/staff/cohorts/[id]/progress-actions.ts
    - src/app/staff/cohorts/[id]/learners/[enrolmentId]/page.tsx
    - src/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel.tsx
    - tests/staff-progress-override.test.ts
    - tests/components/staff-progress-override.test.tsx
  modified:
    - src/server/services/roster-service.ts
    - src/app/staff/cohorts/[id]/RosterTab.tsx
    - src/server/services/learner-access.ts
    - tests/roster-service.test.ts
    - tests/learner-access.test.ts
    - tests/lesson-progress-service.test.ts

key-decisions:
  - "RosterRow.progress widens to DeferredColumn | TrackedProgress (DD-32); PROGRESS_DEFERRED now documented as applying only to an unpinned cohort"
  - "Progress column's required-lesson set is resolved via learner-access.ts's loadLearnerCourseStructure, injected into roster-service.ts as resolvePinnedStructure — reused, not re-derived"
  - "overrideLessonProgressAction reads FormData (not a typed object), per this plan's explicit acceptance criteria, even though this directory's other actions (attendance-actions.ts, enrolment-actions.ts) use typed zod-validated arguments — src/app/staff/users/actions.ts's createStaffAccountAction is the FormData precedent actually followed"
  - "The per-learner page authorizes by calling the EXISTING loadCohortRoster (cohorts.view) and finding enrolmentId in the returned rows — this single call both proves RBAC scope and proves the enrolment belongs to this cohort (T-09-44), rather than two independent checks that could disagree"
  - "DecoratedLesson widened with completedAt (Rule 2 auto-fix) so the per-learner page can render each lesson's completion timestamp, which the plan's own content requirement needed but no existing field carried"

patterns-established:
  - "Pattern: courtesy-only can() gating of a destructive-affordance button, with the real enforcement inside the Server Action's withPermission wrapper — same T-04-53 precedent as every other staff denial-parity screen"

requirements-completed: [LRN-04, LRN-05]

# Metrics
duration: ~40min
completed: 2026-09-15
---

# Phase 9 Plan 13: Staff Progress Override Surface Summary

**Widened the cohort roster's Progress column to real "{completed} of {total}" counts and shipped D-14's staff override capability as a real screen — a per-learner progress page under `/staff/cohorts/{id}/learners/{enrolmentId}` with a mandatory-reason `ConfirmModal`, backed by a FormData-reading Server Action that delegates all authorization to the existing service layer.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-09-15T00:09:20Z (approx, first test run)
- **Completed:** 2026-09-15T00:38Z
- **Tasks:** 3 completed
- **Files modified:** 12 (3 created source, 2 created test, 4 modified source, 3 modified test)

## Accomplishments

- The Phase 5 "not tracked yet · Phase 9" roster placeholder is gone for pinned cohorts — the Progress column now shows a real, required-lessons-only count, with `0 of 0` correctly rendered as a legitimate tracked value (never a gap) for an offer with no required lessons.
- D-14's staff capability — previously service-layer-only from plan 09-06 — is now exercisable by a real staff member: a per-learner page lists every pinned lesson with its completion state, source (`MANUAL`/`AUTO_VIDEO`/`STAFF_OVERRIDE`), and timestamp, with a "Mark complete"/"Mark incomplete" affordance behind the existing `ConfirmModal`'s mandatory reason field.
- Every override is authorized, reason-bearing, and audited — the Server Action never re-implements the reason check or the RBAC gate; both live entirely inside `overrideLessonProgress`.

## Task Commits

1. **Task 1: Widen the roster's Progress column (D-18, DD-32)** - `3b92e81` (feat)
2. **Task 2: overrideLessonProgressAction** - `3a02f39` (feat)
3. **Task 3: Per-learner progress page with the ConfirmModal override panel** - `b0ff9b0` (feat)

_No plan-metadata commit yet — this plan runs in worktree/parallel-executor mode; the orchestrator makes the final metadata commit (STATE.md/ROADMAP.md excluded per worktree convention) after merge._

## Files Created/Modified

- `src/server/services/roster-service.ts` - `RosterRow.progress` widened to `DeferredColumn | TrackedProgress`; injectable `resolvePinnedStructure` dep computes required-lesson counts per enrolment from the cohort's pinned structure
- `src/app/staff/cohorts/[id]/RosterTab.tsx` - Progress column branches on `kind`, rendering `"{completed} of {total}"` for tracked rows; learner name now links to the new per-learner page
- `src/app/staff/cohorts/[id]/progress-actions.ts` - `overrideLessonProgressAction`, a FormData-reading `"use server"` action mapping `AuthorizationError`/`AuthenticationError` to `notFound()` and `OverrideReasonRequiredError`/`LessonNotOpenableError` to form errors
- `src/app/staff/cohorts/[id]/learners/[enrolmentId]/page.tsx` - the staff per-learner progress page: authorizes via `loadCohortRoster`, proves cross-cohort safety by roster membership, loads the learner's decorated path on their behalf
- `src/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel.tsx` - the `"use client"` island owning `ConfirmModal` (rendered verbatim) and the per-lesson override affordance
- `src/server/services/learner-access.ts` - `DecoratedLesson` widened with `completedAt: Date | null` (Rule 2 auto-fix)
- `tests/roster-service.test.ts` - 5 new cases for the tracked/deferred progress split, including the `0 of 0` and assessment/completion-untouched cases
- `tests/staff-progress-override.test.ts` - 17 cases covering the Server Action (9) and the page's data flow / `notFound()` gates (8)
- `tests/components/staff-progress-override.test.tsx` - 8 new jsdom render cases for `ProgressOverridePanel` (source labels, affordance-label flip, reason-field enforcement, FormData submission shape)
- `tests/learner-access.test.ts` - 2 new cases proving `completedAt` flows through `loadLearnerPath`
- `tests/lesson-progress-service.test.ts` - fixture updated for the widened `DecoratedLesson` type

## Decisions Made

- See `key-decisions` in frontmatter above.
- `MIN_REASON_LENGTH = 10` used in `ProgressOverridePanel`'s `ConfirmModal` as a UX courtesy (matching `EnrolmentActionModals`' own convention in this directory), even though the service only requires a non-empty trimmed reason — the courtesy minimum never becomes the enforcement; a whitespace-padded 10-char reason would still pass the client gate and be re-validated by the service's own trim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `completedAt` to `DecoratedLesson`**
- **Found during:** Task 3 (per-learner page)
- **Issue:** The plan's own content requirement ("each lesson's completion state, source... and completion timestamp") had no existing field to read a per-lesson completion timestamp from — `DecoratedLesson` carried `completed`/`completedSource` but not `completedAt`, even though the underlying `LessonProgress` row always has it.
- **Fix:** Added `completedAt: Date | null` to `DecoratedLesson`, sourced from the existing `progressRow?.completedAt` already read inside `loadLearnerPath`'s decoration step — purely additive, no behavior change to sequencing/locking.
- **Files modified:** `src/server/services/learner-access.ts`, `tests/learner-access.test.ts` (2 new cases), `tests/lesson-progress-service.test.ts` (fixture update for the now-required field)
- **Verification:** `npx vitest run tests/learner-access.test.ts tests/lesson-progress-service.test.ts` (75 cases, all green); `npx tsc --noEmit` clean
- **Committed in:** `b0ff9b0` (Task 3 commit)

**2. [Rule 3 - Blocking] Split Task 3's render-based test assertions into a second file**
- **Found during:** Task 3 (test-writing)
- **Issue:** The plan names `tests/staff-progress-override.test.ts` for all of Task 3's coverage, including assertions that require actually rendering `ProgressOverridePanel` (a `"use client"` component calling `useState`/`useRouter`). This codebase's `vitest.config.mts` splits tests into two Vitest projects: `"node"` (`tests/**/*.test.ts`, no jsdom, no React plugin — where JSX syntax cannot even be parsed in a `.ts` file) and `"components"` (`tests/components/**/*.test.tsx`, jsdom + React plugin). Hooks cannot execute outside an actual render, which requires jsdom; a `.ts` file cannot contain JSX at all under this project's esbuild loader configuration.
- **Fix:** Kept `tests/staff-progress-override.test.ts` (node project) for the Server Action tests (Task 2) and the page's data-flow/`notFound()` gate tests (Task 3) — both provable by invoking the async functions directly and inspecting plain returned values/thrown errors/element-prop trees, with zero JSX and zero hook execution required. Added `tests/components/staff-progress-override.test.tsx` (components project) for the true DOM-rendering assertions (source labels, the override-affordance label flip, the mandatory reason field, FormData submission shape) — mirroring the exact precedent `tests/components/attendance-mark.test.tsx` and `tests/components/cohort-roster.test.tsx` already establish for every other client island with a `ConfirmModal`.
- **Files modified:** `tests/staff-progress-override.test.ts`, new file `tests/components/staff-progress-override.test.tsx`
- **Verification:** `npx vitest run tests/staff-progress-override.test.ts tests/components/staff-progress-override.test.tsx` — 17 + 8 = 25 cases, all green (comfortably over the plan's combined "at least 6" + "at least 11" thresholds)
- **Committed in:** `b0ff9b0` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 missing-critical, 1 blocking/test-infra)
**Impact on plan:** Both auto-fixes were necessary to deliver exactly what the plan's own behavior/acceptance text asked for (a real completion timestamp, and genuinely-passing render assertions) within this codebase's existing conventions. No scope creep — no new capability was added beyond what the plan specified.

## Issues Encountered

- `npx next build` cannot run in this sandbox at all (Turbopack: "Could not find the Next.js package") — this worktree's `node_modules` has no physical `next` package on disk, an environment/install gap of the same kind as 09-01's missing `stripe` package, not a defect in this plan's code. `npx tsc --noEmit` and `npx eslint` both pass cleanly against every file this plan touched. Logged in `deferred-items.md` under `09-13`; the acceptance criterion that depends on it (`npx next build completes without error`) could not be verified in this session.
- A handful of pre-existing, unrelated test failures were found while running the plan's `<verification>` block (an `Intl.NumberFormat` currency-symbol ICU mismatch across 4 Phase 6/7 component test files, plus 18 pre-existing failing files in a full-suite sanity run — mostly the missing `stripe` package and real-Postgres integration tests needing `DATABASE_URL`). None reference any file this plan touched; all logged in `deferred-items.md` under `09-13` rather than fixed (out of scope).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-14 and the roster's D-18 Progress-column gap are both fully closed for Phase 9 — nothing here blocks 09-14 or later phases.
- `npx next build` should be re-verified once this worktree (or its merge target) has a real `node_modules/next` on disk — flagged as outstanding human/CI verification, not a code concern.
- Phase 10 (Assessment) can widen the roster's `assessment` column the same way this plan widened `progress`, following the identical `DeferredColumn | <TrackedShape>` pattern now established twice (`attendance`, `progress`).

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-15*

## Self-Check: PASSED

All 11 files claimed above (6 source, 5 test, plus this SUMMARY) confirmed present on disk. All 3 task commit hashes (`3b92e81`, `3a02f39`, `b0ff9b0`) confirmed present in `git log --all`.
