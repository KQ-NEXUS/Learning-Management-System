---
phase: 10-assessment-quizzes-assignments-grading
plan: 14
subsystem: ui
tags: [nextjs-server-actions, react, learner-portal, file-upload, sanitize-html, zod]

# Dependency graph
requires:
  - phase: 10-05
    provides: submission-service.ts (beginSubmissionUpload/completeSubmissionUpload/failSubmissionUpload/getOwnSubmissions, the presigned-PUT-then-verify pipeline)
  - phase: 10-11
    provides: QuizAttemptPanel composition pattern (sibling client island beside LessonContent) and the assessment-actions.ts sibling-module convention
provides:
  - AssignmentSubmissionPanel.tsx — the learner-facing Assignment submission state machine (pre-submit/uploading/receipt/history/failure/hard-cutoff)
  - submission-actions.ts — begin/complete/fail Server Actions plus a loadAssignmentSubmissionView view-builder
  - submission-service.ts's getOwnAssignmentView export (title/instructions/constraints + full submission history, ownership-scoped)
  - The final LessonContent placeholder removal — QUIZ and ASSIGNMENT both render real content now
affects: [10-15, 10-16, 10-17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-side sanitisation before the RSC->client-component boundary: sanitizeLessonBody runs once in the view-builder (server), never re-sanitised or re-bundled client-side"
    - "revalidatePath with a route-pattern + type:'page' (not a literal path) when a Server Action's schema deliberately excludes the route params needed to construct a literal path (T-10-33 tamper-resistance over literal-path convenience)"

key-files:
  created:
    - src/components/learner/AssignmentSubmissionPanel.tsx
    - "src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions.ts"
    - tests/components/assignment-submission-panel.test.tsx
    - tests/learner-submission-route.test.ts
  modified:
    - src/components/catalogue/LessonContent.tsx
    - "src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/page.tsx"
    - src/server/services/submission-service.ts
    - src/server/services/lesson-service.ts
    - tests/submission-service.test.ts

key-decisions:
  - "Action schemas carry no enrolmentId/lessonId (matching the plan's explicit anti-tamper list); revalidatePath uses the dynamic route-pattern form instead of a literal path"
  - "instructions HTML is sanitised server-side inside the view-builder (submission-service.ts's title/instructions + submission-actions.ts's sanitizeLessonBody call), not client-side inside the panel, keeping sanitize-html off the client bundle"
  - "Grade-per-submission history entries (named in UI-SPEC 7.4.3 prose) were NOT wired — the plan's own interfaces/must_haves/acceptance criteria never mention Grade integration for this panel; deferred as a named gap to whichever future plan wires learner-visible released grades"

patterns-established:
  - "A view-builder living beside a plan's Server Actions module, calling a new ownership-scoped service export (getOwnAssignmentView), mirroring loadLearnerQuiz's shape but kept in the actions file since the service's own exports were assessmentId-keyed only"

requirements-completed: [ASM-03, ASM-04]

# Metrics
duration: ~60min
completed: 2026-09-15
---

# Phase 10 Plan 14: Assignment Submission UI Summary

**Learner-facing Assignment submission panel with a presigned direct-to-storage upload, a receipt that only ever renders from a server-verified completion, inline lateness warning, hard-cutoff control replacement, and full resubmission history — plus the last removal of `LessonContent`'s Phase 10 placeholder.**

## Performance

- **Duration:** ~60 min
- **Completed:** 2026-09-15T22:12:35Z
- **Tasks:** 3/3 completed
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments

- `AssignmentSubmissionPanel.tsx` implements the full §7.4 state machine (pre-submit → uploading → receipt/history → failure, with hard cutoff replacing rather than disabling the submit control) as a sibling client island beside `LessonContent`, matching `QuizAttemptPanel`'s established composition.
- `submission-actions.ts` provides three ownership-scoped, tamper-resistant Server Actions (`beginSubmissionUploadAction`, `completeSubmissionUploadAction`, `failSubmissionUploadAction`) whose zod schemas structurally reject `receiptId`/`isLate`/`enrolmentId`/`storageKey`, plus a `loadAssignmentSubmissionView` view-builder that exposes the published constraints before the learner ever picks a file (ASM-03).
- The receipt only ever enters component state from a verified `completeSubmissionUploadAction` response — the begin step's reply has no `receiptId` field at all, so an optimistic render is not constructible (ASM-04, T-10-19).
- `LessonContent.tsx`'s `ASSIGNMENT` branch now renders the lesson's own body like every other content type; the `Placeholder` component and its "arrives in Phase 10" note are deleted (last reference — plan 10-11 already removed the `QUIZ` use).
- 29 new tests (20 route/action, 9 component) all green on first full run after one TypeScript fixture fix; `tsc --noEmit` and `eslint` both clean across every touched file.

## Task Commits

Each task was committed atomically:

1. **Task 1: submission-actions.ts — begin, complete and fail** - `e02c64b` (feat)
2. **Task 2: AssignmentSubmissionPanel and the final LessonContent branch change** - `a000821` (feat)
3. **Task 3: Component and route tests for the submission panel** - `1eaa1de` (test)

_Worktree mode: no separate plan-metadata commit — SUMMARY.md is committed by the orchestrator's post-wave integration step._

## Files Created/Modified

- `src/components/learner/AssignmentSubmissionPanel.tsx` — the submission state machine client island (308 lines)
- `src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions.ts` — three Server Actions + the view-builder
- `src/components/catalogue/LessonContent.tsx` — `ASSIGNMENT` case renders `BodyProse`; `Placeholder` deleted
- `src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/page.tsx` — loads and renders `AssignmentSubmissionPanel` when the lesson is an `ASSIGNMENT` with an `assessmentId`
- `src/server/services/submission-service.ts` — added `title`/`instructions` to the assessment context and a new `getOwnAssignmentView` export
- `src/server/services/lesson-service.ts` — `getLessonContentForLearner` now carries `assessmentId` through
- `tests/components/assignment-submission-panel.test.tsx` — 9 component tests
- `tests/learner-submission-route.test.ts` — 20 action/view-builder tests
- `tests/submission-service.test.ts` — fixture updated for the new required `title`/`instructions` fields

## Decisions Made

- Action schemas deliberately carry no `enrolmentId`/`lessonId` (matching the plan's explicit T-10-33 anti-tamper list), so `completeSubmissionUploadAction`'s revalidation uses `revalidatePath("/learn/[enrolmentId]/lessons/[lessonId]", "page")` — the documented dynamic-route-pattern form — rather than a literal path built from a client-supplied enrolment id.
- `instructions` HTML is sanitised once, server-side, inside `loadAssignmentSubmissionView` (same `sanitizeLessonBody` allow-list `LessonContent`'s `BodyProse` uses) before crossing into the client panel's props — keeps `sanitize-html` out of the client bundle and preserves the single-sanitiser-function invariant (T-10-34) without introducing a second rendering path.
- The pre-submit view-builder's data (`getOwnAssignmentView`) was added to `submission-service.ts` rather than assembled ad hoc in the actions file, because it needed the same `resolveAssessment`/`resolveOwnEnrolmentForCourse` ownership-scoping every other export in that file already uses — reusing it kept the ownership check in one place instead of duplicating it in a "use server" file that cannot import Prisma.
- Per-submission Grade display (named in `10-UI-SPEC.md` §7.4.3's prose — "once released, its own grade") was **not** wired: the plan's own `<interfaces>`, `must_haves.truths`, and acceptance criteria never mention Grade integration for this panel, and no Grade-reading export was in scope. Left as a named gap for whichever future plan (results page / grading-consumer) wires learner-visible released grades into this history.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `getOwnAssignmentView` and `title`/`instructions` fields to `submission-service.ts`**
- **Found during:** Task 1 (submission-actions.ts's view-builder)
- **Issue:** The plan's Task 1 required an exported view-builder returning "the assessment's instructions, allowedFileTypes, maxFileSizeBytes, dueAt, availableUntil and allowResubmission" plus the submission history, but `submission-service.ts`'s existing exports (`getOwnSubmissions`, `beginSubmissionUpload`, etc.) had no function that assembled the pre-submit assessment context, and its `SubmissionAssessmentContext` type/select didn't even carry `title`/`instructions`. `submission-actions.ts` cannot import `@prisma/client` directly (the folder-boundary ESLint rule confines that to `src/server/services/**`), so this had to live in the service layer.
- **Fix:** Extended `SubmissionAssessmentContext` and the live Prisma `resolveAssessment` select with `title`/`instructions`; added a new `getOwnAssignmentView(actor, {assessmentId, enrolmentId})` export reusing the existing `resolveOwnEnrolmentForCourse` ownership check and `getOwnSubmissions`.
- **Files modified:** `src/server/services/submission-service.ts` (outside this plan's declared `files_modified` list)
- **Verification:** `npx tsc --noEmit` and `npx eslint` clean; `tests/learner-submission-route.test.ts`'s "returns the assessment's published constraints" case passes
- **Committed in:** `e02c64b` (Task 1 commit)

**2. [Rule 3 - Blocking] Carried `assessmentId` through `getLessonContentForLearner`**
- **Found during:** Task 2 (page.tsx wiring — "when the lesson's type is ASSIGNMENT and it has an assessmentId")
- **Issue:** `LearnerLessonContent` (the type `page.tsx`'s `content` variable already holds) had no `assessmentId` field, so the page had no way to know which assessment to load the submission view for without a second, redundant lookup.
- **Fix:** Added `assessmentId: true` to the `prisma.lesson.findUnique` select and `assessmentId: string | null` to `LearnerLessonContent`, mirroring the field `LoadedCourseTree.lessons[]` already carries for the staff side.
- **Files modified:** `src/server/services/lesson-service.ts` (outside this plan's declared `files_modified` list)
- **Verification:** `npx tsc --noEmit` clean; `page.tsx` compiles and wires the panel correctly
- **Committed in:** `a000821` (Task 2 commit)

**3. [Rule 1 - Bug] Fixed a test fixture broken by the `SubmissionAssessmentContext` type extension**
- **Found during:** Task 1's `npx tsc --noEmit` verification pass
- **Issue:** `tests/submission-service.test.ts`'s `makeAssessment()` fixture no longer satisfied the extended `SubmissionAssessmentContext` type (missing the new required `title`/`instructions` fields), breaking the project-wide typecheck.
- **Fix:** Added `title: "Assignment 1"` and `instructions: null` to the fixture.
- **Files modified:** `tests/submission-service.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0 project-wide (excluding the pre-existing, already-logged `layout.tsx` issue at the time; that issue later cleared on its own once `.next/types` regenerated)
- **Committed in:** `e02c64b` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 blocking, 1 bug) — all in files adjacent to, but not listed in, this plan's declared `files_modified`.
**Impact on plan:** All three were necessary plumbing the plan's own task instructions required but didn't name a home for. No architectural changes, no scope creep beyond what Task 1/2's own action text specified.

## Issues Encountered

- `npx next build` cannot complete inside this parallel worktree — Turbopack's hermetic build sandboxes module resolution to the worktree's own filesystem root, and this worktree has no local `node_modules` (confirmed pre-existing, unrelated to this plan's edits; `npx tsc`/`npx eslint` succeed because Node's own upward `node_modules` resolution is unaffected by Turbopack's sandboxing). Logged in `deferred-items.md` under a new `10-14` entry. `tsc --noEmit` is clean and every touched file passes `eslint` with zero errors, so the build gap is infra-only, not a code defect. Should be re-confirmed once this worktree merges into an environment with `node_modules` present.

## Known Stubs

None — the panel is fully wired to real server data (no hardcoded empty arrays/placeholder text feeding the UI). The one intentional gap (per-submission Grade display) is a named UI-SPEC prose item outside this plan's declared scope, not a stub inside shipped code, and is documented above under Decisions Made.

## User Setup Required

None — no external service configuration required (reuses the existing MinIO/S3 presigning already wired by plan 10-05).

## Next Phase Readiness

- ASM-03/ASM-04's learner-facing half is complete: an Assignment lesson now shows real instructions/constraints, a verified-only receipt, lateness flagging, hard-cutoff enforcement, and full resubmission history.
- `LessonContent`'s Phase 10 placeholder is fully gone — both `QUIZ` (plan 10-11) and `ASSIGNMENT` (this plan) render real content.
- Downstream plans that read released Grades for a Submission (the learner results page, ASM-07) can extend `AssignmentSubmissionPanel`'s history rows with a grade fact without restructuring the panel — the row shape and `SubmissionHistoryRow` sub-component are already isolated for that addition.
- `npx next build`'s infra gap in this worktree should be cleared by the orchestrator's consolidated build pass before Phase 10 UAT closes.

---
*Phase: 10-assessment-quizzes-assignments-grading*
*Completed: 2026-09-15*

## Self-Check: PASSED

- FOUND: src/components/learner/AssignmentSubmissionPanel.tsx
- FOUND: src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions.ts
- FOUND: src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/page.tsx
- FOUND: src/components/catalogue/LessonContent.tsx
- FOUND: tests/components/assignment-submission-panel.test.tsx
- FOUND: tests/learner-submission-route.test.ts
- FOUND: src/server/services/submission-service.ts
- FOUND: src/server/services/lesson-service.ts
- FOUND commit e02c64b (Task 1)
- FOUND commit a000821 (Task 2)
- FOUND commit 1eaa1de (Task 3)
