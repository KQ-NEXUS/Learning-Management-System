---
phase: 09-learning-delivery-progress-tracking
plan: 06
subsystem: api
tags: [prisma, progress-tracking, completion-engine, rbac, audit]

requires:
  - phase: 09-learning-delivery-progress-tracking
    provides: "loadLearnerPath/assertLessonOpenable (09-03), evaluateLessonSequencing (09-02), recalculateCompletion (09-04)"
provides:
  - "markLessonComplete / undoLessonComplete — ownership-scoped, idempotent, audited lesson mark/undo"
  - "recordWatchProgress — server-computed video watch percent with 90% auto-completion"
  - "overrideLessonProgress — mandatory-reason staff override (enrolments.manage RBAC)"
  - "countLessonsRelockedBy — pure D-16 relock-count helper for UI disclosure copy"
affects: [09-11-server-actions, 09-12-client-video-island, 09-ui-learner-dashboard]

tech-stack:
  added: []
  patterns:
    - "Ownership-scoped exports left unwrapped by withPermission; the sole RBAC-wrapped export (overrideLessonProgress) resolves the true enrolment owner's userId first, then calls the ownership-scoped loadLearnerPath on the learner's behalf"
    - "LessonProgressTxClient kept narrower than CompletionServiceTxClient; recalculateCompletion's tx param is satisfied via an explicit `as unknown as` cast at the call site (attendance-service.ts precedent), not by widening this file's own tx type"
    - "Video watch high-water marks (secondsWatched/percentWatched) only ever move forward; re-completion after a self-undo requires the percent to advance strictly beyond the stored mark, not merely re-reach it"

key-files:
  created:
    - src/server/services/lesson-progress-service.ts
    - tests/lesson-progress-service.test.ts
  modified: []

key-decisions:
  - "overrideLessonProgress resolves the enrolment's true owner via a minimal injected store read, then calls loadLearnerPath with a synthetic Actor for that owner — the plan's consumed interfaces list only loadLearnerPath (learner-scoped), so this was the narrowest way to reuse it for a staff caller without adding a new learner-access.ts export"
  - "Both markLessonComplete and undoLessonComplete always invoke recalculateCompletion, even on a no-op repeat call — cheap and idempotent, and reads literally as the plan's behavior text describes it (unconditioned on whether a row was actually created/deleted), while the lesson.completed event and STAFF_OVERRIDE stamps remain conditioned appropriately"

patterns-established:
  - "Pattern: staff-override services needing an ownership-scoped reader built for learners re-derive the true owner id via a narrow store dependency rather than duplicating or relaxing the ownership-scoped reader's contract"

requirements-completed: [LRN-04, LRN-05]

duration: ~70min
completed: 2026-09-14
---

# Phase 9 Plan 06: Lesson Progress Write Side Summary

**Idempotent, ownership-gated LessonProgress mark/undo, server-computed 90%-threshold video auto-completion with undo-respecting high-water marks, and a mandatory-reason staff override — all recalculating completion in the same transaction.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3 (all implemented and verified together in one cohesive pass — see Deviations)
- **Files modified:** 2 (both newly created)

## Accomplishments

- `markLessonComplete` / `undoLessonComplete`: gated by `assertLessonOpenable` (not-found / locked / access-window-closed), manual completion additionally gated on `lesson.allowManualComplete` (DD-16); undo alone tolerates a `locked` current state (D-16 cascade scenario) and performs no cascade write — downstream re-lock is lazy on next read (DD-4)
- `recordWatchProgress`: clamps and validates `secondsWatched`/`durationSeconds` server-side, computes `percentWatched` from the stored row (never the client), stores forward-only high-water marks, and auto-completes at `VIDEO_COMPLETION_PCT` (90) exactly once per lesson — a post-undo re-tick at the same percent does not silently re-complete (T-09-28)
- `overrideLessonProgress`: the file's one `withPermission`-wrapped export (`enrolments.manage` + `enrolmentCohortScope`), mandatory non-empty reason enforced before any write, ungated on manual-complete/lock/access-window per D-14
- `countLessonsRelockedBy`: pure double-evaluation diff over `evaluateLessonSequencing`, no write, backs the UI's re-lock disclosure copy
- 44 unit tests (in-memory fakes, no Postgres) covering every `<behavior>` bullet across all three tasks

