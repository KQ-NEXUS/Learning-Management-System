---
phase: 09-learning-delivery-progress-tracking
plan: 09
subsystem: ui
tags: [nextjs, react, server-components, learner-delivery, lrn-02]

# Dependency graph
requires:
  - phase: 09-learning-delivery-progress-tracking
    provides: "09-03's loadLearnerPath decorated LearnerPath (lock state, blockingLessonTitle, completion), 09-08's ProgressMeter/DeferredSlot/(learner) shell layout"
provides:
  - "/learn/[enrolmentId] — the LRN-02 ordered module/lesson list with server-enforced lock state"
  - "LessonRow — the reusable four-state lesson row component"
  - "AccessDeniedPanel — the D-07 absolute access-gate panel, structurally unable to receive catalogue content"
  - "getOwnPendingEnrolmentOrderHref — the narrow DD-22 PENDING_PAYMENT exception to denial parity"
affects: [09-10, 09-11, 09-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Locked-row lesson state is read verbatim from the decorated LearnerPath, never recomputed in the page/component layer (DD-21)"
    - "A denial panel that structurally cannot accept the data it must never leak (AccessDeniedPanelProps carries no catalogue fields at all)"

key-files:
  created:
    - src/components/learner/LessonRow.tsx
    - src/components/learner/AccessDeniedPanel.tsx
    - "src/app/(learner)/learn/[enrolmentId]/page.tsx"
    - tests/learner-lesson-list-page.test.ts
  modified:
    - src/server/services/learner-access.ts

key-decisions:
  - "getOwnPendingEnrolmentOrderHref added to learner-access.ts (DD-22) rather than a new service file — keeps the one PENDING_PAYMENT exception co-located with the ownership checks it must preserve denial parity against"
  - "EnrolmentStoreRow.orderId and LearnerAccessStore.order made optional so the existing learner-access.test.ts fixtures keep compiling unchanged"
  - "Lesson-list h1 uses the single course's title for a standalone course-cohort, falling back to the cohort/offer title for a multi-course programme cohort"

patterns-established:
  - "Server Components with no props re-derive their own denial state from a service null return plus one narrow, separately-scoped exception query — never a second permission-like check"

requirements-completed: [LRN-02]

# Metrics
duration: ~35min
completed: 2026-09-15
---

# Phase 9 Plan 9: Lesson-list page with server-enforced lock state Summary

**`/learn/[enrolmentId]` renders `loadLearnerPath`'s decorated module/lesson tree verbatim — a four-state `LessonRow`, a D-06 blocking-title explanation on every locked row, and an `AccessDeniedPanel` that cannot structurally receive catalogue data for the D-07 gate.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `LessonRow` renders exactly four mutually exclusive states (completed / locked / current / not-started) in the plan's precedence order, with a non-interactive `aria-disabled` locked row naming its blocking lesson by title in wrapping text
- `AccessDeniedPanel` accepts no course/module/lesson data as props at all — the D-07 gate cannot leak catalogue detail regardless of future edits to this file
- `/learn/[enrolmentId]` reads `locked`/`blockingLessonTitle`/`completed` straight from `loadLearnerPath` with zero re-derivation (no `evaluateLessonSequencing` import), and distinguishes the one actionable PENDING_PAYMENT denial case from every other denial cause per DD-22
- 8 passing tests covering ordering, lock state, href presence/absence, the denied panel's zero-leak guarantee, `notFound()` for a stranger's enrolment id, and a zero-lesson module

## Task Commits

Each task was committed atomically:

1. **Task 1: LessonRow — the four-state row** - `d5bced2` (feat)
2. **Task 2: AccessDeniedPanel for the PENDING_PAYMENT case** - `7177501` (feat)
3. **Task 3: The lesson-list page** - `15f052f` (feat)

_Plan metadata commit follows this summary._

## Files Created/Modified
- `src/components/learner/LessonRow.tsx` - Four-state Server Component lesson row (completed/locked/current/not-started)
- `src/components/learner/AccessDeniedPanel.tsx` - D-07 denial panel that structurally cannot accept catalogue props
- `src/app/(learner)/learn/[enrolmentId]/page.tsx` - The LRN-02 lesson-list page
- `tests/learner-lesson-list-page.test.ts` - 8-case render test for the lesson-list page
- `src/server/services/learner-access.ts` - Added `getOwnPendingEnrolmentOrderHref` (DD-22) plus the optional `EnrolmentStoreRow.orderId` / `LearnerAccessStore.order` fields it needs

## Decisions Made
- `getOwnPendingEnrolmentOrderHref` returns an `/orders/{reference}` href (the existing owned-receipt route) rather than a `/checkout/{orderId}` href, since the receipt page is the stable, ownership-scoped surface that already resolves a PENDING order's state
- New `EnrolmentStoreRow.orderId` and `LearnerAccessStore.order` fields are optional (not required) specifically so `tests/learner-access.test.ts`'s existing fixtures needed no changes — a narrower blast radius than widening every fixture in that file
- The lesson-list `<h1>` shows the single course's own title for a standalone course-cohort, and falls back to the cohort/offer title only when a programme cohort has more than one member course

## Deviations from Plan

None - plan executed exactly as written. `getOwnPendingEnrolmentOrderHref`'s exact name and signature, `AccessDeniedPanel`'s no-catalogue-props contract, and `LessonRow`'s four-state precedence all match the plan's Task 1-3 text verbatim.

## Issues Encountered

- `npx next build` could not be run to completion in this worktree: Turbopack reported `Could not find the Next.js package (next/package.json)` because this worktree's `node_modules` is effectively empty — the same pre-existing sandbox gap already documented in `09-08-SUMMARY.md` and `STATE.md` for other plans in this phase. `npx tsc --noEmit`, `npx eslint`, and `npx vitest` all resolve dependencies from an ancestor `node_modules` and ran cleanly (zero new errors beyond the pre-existing, unrelated `stripe`-module-missing and `LayoutProps` errors already present before this plan's changes); only Turbopack's stricter workspace-root detection is affected. Not fixable via Rule 3 (package-manager installs are explicitly excluded from auto-fix) and not caused by this plan's changes. Deferred to whichever environment has a fully installed `node_modules` for this worktree.

## Known Stubs

None. Every branch (structure, unpinned, denied, not-found) renders real derived data or the plan's own named-gap panel — no hardcoded empty value flows to the UI.

## Threat Flags

None. All new surface (`/learn/[enrolmentId]`, `AccessDeniedPanel`, `getOwnPendingEnrolmentOrderHref`) is already covered by this plan's own `<threat_model>` (T-09-01, T-09-33, T-09-13, T-09-34).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `/learn/[enrolmentId]/lessons/[lessonId]` (09-11) can now link back to this page and reuse `getOwnPendingEnrolmentOrderHref`'s DD-22 pattern for its own denial handling
- `/learn/[enrolmentId]/sessions` (09-10, running concurrently in a sibling worktree) does not overlap any file this plan touched
- `npx next build`'s full production-build gate remains unverified in this sandbox (see Issues Encountered) — needs confirming in an environment with a complete `node_modules` before this plan can be considered fully UAT-closed, same outstanding item as 09-08

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-15*

## Self-Check: PASSED

All 5 created/modified files confirmed present on disk (`src/components/learner/LessonRow.tsx`,
`src/components/learner/AccessDeniedPanel.tsx`, `src/app/(learner)/learn/[enrolmentId]/page.tsx`,
`tests/learner-lesson-list-page.test.ts`, `src/server/services/learner-access.ts`). All 3 task
commits (`d5bced2`, `7177501`, `15f052f`) confirmed present in `git log`.
