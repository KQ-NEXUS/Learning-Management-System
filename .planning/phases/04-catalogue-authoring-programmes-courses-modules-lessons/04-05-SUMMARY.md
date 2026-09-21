---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 05
subsystem: database
tags: [prisma, postgresql, testcontainers, transactions, positions, reorder, tdd]

# Dependency graph
requires:
  - phase: 04-catalogue-authoring-programmes-courses-modules-lessons
    provides: "src/lib/positions.ts's live/parking/withdrawn band convention (04-03) and the confirmed-still-an-index position uniqueness (04-02)"
provides:
  - "src/server/services/reorder-service.ts — commitModuleOrder, commitLessonOrder, commitProgrammeCourseOrder, each a two-pass negative-offset transaction, each permission-gated, each refusing a stale or foreign/incomplete arrangement"
  - "tests/support/pg.ts — startTestDatabase()/TEST_DB_TIMEOUT_MS, a Testcontainers postgres:16-alpine harness running the checked-in migrations, reusable by any future plan needing real-Postgres semantics tests"
  - "Proof, against a real Postgres, that the two-pass reorder does not trip the real unique indexes and that it never touches a withdrawn row's parked slot"
affects: [04-06, 04-07, 04-08, staff-reorder-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-pass negative-offset reorder inside one $transaction: pass one parks every affected live row at -position-1 (a slot no committed row occupies), pass two writes the final arrangement — proven necessary because a single per-row UPDATE can violate a non-deferrable unique index mid-statement, and SET CONSTRAINTS ALL DEFERRED is a no-op against Prisma's CREATE UNIQUE INDEX"
    - "createReorderService(config) factory pattern: injects { db, withPermission, audit } so the same operations can be bound to a fake in-memory db for unit tests (tests/reorder.test.ts), a real Postgres via Testcontainers for integration tests (tests/reorder.integration.test.ts), and the live Prisma client + session withPermission for production (the file's own commitModuleOrder/commitLessonOrder/commitProgrammeCourseOrder exports)"
    - "Ownership+completeness verified both as a count and as a set against a live-only findMany, never a client-trusted count — catches a foreign id, an omitted live child, a duplicate, and (because the query is live-only) an included withdrawn id, all through one check"
    - "Optimistic concurrency via a single conditional updateMany on updatedAt, never read-then-compare in JS"
    - "serialiseOrderToken/parseOrderToken via Date.getTime()/new Date(ms) so the updatedAt order token round-trips at millisecond precision without the toISOString() truncation trap"

key-files:
  created:
    - src/server/services/reorder-service.ts
    - tests/reorder.test.ts
    - tests/support/pg.ts
    - tests/reorder.integration.test.ts
  modified: []

key-decisions:
  - "Structured reorder-service.ts as an injectable-dependency factory (createReorderService) with production-bound commitModuleOrder/commitLessonOrder/commitProgrammeCourseOrder exported alongside it — required by the plan's own instruction that Task 2's tests use no database at all, while the file itself is free to import prisma directly (src/server/services/** is exempt from the @prisma/client ESLint boundary)"
  - "Ownership/completeness check queries the parent's current live children via findMany (not a raw count) and compares both array length and set membership against the payload — directly satisfies the plan's 'both as a count and as a set' instruction and, as a side effect, supplies the 'before' ordered id list the audit entry needs"
  - "Task 3's withdraw/restore cases (10-13) do not call lessonService.archive/.restore as the plan's action text describes — see Deviations below"
  - "TEST_DB_TIMEOUT_MS = 180_000 passed explicitly to both beforeAll and afterAll in the integration suite; a first-run image pull plus migrate deploy measured at ~28s import + ~60s test time in this environment, comfortably inside the budget"

patterns-established:
  - "Testcontainers Postgres harness (tests/support/pg.ts) is the template for any future plan needing to prove real-index or real-constraint semantics rather than mocked ones"

requirements-completed: [CAT-02, CAT-03]

# Metrics
duration: ~75min
completed: 2026-09-02
---

# Phase 04 Plan 05: Whole-List Reorder and the Real-Postgres Test Harness Summary

**Two-pass negative-offset reorder transaction (`commitModuleOrder`/`commitLessonOrder`/`commitProgrammeCourseOrder`) plus a Testcontainers `postgres:16-alpine` harness, together proving — against the real unique indexes, not a mock — that a whole-list rearrangement, a cross-module lesson move, and a stale-token race all behave exactly as CAT-03 requires.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-09-02T20:15Z (worktree branch-check start, including a base-mismatch correction)
- **Completed:** 2026-09-02T21:30Z
- **Tasks:** 3/3 completed
- **Files modified:** 4 (all created)

## Accomplishments
- `src/server/services/reorder-service.ts`: three transactional operations, each gated (`courses.edit` for Module/Lesson, `programmes.manage` for ProgrammeCourse), each refusing a stale `updatedAt` token (`StaleOrderError`) or a foreign/incomplete/withdrawn/duplicate arrangement (`ArrangementMismatchError`) before any write
- `tests/reorder.test.ts`: 18 unit tests against an in-memory fake `ReorderDb`/`ReorderTx` — every `<behavior>` bullet from the plan covered, TDD RED confirmed by temporarily removing the implementation and observing the expected "cannot find module" failure before restoring it
- `tests/support/pg.ts`: `startTestDatabase()` starts a real `postgres:16-alpine` container, runs `prisma migrate deploy` against the checked-in migrations (never a schema-sync shortcut), and returns a connected `PrismaClient`
- `tests/reorder.integration.test.ts`: 13 integration tests against that real Postgres — full reversal, rotation, a cross-module move, Module and ProgrammeCourse reversal, a stale-token loser, the `updatedAt` token round trip read from the database, a foreign-course id, an omitted lesson, and four withdrawn/restore cases — all 13 pass
- Full suite (`npx vitest run`, both projects) green at 15 files / 176 tests after this plan, up from 94/11 at the start of Phase 4
- `npx eslint .` clean across the whole repository; `npx tsc --noEmit` shows no reorder-related errors

## Task Commits

Each task was committed atomically; Task 2's TDD RED/GREEN split into two commits:

1. **Task 1: Testcontainers Postgres harness** - `ad9ec3a` (feat)
2. **Task 2: The two-pass reorder service** - `bcc3e9e` (test, RED — confirmed failing on the missing module) then `3a9d7ce` (feat, GREEN — all 18 unit tests pass)
3. **Task 3: Integration tests against a real Postgres** - `5fff55e` (test)

_No separate plan-metadata commit — this is a worktree-isolated parallel execution; the orchestrator makes the final metadata commit after merge._

## Files Created/Modified
- `src/server/services/reorder-service.ts` - `StaleOrderError`, `ArrangementMismatchError`, `planTwoPass`, `serialiseOrderToken`/`parseOrderToken`, `createReorderService` factory, and the three production-bound operations
- `tests/reorder.test.ts` - 18 unit tests against a fake in-memory db (no database)
- `tests/support/pg.ts` - `startTestDatabase()`/`TEST_DB_TIMEOUT_MS`, the Testcontainers harness
- `tests/reorder.integration.test.ts` - 13 integration tests against a real `postgres:16-alpine`

## Decisions Made
- `createReorderService(config)` factory over three standalone exported functions, so the identical logic binds to a fake db (unit), a real Postgres (integration), and the live Prisma client + session `withPermission` (production) without duplicating the transaction bodies. Matches `resource-service.ts`'s own precedent of injecting `runInTransaction` for testability.
- The ownership+completeness check reads the parent's current live children via `findMany` (id list, ordered by position) rather than a bare `count`, so the same query both proves completeness (count) and membership (set), and supplies the "before" ordered id list the audit entry requires — the plan's action text asked for "both a count and a set" without specifying the query shape, and this shape gets both from one round trip.
- `execFileSync("npx", [...], { shell: true })` rather than a bare `execFileSync("npx", [...])` in `tests/support/pg.ts`, because a plain `execFileSync` cannot resolve `npx.cmd` on Windows (this environment) without a shell — a portability fix within Task 1's own scope, not a deviation from the plan's intent (still `execFileSync`, still `migrate deploy`, never `db push`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Withdraw/restore cases (10-13) do not call `lessonService.archive`/`.restore`**
- **Found during:** Task 3, before writing the withdrawn/restore test cases
- **Issue:** The plan's action text says to withdraw a lesson "through `lessonService.archive`... NOT by writing `withdrawnAt` directly." `src/server/services/lesson-service.ts` is plan 04-04's output — a sibling plan running in parallel in a separate, isolated worktree in the same wave, not listed in this plan's `depends_on` (`["04-01","04-02","04-03"]`), and explicitly off-limits for this worktree to create or edit (04-05's spawn instructions name `lesson-service.ts` as a file belonging to a sibling plan). The module does not exist in this worktree.
- **Fix:** Added `withdrawLesson`/`restoreLesson` test-local helpers in `tests/reorder.integration.test.ts` that call the exact same pure functions lesson-service's `archiveData`/`restoreData` hooks will call — `parkedWithdrawnPosition`/`nextAppendPosition` from `src/lib/positions.ts` — computing the same parked/appended position via the same band contract, and writing it through `prisma.lesson.update`. This is not "writing `withdrawnAt` directly" in the sense the plan warns against (a bare `{ withdrawnAt: null }` payload that ignores position); it reproduces the real band-contract computation, so the resulting row is byte-identical to what `lessonService.archive`/`.restore` will produce once 04-04 merges. The file's header comment documents this explicitly.
- **Files modified:** `tests/reorder.integration.test.ts` only
- **Verification:** All four withdraw/restore integration cases (10-13) pass against the real Postgres container; case 10 asserts the withdrawn row's position, moduleId and withdrawnAt are byte-identical before and after a live reorder; case 12 asserts the restored row lands at position 2 (the correct append slot) with no unique violation.
- **Committed in:** `5fff55e` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — missing sibling-plan dependency)
**Impact on plan:** The integration suite still proves the exact behaviour the plan cares about (a live reorder leaves a withdrawn row's parked slot untouched; a restore appends cleanly) against the real unique index. No `withdrawnAt` was ever written without going through the band-contract functions. Once plan 04-04 merges `lesson-service.ts` into the shared branch, a follow-up could swap these two helpers for direct `lessonService.archive`/`.restore` calls with no change to the assertions — left as a note for whoever next touches this file, not a blocker.

## Known Plan-Verification-Script Discrepancy

The plan's top-level `<verification>` section states `grep -ri 'set constraints' src/` returns nothing — an unfiltered check. `reorder-service.ts`'s header comment, per Task 2's own explicit instruction ("Put all three prohibitions in a header comment... so the next reader does not re-derive them"), names `SET CONSTRAINTS` twice in prose explaining why it must never be used. Task 2's own acceptance criterion is precisely scoped to allow this: `grep -vi '^\s*\*\|^\s*//' src/server/services/reorder-service.ts | grep -ci 'set constraints'` (comments excluded) outputs `0`, confirmed. The unfiltered top-level check would report 2 matches, both inside the mandated explanatory comment, none in executable code. Treated Task 2's specific, deliberately-scoped criterion as authoritative over the coarser plan-level restatement, matching the precedent in 04-02's SUMMARY for an analogous grep-scope discrepancy.

## Issues Encountered
- Worktree HEAD was on a stale ancestor commit (`0d8b501`, missing the three Wave-1 merge commits) at session start. Corrected via the mandated `git reset --hard` to the expected base commit (`8d0f152`) per the branch-check protocol before any work began; only an untracked, non-plan `.claude/` directory was present, no work lost.
- `npx eslint` flagged `no-assign-module-variable` (a Next.js-specific rule) on three `const module = ...` declarations in the integration test file, shadowing the Node.js module-scope `module` binding — renamed to `moduleRow` throughout; no behavioural change.

## User Setup Required

None - no external service configuration required. Docker Desktop must be running for `tests/reorder.integration.test.ts` to execute (confirmed available and used in this session: `docker info` succeeded, and the full container-start-through-13-passing-tests cycle completed in ~88s).

## Next Phase Readiness
- `commitModuleOrder`, `commitLessonOrder`, and `commitProgrammeCourseOrder` are ready for the staff arrange-view UI (plan 04-06 and later, D-19/D-20) to call directly — each already returns `{ moved: number }` and each already audits `module.reordered`/`lesson.reordered`/`programme.reordered` with before/after ordered id lists.
- `tests/support/pg.ts`'s `startTestDatabase()`/`TEST_DB_TIMEOUT_MS` are ready for any later Phase 4 plan (or any future phase) that needs to prove real-index or real-constraint semantics rather than mocked ones — plan 04-08 Task 3 is named in this plan's own action text as an expected consumer.
- Once plan 04-04's `lesson-service.ts` merges into the shared branch, `tests/reorder.integration.test.ts`'s `withdrawLesson`/`restoreLesson` helpers could be swapped for direct `lessonService.archive`/`.restore` calls with no change to any assertion — not a blocker, just a note for whoever next touches this file.
- No blockers for 04-06/04-07/04-08. `npm test` is green at 176 tests across 15 files.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-02*

## Self-Check: PASSED

- FOUND: src/server/services/reorder-service.ts
- FOUND: tests/reorder.test.ts
- FOUND: tests/support/pg.ts
- FOUND: tests/reorder.integration.test.ts
- FOUND: .planning/phases/04-catalogue-authoring-programmes-courses-modules-lessons/04-05-SUMMARY.md
- FOUND commit: bcc3e9e (Task 2 RED)
- FOUND commit: 3a9d7ce (Task 2 GREEN)
- FOUND commit: ad9ec3a (Task 1)
- FOUND commit: 5fff55e (Task 3)
