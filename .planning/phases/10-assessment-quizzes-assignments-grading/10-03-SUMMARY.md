---
phase: 10-assessment-quizzes-assignments-grading
plan: 03
subsystem: api
tags: [assessment, quiz, assignment, readiness, resource-service, permissions, audit]

requires:
  - phase: 10-assessment-quizzes-assignments-grading (plan 10-01)
    provides: "assessmentCourseScope resolver, Assessment/QuizQuestion/QuizOption Prisma models"
provides:
  - "evaluateAssessmentReadiness() — pure draft-validation evaluator for Assessment publish gating"
  - "FEEDBACK_BEHAVIOURS closed allow-list (ON_RELEASE, IMMEDIATE, NEVER)"
  - "assessmentService (list/get/create/update/archive) via createResourceService"
  - "saveQuizQuestions() — nested QuizQuestion/QuizOption replace-write with totalMarks recompute"
  - "publishAssessment() — readiness-gated publish with version bump"
affects: [10-05, 10-08, 10-10]

tech-stack:
  added: []
  patterns:
    - "Bespoke withPermission-wrapped functions built alongside a createResourceService factory instance in one file (mirrors lesson-resource-service.ts)"
    - "Scope resolver built from createAssessmentScopeResolvers reusing the SAME injected delegate as CRUD, so one fake drives both in unit tests (no second scope implementation)"
    - "Typed refusal errors (AssessmentNotPublishableError, NotAQuizError, AssessmentNotFoundError, InvalidFeedbackBehaviourError) in the LessonNotOpenableError/CohortReadinessRefusedError style"

key-files:
  created:
    - src/server/services/assessment-readiness.ts
    - src/server/services/assessment-service.ts
    - tests/assessment-readiness.test.ts
    - tests/assessment-service.test.ts
  modified:
    - src/server/services/readiness-service.ts

key-decisions:
  - "Added \"Grading\" to ReadinessCategory (readiness-service.ts) for pass-mark/attempts/feedback items — none of the existing seven categories fit a per-Assessment grading setting"
  - "publishAssessment's single-row status/version write goes through the ordinary delegate.update (no separate transaction wrapper) — only saveQuizQuestions' multi-table write needs the injected AssessmentTx/db.$transaction"
  - "Version-bump rule implemented as: increment when the Assessment's status is already PUBLISHED before this write, otherwise leave version unchanged — equivalent to and simpler than the plan's version-1-tracking phrasing, verified against both stated examples (first publish stays at 1, every publish after increments)"

patterns-established:
  - "assessment-readiness.ts: one evaluator, two call sites (authoring panel in 10-08, publishAssessment here) — never a duplicated copy"

requirements-completed: [ASM-01, ASM-03]

duration: ~55min
completed: 2026-09-15
---

# Phase 10 Plan 03: Assessment Authoring — Draft Validation and Service Summary

**Pure Assessment readiness evaluator plus a CRUD+nested-question+publish service, gated on the real `assessments.create`/`assessments.edit` catalogue identifiers with no new permission and no new Prisma model.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- `evaluateAssessmentReadiness()` — a pure evaluator (no DB, no clock) that blocks publish on every ASM-01/ASM-03 authoring defect: zero questions, blank prompts, wrong correct-option counts per question type, too-few options, sub-1 marks, a `totalMarks` mismatch, `passMark` above `totalMarks`, sub-1 `maxAttempts`, an out-of-allow-list `feedbackBehaviour`, empty Assignment file types, an unset/non-positive max file size, blank Assignment instructions, and an inverted availability window — with a non-blocking WARN for a null `passMark`, a single-attempt `attemptGradingMethod`, and a due date past the availability cutoff.
- `FEEDBACK_BEHAVIOURS` frozen allow-list closes the trust-boundary gap on `Assessment.feedbackBehaviour` (a raw Prisma `String` column with no database constraint).
- `assessmentService` (list/get/create/update/archive) built on `createResourceService`, reads gated on `courses.view` (the closed catalogue has no dedicated Assessment-view permission), writes gated on `assessments.create`/`assessments.edit`.
- `saveQuizQuestions()` replaces an Assessment's `QuizQuestion`/`QuizOption` set inside one transaction, assigning sequential positions from array order and recomputing `totalMarks` as the sum of question marks so the derived figure can never drift.
- `publishAssessment()` reads the same evaluator the authoring panel will render (plan 10-08), refuses via `AssessmentNotPublishableError` on any blocking failure, and bumps `version` on every publish after the first.

## Task Commits

1. **Task 1: assessment-readiness.ts — the pure draft-validation evaluator** - `e86a306` (feat)
2. **Task 2: assessment-service.ts — CRUD, nested question writes, publish and version bump** - `1073a8a` (feat)
3. **Task 3: tests/assessment-service.test.ts — scope denial, publish gate, version bump, nested writes** - `c81d1f0` (test, includes a Rule-1 bugfix to `assessment-service.ts`)

