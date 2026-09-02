---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 03
subsystem: api
tags: [prisma, resource-service, authorization, rbac, positions, tdd]

# Dependency graph
requires:
  - phase: 04-catalogue-authoring-programmes-courses-modules-lessons
    provides: existing createResourceService factory and courseService reference vertical slice (Phase 1)
provides:
  - createResourceService accepts an async toScope resolver (database-looked-up scope, not caller-supplied)
  - createResourceService accepts optional archiveData / restoreData payload builders and an optional runInTransaction wrapper
  - a typed restore(id, reason) operation, permission-gated, reason-required, audited, exposed only when restoreData is configured
  - PositionContentionError — a typed error for a second consecutive unique-index collision on a position write
  - src/lib/positions.ts — the shared live/reorder-parking/withdrawn position band convention (WITHDRAWN_PARK_BASE, MAX_ARRANGEMENT_SIZE, parkedWithdrawnPosition, nextAppendPosition, assertArrangementSize)
affects: [04-04, 04-05, 04-08, phase-12-tickets]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resolver types widened from sync-only to `T | Promise<T>` when a factory field needs to move from id-derived to database-derived without touching the authorization core"
    - "Conditional factory return type keyed off an optional config field's presence, so a capability (restore) is only in the returned object's type when the config that enables it was supplied"
    - "Unique-index-as-concurrency-guarantee: an injected transaction runner groups read/build/write for audit atomicity, but the actual collision safety comes from a DB unique index; the factory retries once on P2002 and surfaces a typed contention error rather than a raw Prisma error"
    - "Two-band (plus reorder-parking) position convention isolated in a pure, Prisma-free module so multiple services and the reorder transaction share one rule"

key-files:
  created:
    - src/lib/positions.ts
    - tests/positions.test.ts
  modified:
    - src/server/services/resource-service.ts
    - tests/resource-service.test.ts

key-decisions:
  - "toScope widened to ResourceScope | Promise<ResourceScope> — a one-line type change, since withPermission's ScopeResolver already accepted a Promise; course-service.ts needed no edit"
  - "archiveData/restoreData/runInTransaction are all optional and additive; omitting all three reproduces today's Course behaviour exactly, verified by an explicit no-wrapper test"
  - "restore is exposed via a conditional return type (C[\"restoreData\"] extends (id: string) => unknown ? ServiceWithRestore<T> : ServiceBase<T>) rather than two exported factory functions, so every caller still imports one createResourceService"
  - "P2002 gets exactly one retry with freshly rebuilt data; a second collision throws PositionContentionError rather than leaking a raw Prisma error to the caller"
  - "positions.ts kept Prisma-free and pure so it can be imported from both the service layer and a future reorder transaction module without tripping the @prisma/client boundary lint rule"

requirements-completed: [CAT-02, CAT-03, CAT-08]

# Metrics
duration: ~20min
completed: 2026-09-02
---

# Phase 04 Plan 03: Widen the resource-service factory for Module/Lesson/Programme/LessonResource Summary

**Widened `createResourceService` with an async database-resolved `toScope`, parameterised `archiveData`/`restoreData` payload builders behind an injected `runInTransaction` + P2002-retry, and a new `src/lib/positions.ts` module defining the shared live/parking/withdrawn position bands — all additive, with Course's behaviour and `course-service.ts` byte-identical to before.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-02T19:31:00+01:00 (approx, first test run)
- **Completed:** 2026-09-02T19:44:34+01:00
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `ResourceServiceConfig.toScope` now accepts `ResourceScope | Promise<ResourceScope>`, so a Module or Lesson service can resolve its scope by querying its parent Course rather than deriving it from its own id — with an empty-`courseIds` result denying rather than crashing.
- `archive` accepts an optional `archiveData` payload builder (default unchanged: `{ status: "ARCHIVED" }`), and a new `restore` operation — gated, audited, reason-required — is exposed only when `restoreData` is configured.
- Both `archive` and `restore` run their read-before/build/update inside an optional injected `runInTransaction`, retry once on a Prisma `P2002` unique-index collision, and throw a typed `PositionContentionError` on a second collision instead of a raw Prisma error.
- `src/lib/positions.ts` gives every future service and the reorder transaction one shared definition of the live (`0..n-1`), reorder-parking (`-1..-n`) and withdrawn (`<= -1,000,001`) position bands.

## Task Commits