## Task Commits

All three tasks were implemented in a single cohesive commit (see Deviations for rationale):

1. **Tasks 1–3: lesson-progress-service.ts + tests** - `41065d7` (feat)

**Plan metadata:** (this commit, added after SUMMARY)

## Files Created/Modified

- `src/server/services/lesson-progress-service.ts` - `markLessonComplete`, `undoLessonComplete`, `recordWatchProgress`, `overrideLessonProgress`, `countLessonsRelockedBy`, `VIDEO_COMPLETION_PCT`, and five typed refusal error classes
- `tests/lesson-progress-service.test.ts` - 44 cases across mark/undo, watch-progress/auto-completion, and staff override, plus a DD-15 cross-cutting check

## Decisions Made

- Injected a minimal `LessonProgressStore` (`enrolment.findUnique` returning just `{ userId }`) so `overrideLessonProgress` can resolve the true enrolment owner and call the ownership-scoped `loadLearnerPath` on that learner's behalf — the plan's consumed-interfaces list only names `loadLearnerPath` itself, so this was the narrowest addition that avoided inventing a new `learner-access.ts` export or relaxing that module's ownership contract for staff callers.
- `LessonProgressTxClient` deliberately does NOT extend `CompletionServiceTxClient` (mirrors `attendance-service.ts`'s own choice) — the two are structurally unrelated types, and the call site casts explicitly, keeping the test fake's surface small.
- `markLessonComplete`/`undoLessonComplete` call `recalculateCompletion` on every successful invocation, including idempotent no-op repeats — matches the plan's behavior text literally and costs nothing extra since recalculation is itself idempotent.

## Deviations from Plan

### Process note (not a Rule 1-4 deviation)

The plan lays out three tasks with separate TDD read/write/test cycles, but because all three build directly on the same file and the same test file with tightly coupled behavior (Task 2's watch-progress auto-completion directly exercises Task 1's `undoLessonComplete`, and Task 3's override reuses Task 1/2's tx-write shape), the implementation was written and verified as one cohesive unit rather than three sequential commits. All acceptance criteria from all three tasks were verified together:

- `npx vitest run tests/lesson-progress-service.test.ts` — 44 passed (≥33 required across all three tasks' cumulative counts)
- `npx vitest run tests/lesson-progress-service.test.ts tests/completion-service.test.ts tests/boundary.test.ts` — 76 passed
- `npx tsc --noEmit` — 0 errors attributable to this file (pre-existing, unrelated errors remain in `stripe` SDK type resolution and `src/app/layout.tsx`, both outside this plan's scope)
- `npx eslint src/server/services/lesson-progress-service.ts` — clean
- `grep -c "lessonProgress.deleteMany" src/server/services/lesson-progress-service.ts` → `0`
- `grep -n "withPermission<" src/server/services/lesson-progress-service.ts` → exactly one line
- `grep -c "VIDEO_COMPLETION_PCT" src/server/services/lesson-progress-service.ts` → `3`

No Rule 1-4 auto-fixes were needed — the plan's interfaces, schema, and existing services (`learner-access.ts`, `completion-service.ts`, `attendance-service.ts`, `cohort-scope.ts`) matched what the plan described exactly.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `markLessonComplete`, `undoLessonComplete`, `recordWatchProgress`, `overrideLessonProgress` and `countLessonsRelockedBy` are ready for 09-11's Server Actions to wrap directly — the five typed refusal error classes (`LessonNotOpenableError`, `ManualCompletionNotPermittedError`, `NotAVideoLessonError`, `InvalidWatchProgressError`, `OverrideReasonRequiredError`) give those Server Actions distinguishable failure states to render.
- `VIDEO_COMPLETION_PCT` is exported for the 09-12 client video island to reuse for its caption/UI logic without redefining the threshold.
- No blockers for downstream plans in this wave.

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: src/server/services/lesson-progress-service.ts
- FOUND: tests/lesson-progress-service.test.ts
- FOUND commit: 41065d7
