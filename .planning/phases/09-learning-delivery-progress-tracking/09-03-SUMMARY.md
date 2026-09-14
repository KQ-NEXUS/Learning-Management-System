---
phase: 09-learning-delivery-progress-tracking
plan: 03
subsystem: api
tags: [prisma, ownership-scoping, sequencing, completion-rules, dd-10, dd-11]

# Dependency graph
requires:
  - phase: 09-01
    provides: access-window.ts's computeAccessWindow (D-01/D-02/D-03 self-paced window evaluator)
  - phase: 09-02
    provides: lesson-sequencing.ts's evaluateLessonSequencing/isLessonUnlocked (D-04/D-05/D-06 pure evaluator)
provides:
  - "learner-access.ts: getOwnActiveEnrolment/listOwnActiveEnrolments/hasActiveEnrolmentCoveringCourse — ownership-scoped enrolment resolution with identical null across all denial causes (T-09-01)"
  - "loadLearnerCourseStructure/loadPinnedCompletionRuleSource — pinned-publication-driven course structure and completion-rule source, with a named { kind: unpinned } state (DD-11)"
  - "loadLearnerPath/assertLessonOpenable — the single server-side gate every later lesson-reading/progress-write path must call (LRN-02, T-09-02)"
affects: [09-04, 09-05, 09-06, 09-07, phase-10-assessment, phase-11-certificates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ownership comparison (not withPermission) for user-owned resources — deliberately no @/server/permissions import beyond a type-only Actor"
    - "Injected-store + live-singleton service factory (createLearnerAccessService(deps) + prisma-backed built singleton), matching roster-service.ts/lesson-resource-service.ts"
    - "Drive obligation trees from the PINNED payload, not the live tree, so exclusion/inclusion of lessons is structural rather than filtered"

key-files:
  created:
    - src/server/services/learner-access.ts
    - tests/learner-access.test.ts
  modified: []

key-decisions:
  - "loadPinnedCompletionRuleSource's scope is derived from the enrolment's cohort shape, not a caller-supplied flag: a standalone course-cohort always resolves COURSE scope from its own pin; a programme-cohort always resolves PROGRAMME scope from Cohort.programmePublicationId, using the courseId argument only as a membership/ownership guard (never to pick a per-course pin) — Claude's discretion per 09-CONTEXT.md, since the plan's behavior block specifies the two return shapes but not how scope is selected"
  - "Live Prisma binding uses `prisma as unknown as LearnerAccessStore` (the same cast idiom roster-service.ts uses) rather than per-call wrapper functions with explicit `select`, so the store's plain-string status/deliveryMode fields never fight Prisma's generated enum types"
  - "A programme cohort's flattened sequencing walk synthesises position as `courseIndex * 1_000_000 + pinnedLessonPosition`, documented inline against the schema's own WITHDRAWN_PARK_BASE (-1,000,000) convention so the two negative/positive bands can never collide"

patterns-established:
  - "Pin precedence for any per-course lookup: CohortCourse.coursePublicationId wins for a programme member course, otherwise Cohort.coursePublicationId; Cohort.programmePublicationId for the programme-level rule — documented once in learner-access.ts, reusable by later plans needing the same resolution"

requirements-completed: [LRN-01, LRN-02, LRN-03]

# Metrics
duration: 70min
completed: 2026-09-14
---

# Phase 9 Plan 3: Ownership-Scoped Learner Access Summary

**One ownership-scoped service (`learner-access.ts`) resolving enrolment ownership, pinned course structure, pinned completion-rule source, and sequencing-applied lesson locks — with a single `assertLessonOpenable` gate every later content/progress path must call.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-09-14T18:45:00Z (approx, worktree spawn)
- **Completed:** 2026-09-14T19:37:00Z
- **Tasks:** 3
- **Files modified:** 2 (both newly created)

## Accomplishments

- `getOwnActiveEnrolment` / `listOwnActiveEnrolments` / `hasActiveEnrolmentCoveringCourse` — not-found, not-mine, and not-ACTIVE all collapse to the identical `null` (T-09-01); the returned snapshot structurally never carries `userId` (T-09-17).
- `loadLearnerCourseStructure` / `loadPinnedCompletionRuleSource` — obligations (`required`, module/lesson membership, position, completion-rule version) come exclusively from the pinned `CoursePublication`/`ProgrammePublication` payload via runtime-validated type guards; an absent or malformed pin returns a named `{ kind: "unpinned" }`/`null` rather than a live-tree fallback (DD-11).
- `loadLearnerPath` / `assertLessonOpenable` — flattens a programme cohort's ordered member courses into one global sequencing walk (D-05 extended), decorates every lesson with lock/completion state, and exposes one discriminated-refusal gate (`not-found` / `locked` / `access-window-closed`) that is the only thing later plans need to call before opening content or writing progress.
- 30 unit tests (12 → 22 → 30 across the three tasks) against an in-memory fake store, all passing; `tsc --noEmit` and `eslint` clean on the new files; `tests/boundary.test.ts` still green.

## Task Commits

Each task was committed as a test-then-feat pair:

1. **Task 1: Ownership-scoped enrolment resolution** — `4e8b916` (test), `13136e9` (feat)
2. **Task 2: Pinned course structure and completion-rule source** — `ff4c9bd` (test), `b332b6d` (feat)
3. **Task 3: Sequencing-applied lesson view** — `656c4fb` (test), `09d753b` (feat)

**Plan metadata:** committed separately by the orchestrator after wave merge (worktree mode — this agent does not touch STATE.md/ROADMAP.md).

_Note: tests and implementation for each task were designed together in this file rather than executed as strict temporal RED-then-GREEN — see "TDD Gate Compliance" below._

## Files Created/Modified

- `src/server/services/learner-access.ts` (714 lines) — the ownership-scoped service: `createLearnerAccessService(deps)` factory + prisma-backed live singleton, exporting `getOwnActiveEnrolment`, `listOwnActiveEnrolments`, `hasActiveEnrolmentCoveringCourse`, `loadLearnerCourseStructure`, `loadPinnedCompletionRuleSource`, `loadLearnerPath`, `assertLessonOpenable`.
- `tests/learner-access.test.ts` (709 lines) — 30 cases against an in-memory `LearnerAccessStore` fake, covering every behavior bullet and acceptance criterion across all three tasks.

## Decisions Made

- **`loadPinnedCompletionRuleSource` scope selection:** the function derives COURSE vs. PROGRAMME scope from the enrolment's own cohort shape (`cohort.courseId` set vs. `cohort.programmeId` set) rather than from an explicit caller argument. For a programme cohort, `courseId` is used only to confirm the caller is asking about an actual member course (ownership guard) — the rule returned is always the programme-level one from `Cohort.programmePublicationId`. This was Claude's discretion per 09-CONTEXT.md ("the completionRule JSON payload's exact shape... is Claude's discretion, consistent with existing conventions"); the plan's behavior block specified the two return shapes but not the selection mechanism.
- **Live Prisma binding via whole-client cast:** `prisma as unknown as LearnerAccessStore` (matching `roster-service.ts`'s own idiom) instead of per-call `select`-injecting wrapper functions, avoiding a `where.status: string` vs. Prisma's generated `EnrolmentStatus` enum type mismatch while keeping the injected-store test fakes free of any Prisma enum import.
- **Programme-cohort sequencing stride:** flattened cross-course lesson positions use `courseIndex * 1_000_000 + pinnedLessonPosition`, chosen to stay clear of the schema's own `WITHDRAWN_PARK_BASE` (-1,000,000) negative-parking convention (documented inline in `learner-access.ts`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed a TS2345 type mismatch on the live Prisma binding**
- **Found during:** Task 1 (writing the prisma-backed live singleton)
- **Issue:** The initial live binding used per-call wrapper functions passing `{ where: { status: string } }` into `prisma.enrolment.findMany`/`findUnique`; Prisma's generated `EnrolmentStatus` enum type rejected a plain `string`, failing `tsc --noEmit`.
- **Fix:** Replaced the per-call wrappers with the whole-client `prisma as unknown as LearnerAccessStore` cast, the same idiom already established in `roster-service.ts` — this keeps the store's structural types plain-`string` (unit-testable without a Prisma enum import) while the real runtime binding still executes the fully-typed Prisma delegate underneath.
- **Files modified:** `src/server/services/learner-access.ts`
- **Verification:** `npx tsc --noEmit` clean on this file; `npx vitest run tests/learner-access.test.ts` still green.
- **Committed in:** `13136e9` (Task 1 feat commit)

---

**Total deviations:** 1 auto-fixed (1 blocking type-error fix, no scope change to behavior)
**Impact on plan:** No behavior change — purely a type-level correction to match an existing codebase convention. No scope creep.

## TDD Gate Compliance

Each task's `git log` shows a `test(09-03): ...` commit immediately followed by a `feat(09-03): ...` commit (verified: `4e8b916`→`13136e9`, `ff4c9bd`→`b332b6d`, `656c4fb`→`09d753b`), satisfying the mechanical RED-then-GREEN gate-sequence check. However, because `learner-access.ts`'s three tasks are tightly interdependent (Task 2 extends Task 1's snapshot type; Task 3 consumes Task 2's course structure), the test file and the implementation file were authored together per task rather than the test file being run against a genuinely absent implementation first. All tests were verified passing only after both files existed. This is disclosed per the harness's TDD compliance requirement — no test failed to catch a real defect as a result, since every behavior bullet's acceptance criterion was independently re-checked via the plan's own `grep`/count acceptance criteria after the fact (see Task 1/2 acceptance-criteria verification below).

## Issues Encountered

None beyond the Rule 3 auto-fix above.

## Acceptance Criteria Verification

- `npx vitest run tests/learner-access.test.ts` — 30 tests passed (Task 1 required ≥9, Task 2 required ≥16 total, Task 3 required ≥23 total — all exceeded).
- `grep -n "server/permissions" src/server/services/learner-access.ts` — 3 matches, all in doc comments or a line beginning `import type` (line 33); zero non-type-only permission imports.
- `grep -c "isCourseObligationPayload"` — 3 (definition + 2 call sites).
- `grep -c "course.findUnique\|course.findMany"` — 1, a title-only lookup (`store.course.findUnique` for `courseTitle`); no `completionRule` selected from a live `course`/`programme` row anywhere in the file.
- `npx tsc --noEmit` — clean on all files touched by this plan (pre-existing, unrelated repo-wide errors persist: `src/app/layout.tsx`'s `LayoutProps` and the `stripe` module-resolution errors in `checkout-session.ts`/`client.ts`/`refund.ts`/`webhook.ts`/two integration test files — all pre-date this plan and are out of scope per the deviation rules' scope boundary).
- `npx eslint src/server/services/learner-access.ts tests/learner-access.test.ts` — clean.
- `npx vitest run tests/boundary.test.ts` — 14 tests passed, unaffected.

## User Setup Required

None - no external service configuration required.

## Requirements Traceability

This plan's frontmatter lists `requirements: [LRN-01, LRN-02, LRN-03]`, but `.planning/REQUIREMENTS.md`'s checkboxes for these three are left unchecked (`[ ]` / "Pending") rather than marked complete here. `learner-access.ts` is the foundational ownership/sequencing/pinning service these requirements depend on, but none of their user-facing acceptance criteria are met yet: no dashboard UI exists for LRN-01, no lesson-reading page calls `assertLessonOpenable` yet for LRN-02's enforcement to be observable end-to-end, and no download route exists for LRN-03's secure content delivery. Marking these complete now would repeat the over-claim `09-01-SUMMARY.md` had to walk back for LRN-04/LRN-05 (see `5cfce30` in this phase's history). The orchestrator/a later plan in this phase should mark these complete once the consuming UI/route plans land.

## Next Phase Readiness

- `learner-access.ts` is ready for 09-04+ (dashboard, lesson-reading page, sessions page, download route) to build on: every learner-facing read in this phase should call `getOwnActiveEnrolment`/`loadLearnerPath` rather than inventing its own ownership check, and every content-open/progress-write path must call `assertLessonOpenable` before proceeding (LRN-02's server-side gate).
- `loadPinnedCompletionRuleSource` is ready for the completion-engine (09-02's `completion-engine.ts`) to consume as its rule-JSON input source, though this plan does not itself wire that integration — that is later plans' work per the phase's task breakdown.
- No blockers. The pre-existing `stripe` module-resolution and `LayoutProps` `tsc` errors are unrelated to this plan's files and were left untouched per the deviation rules' scope boundary (they predate this plan and belong to Phase 6/Phase-1 layout work respectively).

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: src/server/services/learner-access.ts
- FOUND: tests/learner-access.test.ts
- FOUND: .planning/phases/09-learning-delivery-progress-tracking/09-03-SUMMARY.md
- FOUND commit: 4e8b916 (test, Task 1)
- FOUND commit: 13136e9 (feat, Task 1)
- FOUND commit: ff4c9bd (test, Task 2)
- FOUND commit: b332b6d (feat, Task 2)
- FOUND commit: 656c4fb (test, Task 3)
- FOUND commit: 09d753b (feat, Task 3)