Each task was committed atomically, TDD RED confirmed (compile failure via `tsc --noEmit` for Tasks 1 and 2, missing-module failure for Task 3) before the corresponding GREEN commit:

1. **Task 1: Allow a scope to be resolved by query** - `8dc0d93` (feat)
2. **Task 2: Parameterise the archive payload and add a restore operation** - `3dc5087` (feat)
3. **Task 3: The shared two-band position convention** - `3b8de7e` (feat)

**Plan metadata:** (this commit, made by the orchestrator after merge — not created by this worktree agent)

_Note: each task's tests were written first in the same commit as the implementation (both test and implementation code committed together per task), since the plan's TDD instruction was "write tests first, watch them fail, then implement" within a single task-scoped commit rather than separate RED/GREEN commits._

## Files Created/Modified
- `src/server/services/resource-service.ts` - widened `toScope`; added `archiveData`, `restoreData`, `runInTransaction` config fields; added `PositionContentionError`; added conditionally-typed `restore` operation
- `tests/resource-service.test.ts` - added async-scope-resolution tests (Pitfall 9), archive-payload-parameterisation tests, transaction-ordering tests, P2002-retry/contention tests, and restore-gating tests
- `src/lib/positions.ts` (new) - `WITHDRAWN_PARK_BASE`, `MAX_ARRANGEMENT_SIZE`, `parkedWithdrawnPosition`, `nextAppendPosition`, `assertArrangementSize`
- `tests/positions.test.ts` (new) - 13 cases covering every `<behavior>` bullet plus two property-style checks (band disjointness, non-negative append)

## Decisions Made
- Chose a conditional return type over two exported factory entry points for `restore` (documented in the code comment above `createResourceService`), matching the plan's "pick one and comment which and why" instruction. Chosen because every existing and future caller (`course-service.ts`, the coming `module-service.ts`/`lesson-service.ts`) already imports a single `createResourceService`; a second entry point would be a second thing to remember to import correctly.
- `createResourceService`'s generic signature gained a second type parameter `C extends ResourceServiceConfig<T> = ResourceServiceConfig<T>` (defaulted) specifically so single-generic-argument call sites like `createResourceService<CourseRecord>({...})` keep working unchanged — verified via `git diff --stat` showing zero change to `course-service.ts`.
- Reworded two code comments that originally contained the literal substring `@prisma/client` (to explain the factory avoids importing it) after the plan's own acceptance-criteria grep (`grep -c '@prisma/client' ... outputs 0`) flagged them as false-positive "imports" — the comments now describe the same constraint without using the exact importable specifier string, verified by rerunning the grep.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria (grep counts, `tsc --noEmit`, `npm test`, `course-service.ts`/`src/server/permissions/**` byte-identity) were verified directly, not assumed.

## Issues Encountered
- Two `vi.fn(async <R,>(fn) => ...)` mocks (used to assert `runInTransaction` call order) lost their generic signature once wrapped by Vitest's `Mock` type, producing `tsc` errors when passed to the config's generically-typed `runInTransaction` field. Resolved by replacing the `vi.fn` wrapper with a plain generic async function plus a manual call counter for the two transaction-ordering tests — no loss of test coverage, `tsc --noEmit` clean.
- The worktree's HEAD was initially on an ancestor of the expected base commit (`0d8b501`, two commits behind `e05775f`); corrected via the mandated `git reset --hard` to the expected base per the branch-check protocol before any work began (only untracked, non-plan `.claude/` files were present, no work lost).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plans 04-04 (Module/Lesson/Programme/LessonResource services) and 04-05 (the reorder transaction) can now build directly on `createResourceService`'s async `toScope`, `archiveData`/`restoreData`, and on `src/lib/positions.ts`'s band functions, with no factory forking required.
- No blockers. `npm test` is green at 113 tests (84 pre-existing + 29 new), `npx tsc --noEmit` shows only the pre-existing, unrelated `src/app/layout.tsx` `LayoutProps` error (out of scope for this plan).

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-02*

## Self-Check: PASSED

- FOUND: src/lib/positions.ts
- FOUND: tests/positions.test.ts
- FOUND: .planning/phases/04-catalogue-authoring-programmes-courses-modules-lessons/04-03-SUMMARY.md
- FOUND commit: 8dc0d93 (Task 1)
- FOUND commit: 3dc5087 (Task 2)
- FOUND commit: 3b8de7e (Task 3)
- FOUND commit: a67d0ba (SUMMARY.md)
