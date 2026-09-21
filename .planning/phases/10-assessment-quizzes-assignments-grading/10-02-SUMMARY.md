---
phase: 10-assessment-quizzes-assignments-grading
plan: 02
subsystem: api
tags: [scoring, quiz, pure-function, typescript, vitest]

# Dependency graph
requires:
  - phase: 09-learning-delivery-progress-tracking
    provides: "completion-engine.ts's pure-module + purity-gate pattern this plan mirrors"
provides:
  - "scoreAttempt: pure per-QuestionType (SINGLE_CHOICE/TRUE_FALSE/MULTI_CHOICE) quiz scoring with D-09 partial credit"
  - "selectEffectiveAttempt: D-02 HIGHEST/LATEST/AVERAGE effective-attempt selection with recomputed pass verdicts"
  - "an executable purity gate proving quiz-scoring.ts has zero runtime imports"
affects: ["10-04 (startAttempt snapshot producer)", "10-06 (attempt submit/score consumer of this contract)"]

# Tech tracking
tech-stack:
  added: []
  patterns: ["pure-module scoring core with zero import statements (stricter than completion-engine.ts's type-only-import allowance)"]

key-files:
  created:
    - src/server/services/quiz-scoring.ts
    - tests/quiz-scoring.test.ts
  modified: []

key-decisions:
  - "quiz-scoring.ts declares zero import statements at all (not even import type) -- every shape is declared locally, removing even the possibility of a future edit upgrading a type-only import to a runtime one"
  - "Rounding rule applied in exactly two places: roundToTwoDecimals for per-question awarded marks before summing, roundToInteger for the final summed score and AVERAGE's synthesised score/maxScore (Attempt.score/Grade.score are Prisma Int columns)"
  - "AVERAGE also averages maxScore across eligible attempts (not specified verbatim in the plan's behavior list, but symmetric with averaging score and consistent since a re-published assessment could change a later attempt's snapshot maxScore)"
  - "Task 1 and Task 2's TDD RED/GREEN cycles were collapsed into one RED commit and one GREEN commit each, since both tasks write into the same two files (quiz-scoring.ts, quiz-scoring.test.ts) and were implemented together -- all behavior from both tasks' <behavior> blocks is covered"

requirements-completed: [ASM-02]

# Metrics
duration: ~12min
completed: 2026-09-15
---

# Phase 10 Plan 02: Pure Quiz-Scoring Core Summary

**Pure `quiz-scoring.ts` module (zero import statements) implementing D-09's MULTI_CHOICE partial-credit formula and D-02's HIGHEST/LATEST/AVERAGE effective-attempt selection, with an executable purity gate and a reproducibility test.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-09-15T13:33:00Z (approx, first read)
- **Completed:** 2026-09-15T13:45:07+01:00
- **Tasks:** 2 completed (collapsed into one RED + one GREEN + one docs commit)
- **Files modified:** 3 (2 created: quiz-scoring.ts, quiz-scoring.test.ts; 1 created: deferred-items.md)

## Accomplishments
- `scoreAttempt(input: ScoreAttemptInput): AttemptScore` scores all three `QuestionType` members (`SINGLE_CHOICE`, `TRUE_FALSE`, `MULTI_CHOICE`) per D-09's exact formula, with `ScoreAttemptInput` structurally unable to carry a client-supplied `score`/`passed` (T-10-01).
- `selectEffectiveAttempt` implements D-02's `HIGHEST`/`LATEST`/`AVERAGE` `attemptGradingMethod`, excluding `IN_PROGRESS`/`ABANDONED` attempts, always recomputing `passed` from the resulting score rather than copying it from an individual attempt.
- An executable purity gate (`runtimeImports` from `tests/import-graph.ts`) proves `quiz-scoring.ts` has zero runtime imports — and in fact the module has zero import statements of any kind (T-10-12).
- A reproducibility test scores the same snapshot + responses twice and asserts deep equality.
- 31/31 tests in `tests/quiz-scoring.test.ts` pass; 45/45 pass across `tests/quiz-scoring.test.ts` + `tests/boundary.test.ts`; `eslint` on `quiz-scoring.ts` reports zero errors.

## Task Commits

Each task was committed atomically (TDD RED then GREEN, both tasks combined since they share one file):

1. **Task 1 + Task 2 (RED): failing tests for scoreAttempt, selectEffectiveAttempt, purity gate** - `b27d398` (test)
2. **Task 1 + Task 2 (GREEN): implement quiz-scoring.ts** - `fdca494` (feat)
3. **Out-of-scope logging: pre-existing tsc failure in layout.tsx** - `3d76d8a` (docs)

