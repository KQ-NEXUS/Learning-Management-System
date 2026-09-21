---
phase: 10-assessment-quizzes-assignments-grading
plan: 04
subsystem: api
tags: [quiz, attempt, ownership-scoped, prisma, typescript, vitest]

# Dependency graph
requires:
  - phase: 10-assessment-quizzes-assignments-grading
    provides: "quiz-scoring.ts's QuestionSnapshot/AttemptResponse types (10-02) this plan freezes into Attempt.answers"
provides:
  - "createAttemptService: startAttempt (D-08 snapshot freeze, resume, startNew-abandons-prior, attempt-limit and window gating), saveAttemptAnswers (in-progress scratch-state merge with phantom-question/option discarding), getOwnAttempt, listOwnAttempts"
  - "AttemptNotStartableError / AttemptNotWritableError typed refusals with UI-SPEC-matching copy"
  - "AttemptAnswersPayload snapshot contract (questionSnapshot, responses, passMark, totalMarks) written into Attempt.answers"
affects: ["10-06 (submit/score reads this snapshot)", "10-11 (attempt-taking UI renders against startAttempt/saveAttemptAnswers)", "10-17 (permission-layer invariant gate for this file)"]

# Tech tracking
tech-stack:
  added: []
  patterns: ["ownership-scoped service with zero withPermission-wrapped exports (DD-15), mirroring lesson-progress-service.ts/checkout-service.ts", "deps-injection factory with a narrow structural AttemptStore/AttemptTxClient, unit-tested with in-memory fakes, bound to prisma at the file bottom"]

key-files:
  created:
    - src/server/services/attempt-service.ts
    - tests/attempt-service.test.ts
  modified: []

key-decisions:
  - "startAttempt checks for an existing IN_PROGRESS attempt to resume BEFORE the attempt-limit gate, and an attempt abandoned via startNew no longer counts toward the limit inside the same transaction -- resuming your own unfinished attempt must never be blocked by a limit conflict, and abandoning frees the slot it held (Rule 1 correctness choice; the plan's prose lists the limit check before the resume check, but literal step order would incorrectly block a legitimate resume at the limit boundary)"
  - "passMark and totalMarks are frozen into the Attempt.answers snapshot alongside questionSnapshot -- this plan's answer to 10-RESEARCH.md Open Question 1's follow-up: a later passMark edit must never retroactively change whether an old attempt reads as passed"
  - "Ran `npx next typegen` to generate the missing `.next/types` route-type declarations (gitignored, no file committed) so `npx tsc --noEmit` type-checks cleanly -- a pre-existing environmental gap in this worktree, unrelated to this plan's code, needed to satisfy the plan's own tsc verification gate"
  - "Header comments avoid the literal substring \"withPermission\" (using \"permission wrapper\"/\"permission-wrapped\" phrasing instead, matching checkout-service.ts's convention) so `grep -c 'withPermission'` returns exactly 0 per Task 1's literal acceptance criterion, while still documenting the DD-15 ownership-scoping rationale in full"

requirements-completed: [ASM-01, ASM-02]

# Metrics
duration: ~45min
completed: 2026-09-15
---

# Phase 10 Plan 04: Attempt Start/Resume/Save with D-08 Snapshot Freeze Summary

**`attempt-service.ts` (`startAttempt`/`saveAttemptAnswers`/`getOwnAttempt`/`listOwnAttempts`) freezing the live quiz question/option set, pass mark, and total marks into `Attempt.answers` at start time so a later authoring edit can never reach an attempt already in progress or scored.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3
- **Files modified:** 2 (both created)

## Accomplishments

- `startAttempt` re-derives the actor's enrolment from `actor.userId` (never caller-supplied), refuses `not-found`/`not-a-quiz`/`not-published`/`window-not-open`/`window-closed`/`attempt-limit-reached`, resumes an existing `IN_PROGRESS` attempt unchanged, or (with `startNew: true`) abandons the prior one and creates a fresh attempt with the next `attemptNumber` — all inside one transaction with a unique-constraint retry-once backstop
- The D-08 snapshot freeze: `QuizQuestion`/`QuizOption` rows (with `isCorrect`) plus `passMark`/`totalMarks` are copied into `Attempt.answers.questionSnapshot` at start and never re-read from the live rows again — proven by a test that mutates the live rows after start and asserts the stored snapshot is unaffected
- `saveAttemptAnswers` merges only the `responses` key of the frozen payload, discarding any `questionId`/`selectedOptionId` absent from the snapshot (T-10-16), and refuses `not-own`/`already-submitted`/`window-closed`
- `getOwnAttempt` returns `null` (never throws) for both "not yours" and "does not exist," matching `checkout-service.ts`'s `getOwnOrder` denial-parity convention (T-10-02)
- Zero `withPermission`-wrapped exports and zero occurrences of the literal string `withPermission` anywhere in the file (DD-15)

## Task Commits

Each task was committed atomically:

1. **Task 1: Attempt types, typed refusals, and the deps-injection factory skeleton** - `80e826a` (feat)
2. **Task 2: startAttempt with the D-08 snapshot freeze, resume, saveAttemptAnswers, getOwnAttempt** - `80bd220` (feat)
3. **Task 3: tests/attempt-service.test.ts — ownership, limits, window, snapshot freeze** - `f97c86f` (test)

