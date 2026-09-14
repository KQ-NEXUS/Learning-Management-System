---
phase: 09-learning-delivery-progress-tracking
plan: 02
subsystem: api
tags: [pure-evaluator, lesson-sequencing, completion-rule, vitest, tdd]

# Dependency graph
requires:
  - phase: 05-cohorts-scheduling-attendance
    provides: "attendance-component.ts's computeAttendanceComponent / AttendanceComponent discriminated union, read but never recomputed"
  - phase: 04-catalogue-content
    provides: "publication.ts's copy-before-sort convention (buildCourseObligationTree) and the Lesson model's position/required/withdrawnAt fields"
provides:
  - "evaluateLessonSequencing + isLessonUnlocked (D-04/D-05/D-06/T-09-13) — the single lock evaluator for both the lesson-list render and the lesson-reading server gate"
  - "parseCompletionRule + CompletionRuleV1 (D-10/DD-3/DD-9) — the typed v1 completionRule payload shape and its version/field-rejecting parser"
  - "evaluateCompletion + CompletionVerdict (D-10/D-12/LRN-07) — the per-rule-component completion verdict evaluator, never a composite percentage"
affects: [09-03, 09-04, 09-05, 09-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-evaluator discipline: zero runtime imports, structural input types only, named third states (NOT_YET_CHECKED) instead of fake passes"
    - "Copy-before-sort (.filter().slice().sort()) so a caller's own array order is never mutated"
    - "Closed recognised-key set (RECOGNISED_V1_KEYS) as a named const so future versions widen one list, not scattered branches"

key-files:
  created:
    - src/server/services/lesson-sequencing.ts
    - src/server/services/completion-rule.ts
    - src/server/services/completion-engine.ts
    - tests/lesson-sequencing.test.ts
    - tests/completion-engine.test.ts
    - .planning/phases/09-learning-delivery-progress-tracking/deferred-items.md
  modified: []

key-decisions:
  - "parseCompletionRule rejects an outer ruleVersion !== 1 in addition to the JSON's own version field, since D-10/DD-9 name completionRuleVersion as the authoritative column-level version and either signal disagreeing with v1 must fail loudly rather than silently trusting one over the other"
  - "attendance-component 'no-rule' kind is folded into the same NOT_YET_CHECKED treatment as 'no-sessions'/null in evaluateCompletion, since a rule with attendanceThresholdPct set encountering a 'no-rule' attendance component signals mismatched evidence, not a pass"

patterns-established:
  - "Pattern 4 (RESEARCH.md): pure completion-rule evaluator mirroring readiness-service.ts's ReadinessItem[] shape — one item per rule component, never collapsed"

requirements-completed: [LRN-02, LRN-07]

# Metrics
duration: 10min
completed: 2026-09-14
---

# Phase 9 Plan 02: Pure Lesson-Sequencing and Completion-Rule Evaluators Summary

**Three zero/near-zero-import pure modules — a D-04/D-05/D-06 lesson lock evaluator naming the blocking lesson by title, a versioned v1 completionRule parser that rejects unknown versions/fields outright, and a D-10/LRN-07 completion verdict evaluator that never collapses required-lessons and attendance into one composite percentage.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-09-14T20:00:47+01:00
- **Completed:** 2026-09-14T20:10:22+01:00
- **Tasks:** 3 completed
- **Files modified:** 6 (3 implementation, 2 test, 1 deferred-items log)

## Accomplishments
- `evaluateLessonSequencing` walks the whole course in position/id order and names the first incomplete required lesson as the blocker by title; `isLessonUnlocked` defaults an unknown lesson id to locked (T-09-13 mitigation)
- `parseCompletionRule` folds the Cohort's attendance threshold column into the typed v1 rule and throws on any unrecognised version or rule-payload key, never silently downgrading or ignoring a rule component (T-09-14 mitigation)
- `evaluateCompletion` returns a per-rule-component verdict item list (required-lessons, then attendance only when configured) with a genuine `NOT_YET_CHECKED` third state for ungathered attendance evidence, and an overall `satisfied` boolean requiring every item to pass

## Task Commits

Each task followed the RED → GREEN TDD cycle with separate commits:

1. **Task 1: Pure lesson-sequencing evaluator**
   - `a245500` test(09-02): add failing tests for lesson-sequencing evaluator
   - `811b36e` feat(09-02): implement pure lesson-sequencing evaluator
2. **Task 2: The v1 completionRule payload type and parser**
   - `8f2f3a4` test(09-02): add failing tests for parseCompletionRule
   - `5bf44cc` feat(09-02): implement v1 completionRule payload parser (includes a same-commit fix to a RED-phase test authoring bug, see Deviations)
3. **Task 3: Pure completion-rule evaluator**
   - `b3ad20d` test(09-02): add failing tests for evaluateCompletion
   - `46e8242` feat(09-02): implement pure completion-rule evaluator

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified
- `src/server/services/lesson-sequencing.ts` - Pure D-04/D-05/D-06 lock evaluator; zero imports; exports `evaluateLessonSequencing`, `SequencingLesson`, `SequencingResult`, `isLessonUnlocked`
- `src/server/services/completion-rule.ts` - The v1 `completionRule` payload shape and parser (D-10); zero imports; exports `CompletionRuleV1`, `parseCompletionRule`, `UnsupportedCompletionRuleVersionError`, `UnsupportedCompletionRuleFieldError`
- `src/server/services/completion-engine.ts` - Pure LRN-07 rule evaluator; type-only imports of `CompletionRuleV1`/`AttendanceComponent`; exports `evaluateCompletion`, `CompletionVerdict`, `CompletionVerdictItem`
- `tests/lesson-sequencing.test.ts` - 16 cases covering every behavior bullet plus `isLessonUnlocked`'s unknown-id guard
- `tests/completion-engine.test.ts` - 20 cases across `describe("parseCompletionRule")` (10) and `describe("evaluateCompletion")` (10)
- `.planning/phases/09-learning-delivery-progress-tracking/deferred-items.md` - Logs pre-existing, out-of-scope `tsc` failures found during verification (see Issues Encountered)

## Decisions Made
- `parseCompletionRule` treats the outer `ruleVersion` argument (the `completionRuleVersion` column) as authoritative alongside the JSON's own optional `version` field — either one being non-1 throws `UnsupportedCompletionRuleVersionError`. The plan's behavior bullets only exercised the JSON-level version, but D-10/DD-9's framing ("callers must read the rule JSON and completionRuleVersion from the pinned publication payload") makes the column-level version an equally authoritative signal; trusting only one and ignoring the other would be an unguarded escape hatch for exactly the "unknown shape must fail loudly" threat (T-09-14) this task exists to close.
- `evaluateCompletion`'s attendance-item builder treats `AttendanceComponent`'s `"no-rule"` kind the same as `"no-sessions"`/`null` (both →`NOT_YET_CHECKED`), even though the behavior block only enumerated `"no-sessions"` and `null` explicitly. A `"no-rule"` component arriving while `rule.attendanceThresholdPct` is set signals mismatched evidence (the attendance component was computed against a different/absent threshold than the completion rule expects) — treating it as anything but a named gap would risk exactly the fake-pass failure D-18/T-09-15 guard against.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a self-introduced RED-phase test authoring bug in parseCompletionRule's version-2 test case**
- **Found during:** Task 2, GREEN verification
- **Issue:** The RED-phase test for "`json: { version: 2, ... }` throws `UnsupportedCompletionRuleVersionError`" used `{ version: 2, someNewField: true }` as its fixture. Since `someNewField` is not in `RECOGNISED_V1_KEYS`, the implementation correctly threw `UnsupportedCompletionRuleFieldError` instead of `UnsupportedCompletionRuleVersionError` — the test was asserting the wrong failure mode for the wrong reason (it never actually exercised the version-2 rejection path).
- **Fix:** Changed the fixture to `{ version: 2, requireAllRequiredLessons: true }` (all-recognised keys), so the test genuinely isolates the version check from the key check.
- **Files modified:** `tests/completion-engine.test.ts`
- **Verification:** `npx vitest run tests/completion-engine.test.ts -t parseCompletionRule` — 10/10 pass, including this corrected case asserting `.version === 2` on the thrown error.
- **Committed in:** `5bf44cc` (folded into the Task 2 GREEN commit since it was a correction to that same task's own test, not a new task)

---

**Total deviations:** 1 auto-fixed (1 bug — a test authored during this same plan's RED phase, not a pre-existing defect)
**Impact on plan:** No scope creep; the fix corrected the executor's own test-writing mistake within the same task before it was ever part of a merged baseline.

## Issues Encountered
- `npx tsc --noEmit` (full repo) surfaces ~25 pre-existing type errors in `tests/payment-reconciliation.integration.test.ts`, `tests/paystack-webhook.integration.test.ts`, `tests/refund.integration.test.ts`, `tests/schema-payment-split.test.ts`, and `tests/support/cohort-fixtures.ts` — all referencing Prisma fields not present on this worktree's generated client (e.g. `platformGrossActualMinor`, `gatewayFeeSchedule`, `reconciledAt`). None of these files were touched by this plan (`git status --short` showed only this plan's own new files throughout), and grepping the `tsc` output for the three new modules' filenames returns nothing. Logged to `.planning/phases/09-learning-delivery-progress-tracking/deferred-items.md` per the executor's scope-boundary rule rather than fixed — almost certainly Phase 8 (Finance Reconciliation) schema work landing on a sibling branch/worktree not yet reflected here. `npx tsc --noEmit` targeted at just this plan's three files (via grep-filtering the output) returns clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `evaluateLessonSequencing`/`isLessonUnlocked` are ready for plan 09-04's two call sites (lesson-list render, lesson-reading server gate) and for the lesson-progress-service's D-16 cascade re-lock.
- `parseCompletionRule`/`evaluateCompletion` are ready for `completion-service.ts` (plan 09-03/09-04 per the pattern map) to wire into the reactive, same-transaction recalculation triggered by `LessonProgress` writes and the `"attendance changed"` `DomainEvent`.
- No blockers for this plan's own scope. The pre-existing, unrelated `tsc` failures (see Issues Encountered) should be resolved by whichever phase/branch owns the Phase 8 schema migration — not a blocker for Phase 9's own work.

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-14*

## Self-Check: PASSED

All 7 claimed files verified present on disk (3 implementation modules, 2 test files, deferred-items.md, this SUMMARY.md). All 6 claimed task commits (`a245500`, `811b36e`, `8f2f3a4`, `5bf44cc`, `b3ad20d`, `46e8242`) verified present in `git log --oneline --all`. No missing items.