**Plan metadata:** committed as part of this response (SUMMARY.md).

## Files Created/Modified
- `src/server/services/quiz-scoring.ts` - Pure scoring core: `scoreAttempt`, `selectEffectiveAttempt`, and all five exported types plus `AttemptGradingMethod`/`ScoredAttemptRecord`/`EffectiveAttemptResult` support types. Zero import statements.
- `tests/quiz-scoring.test.ts` - 31 table-driven cases covering every `<behavior>` bullet from both tasks, plus the reproducibility case and the purity gate.
- `.planning/phases/10-assessment-quizzes-assignments-grading/deferred-items.md` - New file logging one out-of-scope, pre-existing `tsc` failure (see Issues Encountered).

## Decisions Made
- **Zero import statements, not just zero runtime imports:** `completion-engine.ts` (the mirrored precedent) allows `import type` for its two type dependencies. `quiz-scoring.ts` needed no external types at all (`QuestionSnapshot`, `OptionSnapshot`, etc. are all declared locally per the plan's `<interfaces>` block), so the module has no import statements whatsoever — a strictly stronger purity guarantee than the precedent, with no downside.
- **Rounding applied in exactly two places:** `roundToTwoDecimals` (per-question awarded marks, called once inside `scoreMultiChoice`) and `roundToInteger` (final `score` in `scoreAttempt`, and `AVERAGE`'s synthesised score/maxScore in `selectEffectiveAttempt`) — each rule lives in one function, called from the minimum necessary call sites, per the plan's "applied in exactly one place so it cannot drift" instruction.
- **`AVERAGE` averages `maxScore` too:** the plan's `<behavior>` only specifies averaging `score`; `maxScore` is averaged for symmetry and because attempt snapshots (D-08) could in principle carry different `maxScore` values across attempts of the same assessment if the assessment was edited between attempts. No test asserts a specific `maxScore` averaging value beyond the equal-maxScore fixtures used, so this is a safe default that downstream plan 10-06 can override if a different convention is needed.
- **Task 1/Task 2 TDD cycles collapsed:** both tasks add to the same two files and their behaviors compose naturally (scoring core, then selection logic reusing nothing from scoring but living in the same module). One RED commit covers every `<behavior>` bullet from both tasks; one GREEN commit implements both `scoreAttempt` and `selectEffectiveAttempt` together. This satisfies both tasks' `<done>` criteria without artificially splitting a single coherent file into two half-working intermediate commits.

## Deviations from Plan

None requiring a rule — one out-of-scope discovery was logged, not fixed (see Issues Encountered).

## Issues Encountered

- **Pre-existing, out-of-scope `tsc --noEmit` failure:** `npx tsc --noEmit` exits with `src/app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'.` This file was not touched by this plan (`git diff HEAD -- src/app/layout.tsx` shows no changes, and its last commit predates this plan). `LayoutProps` appears to be a Next.js 16 App Router generated global type that requires `next dev`/`next build` type generation to populate `.next/types/`, which was not run in this sandbox. Per the executor's scope-boundary rule, this was logged to `deferred-items.md` rather than fixed. `quiz-scoring.ts` itself was confirmed independently clean: isolated `vitest run` (31/31 pass), `eslint` (zero errors), and no `@prisma/client` import (`grep -c` returns 0).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The `QuestionSnapshot`/`OptionSnapshot`/`AttemptResponse`/`AttemptScore` contract this plan defines is ready for plan 10-04 (`startAttempt`, which must produce a matching frozen snapshot) and plan 10-06 (attempt submit/score, which calls `scoreAttempt` and `selectEffectiveAttempt`).
- Re-run `npx tsc --noEmit` project-wide once `.next/types` is regenerated in an environment with `next dev`/`next build` available, to confirm the `layout.tsx` `LayoutProps` gap is unrelated tooling noise and not a real regression.

---
*Phase: 10-assessment-quizzes-assignments-grading*
*Completed: 2026-09-15*

## Self-Check: PASSED

- FOUND: src/server/services/quiz-scoring.ts
- FOUND: tests/quiz-scoring.test.ts
- FOUND: .planning/phases/10-assessment-quizzes-assignments-grading/deferred-items.md
- FOUND commit: b27d398 (test)
- FOUND commit: fdca494 (feat)
- FOUND commit: 3d76d8a (docs)