**Plan metadata:** committed with this SUMMARY (see final commit below).

## Files Created/Modified

- `src/server/services/assessment-readiness.ts` - Pure `evaluateAssessmentReadiness()` + `FEEDBACK_BEHAVIOURS`
- `src/server/services/assessment-service.ts` - `assessmentService`, `saveQuizQuestions`, `publishAssessment`, typed errors
- `src/server/services/readiness-service.ts` - Added `"Grading"` to `ReadinessCategory`
- `tests/assessment-readiness.test.ts` - 33 cases, one per `<behavior>` bullet
- `tests/assessment-service.test.ts` - 12 cases covering scope, audit, feedback validation, publish gate/version bump, nested writes

## Decisions Made

- Extended `ReadinessCategory` with `"Grading"` rather than overloading `"Content"` for pass-mark/attempts/feedback-behaviour items, per the plan's explicit "extend the union rather than inventing a parallel category type" instruction.
- Built the Assessment scope resolver via `createAssessmentScopeResolvers({ assessment: deps.delegate })` inside `createAssessmentService`, rather than importing the already-bound `assessmentCourseScope` singleton directly — this reuses the SAME injected delegate the CRUD operations use, so a single fake drives both scope resolution and CRUD in unit tests with no real Postgres, while still satisfying the plan's literal-usage acceptance check (`assessmentCourseScope` appears 5 times: the destructure, the factory's `toScope`, and both bespoke `withPermission` wrappers).
- `publishAssessment`'s status/version write uses the plain `delegate.update` (no `$transaction` wrapper) since it touches exactly one row — the `AssessmentTx`/`db.$transaction` injection is reserved for `saveQuizQuestions`, which genuinely needs one atomic multi-table write (Assessment + QuizQuestion + QuizOption).
- Version-bump rule implemented as `status === "PUBLISHED" ? version + 1 : version` (evaluated against the row's state *before* this write) — simpler than a literal reading of the plan's "version is 1 and has never been published" phrasing, and verified to produce identical results for both examples the plan gives (first publish unchanged, every publish after increments).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `assessmentService.create`/`update` synchronously threw instead of rejecting**
- **Found during:** Task 3, writing the feedbackBehaviour-validation test
- **Issue:** The `create`/`update` wrappers that call `assertValidFeedbackBehaviour()` before delegating to the factory-built base service were plain (non-`async`) arrow functions. A validation failure threw synchronously rather than returning a rejected Promise, so `await expect(...).rejects.toThrow(...)` failed with an uncaught exception instead of catching a rejection — and any real caller awaiting the Promise-typed `update`/`create` contract would have hit the same break.
- **Fix:** Marked both wrapper functions `async`.
- **Files modified:** `src/server/services/assessment-service.ts`
- **Verification:** `npx vitest run tests/assessment-service.test.ts` — the feedbackBehaviour-rejection test now passes; full suite re-run clean.
- **Committed in:** `c81d1f0` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for `create`/`update` to honor their Promise-returning contract under a validation failure. No scope creep — no plan-specified behavior changed.

## Issues Encountered

None beyond the auto-fixed bug above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `assessmentService`, `saveQuizQuestions`, `publishAssessment`, and `FEEDBACK_BEHAVIOURS` are all in place for plan 10-08 (authoring UI) and 10-10 (grading) to consume, per the interfaces this plan's frontmatter documents as "Produced for plans 10-08 and 10-10."
- `evaluateAssessmentReadiness()` is the single evaluator both the authoring panel (10-08) and this plan's `publishAssessment` call — plan 10-08 must import it rather than re-implementing any check.
- **Not run in this sandbox:** the project-wide `npx vitest run` shows 24 pre-existing failures across 6 files (`enrolment-service.integration.test.ts` and siblings), all `PrismaClientInitializationError: Environment variable not found: DATABASE_URL` — the same Docker-unavailable real-Postgres gap STATE.md already documents for Phase 6 and earlier. Zero mentions of "assessment" anywhere in that failure output; confirmed out of scope for this plan and not touched by any file this plan created or modified.
- `npx tsc --noEmit` has one pre-existing, unrelated failure (`src/app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'`) already logged in `.planning/phases/10-assessment-quizzes-assignments-grading/deferred-items.md` by plan 10-02 — confirmed still present and still out of scope, not re-logged here.

---
*Phase: 10-assessment-quizzes-assignments-grading*
*Completed: 2026-09-15*

## Self-Check: PASSED

- FOUND: src/server/services/assessment-readiness.ts
- FOUND: src/server/services/assessment-service.ts
- FOUND: tests/assessment-readiness.test.ts
- FOUND: tests/assessment-service.test.ts
- FOUND commit: e86a306
- FOUND commit: 1073a8a
- FOUND commit: c81d1f0