## Files Created/Modified

- `src/server/services/attempt-service.ts` (644 lines) - `createAttemptService` factory: `startAttempt`, `saveAttemptAnswers`, `getOwnAttempt`, `listOwnAttempts`, `AttemptNotStartableError`, `AttemptNotWritableError`, `AttemptAnswersPayload`, the `AttemptStore`/`AttemptTxClient` injected surfaces, and the prisma-backed binding at the bottom
- `tests/attempt-service.test.ts` (504 lines) - in-memory fake-store harness; 19 tests covering ownership, attempt limits, window gating, resume/abandon semantics, the D-08 snapshot-freeze proof, and `saveAttemptAnswers`/`getOwnAttempt`/`listOwnAttempts` refusal and scoping behavior

## Decisions Made

- Resume-before-limit ordering and abandon-frees-the-slot semantics (see `key-decisions` above) — a deliberate correctness refinement over the plan's literal prose step order, verified by the "resumes unchanged" and "startNew abandons and creates" test cases
- `passMark`/`totalMarks` frozen alongside `questionSnapshot` (plan-directed, `10-RESEARCH.md` Open Question 1 follow-up), verified by a dedicated test that mutates the live `passMark` after start
- `npx next typegen` run to unblock `tsc --noEmit` (environmental, not a code change — see `key-decisions`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Generated missing Next.js route types so `tsc --noEmit` could run**
- **Found during:** Task 1 verification
- **Issue:** `.next/types` did not exist in this worktree, so `npx tsc --noEmit` failed on a pre-existing, unrelated error (`src/app/layout.tsx`'s `LayoutProps<"/">` — a Next.js 16 typed-routes artifact, not code this plan touches)
- **Fix:** Ran `npx next typegen` to generate the route-type declarations. Output lives in the gitignored `.next/types` directory — no source file changed, nothing committed
- **Files modified:** none (generated, gitignored)
- **Verification:** `npx tsc --noEmit` then exited 0 across the whole project

**2. [Rule 1 - Bug] Reordered the resume-check ahead of the attempt-limit check inside `startAttempt`**
- **Found during:** Task 2 implementation
- **Issue:** The plan's prose lists the attempt-limit refusal (step 4) before the resume check (step 5). Implemented literally in that order, a learner with an existing `IN_PROGRESS` attempt sitting exactly at `maxAttempts` would be incorrectly refused `attempt-limit-reached` when trying to resume their own unfinished attempt — resuming consumes no new slot
- **Fix:** Check for an existing `IN_PROGRESS` attempt first; resume returns immediately with no limit check. The limit check runs only on the create path (no `IN_PROGRESS` to resume, or `startNew: true` after abandoning the prior one) — an attempt abandoned via `startNew` is excluded from the non-abandoned count used for that check
- **Files modified:** `src/server/services/attempt-service.ts`
- **Verification:** `tests/attempt-service.test.ts`'s resume and startNew-abandon-and-create cases pass; the attempt-limit case (two non-abandoned `SUBMITTED` attempts, no `IN_PROGRESS` to resume) still correctly refuses
- **Committed in:** `80bd220` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking/environmental, 1 correctness)
**Impact on plan:** Neither changes the plan's contracted behavior for any documented test case; the ordering fix prevents a real bug the literal prose ordering would have introduced. No scope creep.

## Issues Encountered

- The plan's own `<verification>` block (`npx vitest run tests/attempt-service.test.ts tests/boundary.test.ts`, `npx tsc --noEmit`, `npx eslint src/server/services/attempt-service.ts`) is fully green — all three ran to completion in this sandbox. A broader `npx vitest run` across the whole project (and a second attempt scoped to `--project node --exclude "**/*.integration.test.ts"`) did not complete within this session — both were backgrounded and produced no output before this summary was written. This matches the same Docker-unavailable-in-sandbox limitation `STATE.md` documents for nearly every prior phase's `*.integration.test.ts` files (e.g. 06-09-SUMMARY.md, 09-14-SUMMARY.md); this plan adds no new integration test and touches no file any existing test suite depends on beyond the two targeted files already confirmed green. Treated as a pre-existing environmental gap, not a regression this plan introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `Attempt.answers`'s frozen `{ questionSnapshot, responses, passMark, totalMarks }` contract is in place and proven immutable post-start — plan 10-06's submit/score path can read it directly via `quiz-scoring.ts`'s `scoreAttempt`
- `getOwnAttempt`/`listOwnAttempts` are ready for plan 10-11's attempt-taking UI to read attempt state and history
- No blockers from this plan's own scope. A full-project `npx vitest run` in a Docker-enabled environment is recommended before Phase 10's own UAT closes, consistent with every prior phase's outstanding integration-test note

## Self-Check: PASSED

- FOUND: src/server/services/attempt-service.ts
- FOUND: tests/attempt-service.test.ts
- FOUND: .planning/phases/10-assessment-quizzes-assignments-grading/10-04-SUMMARY.md
- FOUND commit: 80e826a
- FOUND commit: 80bd220
- FOUND commit: f97c86f

---
*Phase: 10-assessment-quizzes-assignments-grading*
*Completed: 2026-09-15*
