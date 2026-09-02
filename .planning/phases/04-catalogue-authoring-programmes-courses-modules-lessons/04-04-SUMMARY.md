---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 04
subsystem: api
tags: [prisma, resource-service, zod, sanitize-html, rbac, positions, tdd]

# Dependency graph
requires:
  - phase: 04-catalogue-authoring-programmes-courses-modules-lessons
    provides: >-
      createResourceService's async toScope / archiveData / restoreData /
      runInTransaction surface (04-03) and src/lib/positions.ts's two-band
      convention (04-03), the schema delta's withdrawnAt/publication fields
      (04-02), and src/lib/sanitize.ts's sanitizeLessonBody (04-01)
provides:
  - "programmeService (list/get/create/update/archive) plus addCourseToProgramme / removeCourseFromProgramme membership ops — Course is referenced, never cloned (CAT-02)"
  - "moduleService / lessonService built on the widened factory, with withdraw-parks / restore-appends position mechanics and parent-resolved scope (Lesson -> Module -> Course)"
  - "createModule, createLesson, updateLesson — the only write paths any UI may call; each computes position server-side and (for Lesson) validates through parseLessonInput"
  - "src/lib/embed-url.ts — exact-host allow-list + https-only validation for Lesson.embedUrl / Lesson.linkUrl"
  - "src/lib/lesson-input.ts — lessonInputSchema, the single validated shape for a Lesson write (sanitised body, validated URLs, per-type cross-field rules)"
  - "LoadedCourseTree type + loadCourseTree(courseId) — the aggregate later plans (04-06, 04-08, 04-09, 04-12) load"
affects: [04-05, 04-06, 04-07, 04-08, 04-09, 04-12, 04-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injectable-dependency service factories (createProgrammeMembershipOperations, createModuleService, createLessonService) — a factory function taking { delegate, withPermission, audit, runInTransaction } instead of a bare export bound to the real Prisma client, so tests supply an in-memory fake delegate exactly like tests/resource-service.test.ts's own harness, with no database required"
    - "Position computation always happens inside the same unit of work as the sibling read (an injected runInTransaction wrapping read-siblings + compute + insert/update), never derived from a caller-supplied value or a row count"
    - "archiveData reads min(position) across ALL siblings (including already-withdrawn); restoreData/create read max(position) across LIVE siblings only — the deliberate asymmetry that prevents both withdraw-collision and restore-collision, applied identically across Module and Lesson"
    - "A Lesson's authorization scope resolves through two chained lookups (Lesson -> Module -> Course) via an injected resolveCourseIdForModule function, so production can use one nested Prisma query while tests use a simple in-memory lookup"
    - "The validated-write wrapper (createLesson/updateLesson) is the only exported write entry point; the factory's raw create/update stay unreferenced by any call site outside this pattern"

key-files:
  created:
    - src/server/services/programme-service.ts
    - src/server/services/module-service.ts
    - src/server/services/lesson-service.ts
    - src/lib/embed-url.ts
    - src/lib/lesson-input.ts
    - tests/programme-service.test.ts
    - tests/module-lesson-service.test.ts
    - tests/embed-url.test.ts
  modified: []

key-decisions:
  - "Membership/scope-resolving logic (addCourseToProgramme/removeCourseFromProgramme, moduleScope+archive/restore, lessonScope+archive/restore) is built via an exported factory function (createXService) taking injectable deps, rather than a bare module-scope export bound to the real prisma client — this is what makes the position-parking asymmetry and the cross-course-denial scope resolution testable without a database, mirroring tests/resource-service.test.ts's own fake-delegate harness"
  - "createLesson's position logic and createLesson/updateLesson's parseLessonInput validation are the same function across what the plan splits into Task 2 and Task 3 — Task 2 built createLesson with position computation; Task 3 layered parseLessonInput onto it and added updateLesson, rather than creating a second exported entry point, per the plan's own instruction that the raw factory create/update must never be the path any UI calls"
  - "updateLesson validates through a separate lessonUpdateSchema (base schema with moduleId/title/type relaxed to optional via .partial()) rather than reusing the create schema's cross-field superRefine, since .superRefine() returns a ZodEffects wrapper that .partial() cannot be called on — kept as one base ZodObject with two derived views (full schema with cross-field refinement for create, .partial() for update)"
  - "removeCourseFromProgramme is the one hard-delete path in the project (ProgrammeCourse holds no history — the Course on either end survives, and the historical record of Programme membership lives in ProgrammePublication.payload, not this join table), documented inline against the project-wide archive-never-delete rule per the plan's explicit instruction"
  - "loadCourseTree and the Programme CRUD/archive default path use the real prisma client directly (no injectable wrapper) since neither has a behavior test requiring database-independent verification — only the pieces with position/scope logic (membership ops, moduleScope/lessonScope, archive/restore, createModule/createLesson) needed the injectable-factory pattern"

patterns-established:
  - "A parent-resolved-scope resource service (Module, Lesson) never trusts a caller-supplied parent id; it queries for it every time inside toScope, matching Pitfall 9 from 04-RESEARCH.md and T-04-11's mitigation"
  - "Every create/restore path computes position from a live-sibling query inside one transaction, imported from src/lib/positions.ts — never from a caller value, never from a row count"

requirements-completed: [CAT-02, CAT-03, CAT-04]

# Metrics
duration: ~30min
completed: 2026-09-02
---

# Phase 04 Plan 04: Programme, Module and Lesson Services Summary

**Three write-path services (Programme with reference-only Course membership, Module, and Lesson) built on the widened `createResourceService` factory, with server-computed positions, withdraw-parks/restore-appends mechanics, parent-resolved authorization scope, and — for Lesson — sanitised body plus allow-listed embed/link URLs.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-02T19:17:00+01:00 (approx, worktree branch-check/reset)
- **Completed:** 2026-09-02T20:33:04+01:00
- **Tasks:** 3/3
- **Files modified:** 8 (all created, 0 modified — this plan only added new files)

## Accomplishments
- `programmeService` (list/get/create/update/archive) plus `addCourseToProgramme`/`removeCourseFromProgramme`, proven by test to add a Course to a second Programme without creating a second `Course` row (CAT-02), and to leave the join table's own hard-delete as the single documented exception to the archive-never-delete rule
- `moduleService`/`lessonService` with async `archiveData`/`restoreData`: withdrawal parks at `min(position)` across ALL siblings (including already-withdrawn), restore appends at `nextAppendPosition(max(position))` across LIVE siblings only — proven by test that two consecutive withdrawals from the same parent never collide, and that a create after withdrawing a middle row lands clear rather than reusing the freed slot
- `lessonScope` resolves through a `Lesson -> Module -> Course` chain, proven by test that a COURSE-scoped grant on one Course cannot reach a Lesson in another
- `src/lib/embed-url.ts`: `parseEmbedUrl`/`parseLinkUrl`, exact-host allow-list (5 hosts) for embeds, https-only for both, `new URL()` parsing (never a regex/substring host check) so `youtube.com.evil.example` is rejected
- `src/lib/lesson-input.ts`: `lessonInputSchema` sanitises `body` via `sanitizeLessonBody` in the zod transform, validates `embedUrl`/`linkUrl`, rejects a `position` key outright via `.strict()`, and cross-field-requires `embedUrl`/`linkUrl`/`body` per `LessonType` while leaving QUIZ/ASSIGNMENT free of any requirement beyond a title (D-31)
- `createLesson`/`updateLesson` are wired as the only exported write entry points for Lesson — the raw factory `create`/`update` are never called from any other module in this plan
- Full pre-existing suite plus all new tests green: 194 tests across 16 files (up from 174/15 baseline after 04-01/04-02/04-03), `npx eslint .` clean, `npx tsc --noEmit` shows only the pre-existing unrelated `src/app/layout.tsx` `LayoutProps` error

## Task Commits

Each task was committed atomically:

1. **Task 1: Programme service and reference-only Course membership** - `182ce14` (feat)
2. **Task 2: Module and Lesson services with parent-resolved scope and withdraw/restore** - `9e70a08` (feat)
3. **Task 3: Lesson write validation — sanitised body, allow-listed embed and link URLs** - `b55d6bf` (feat)

_No separate plan-metadata commit — this is a worktree-isolated parallel execution; the orchestrator makes the final metadata commit after merge._

## Files Created/Modified
- `src/server/services/programme-service.ts` - Programme CRUD + `addCourseToProgramme`/`removeCourseFromProgramme`, `DuplicateMembershipError`
- `src/server/services/module-service.ts` - Module CRUD + `createModule`, `listActiveModules`/`listWithdrawnModules`, withdraw/restore position mechanics
- `src/server/services/lesson-service.ts` - Lesson CRUD + `createLesson`/`updateLesson`, `listActiveLessons`/`listWithdrawnLessons`, `loadCourseTree`/`LoadedCourseTree`
- `src/lib/embed-url.ts` - `parseEmbedUrl`, `parseLinkUrl`, `EMBED_HOST_ALLOWLIST`
- `src/lib/lesson-input.ts` - `lessonInputSchema`, `parseLessonInput`, `parseLessonUpdateInput`
- `tests/programme-service.test.ts` - 10 tests covering every Task 1 `<behavior>` bullet
- `tests/module-lesson-service.test.ts` - 19 tests covering every Task 2 `<behavior>` bullet
- `tests/embed-url.test.ts` - 20 tests covering every Task 3 `<behavior>` bullet

## Decisions Made
- Built `createProgrammeMembershipOperations`/`createModuleService`/`createLessonService` as exported factory functions taking injectable `{ delegate, withPermission, audit, runInTransaction }` rather than bare module-scope exports bound to the real Prisma client — this is what let the position-parking asymmetry (archive vs. restore) and the parent-resolved-scope denial tests run without a database, in the same spirit as `tests/resource-service.test.ts`'s own fake-delegate harness.
- Task 2 already built `createLesson` with full position-computation logic (needed for the "create after withdrawing a middle Lesson" test in that task); Task 3 layered `parseLessonInput` onto the same function and added `updateLesson`, rather than introducing a second exported entry point — consistent with the plan's instruction that the raw factory `create`/`update` must never be the path any UI calls.
- `updateLesson` validates through a `.partial()` view of the base (pre-refinement) Lesson schema rather than the full `lessonInputSchema`, because `.superRefine()` returns a `ZodEffects` wrapper that does not expose `.partial()`. Kept as one base `ZodObject` with two derived views: the full schema (with cross-field refinement) for create, `.partial()` for update.
- `loadCourseTree` and the Programme CRUD/archive default path (status: "ARCHIVED", unchanged from the factory default) use the real `prisma` client directly rather than the injectable-factory pattern, since neither has a `<behavior>` bullet requiring database-independent verification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree HEAD was on a stale base missing Wave 1's merge**
- **Found during:** Setup, before Task 1
- **Issue:** The worktree branch's HEAD (`0d8b501`) predated the Wave 1 merge commit (`8d0f152`) that the wave-1 context promised was already present — `resource-service.ts`'s widened `toScope`/`archiveData`/`restoreData` and `src/lib/positions.ts` were missing.
- **Fix:** Ran the mandated `git merge-base` check, confirmed it did not equal the expected base, and ran `git reset --hard 8d0f152328a9049da9786e427fcd6a481c317b8e` per the branch-check protocol. Only an untracked, non-plan `.claude/` directory was present before the reset — no work was lost.
- **Files modified:** none (a branch-pointer move, not a content edit)
- **Verification:** `git rev-parse HEAD` matched the expected commit; `src/server/services/resource-service.ts` and `src/lib/positions.ts` were present and matched the Wave 1 summaries afterward.
- **Committed in:** not applicable — a `git reset`, nothing to commit.

**2. [Rule 2 - Missing Critical] Added 2 extra test cases to module-lesson-service.test.ts to reach the plan's stated 19-`it`-block minimum**
- **Found during:** Task 2 acceptance-criteria check
- **Issue:** The initial 17 `it` blocks covered every `<behavior>` bullet but fell short of the plan's explicit "at least 19 `it` blocks" acceptance criterion.
- **Fix:** Added two tests asserting `createModule`/`createLesson` reject an input carrying a `position` key (`.strict()` schema rejection) rather than silently dropping it — a real gap in explicit coverage, not padding, since T-04-14b's mitigation depends on rejection being enforced, not merely on the field being absent from the type.
- **Files modified:** `tests/module-lesson-service.test.ts`
- **Verification:** `grep -c '  it(' tests/module-lesson-service.test.ts` returns 19; both new tests pass.
- **Committed in:** `9e70a08` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking setup correction, 1 missing test coverage)
**Impact on plan:** No scope creep — both fixes were prerequisites for meeting the plan's own stated bar (the wave-1 context's promised base, and the plan's own acceptance-criteria test count).

## Issues Encountered
None beyond the deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `LoadedCourseTree`/`loadCourseTree` are ready for plans 04-06 (arrange UI), 04-08 (publish), 04-09, and 04-12 to import directly rather than re-deriving the aggregate shape.
- `createModule`/`createLesson`/`updateLesson` are ready for the staff authoring UI (plan 04-06) to call — none of them accept a client-supplied `position`, so the UI's drag-and-drop reorder (04-05) is free to own that surface exclusively.
- `moduleService.restore`/`lessonService.restore` are ready for the withdrawn-items collapsed section (D-34, plan 04-06) to call.
- No blockers for sibling plans 04-05/04-06 in this wave; this plan touched only its declared `files_modified` and did not modify `reorder-service.ts`, `publication.ts`, `readiness-service.ts`, or `tests/support/pg.ts`.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-02*

## Self-Check: PASSED

- FOUND: src/server/services/programme-service.ts
- FOUND: src/server/services/module-service.ts
- FOUND: src/server/services/lesson-service.ts
- FOUND: src/lib/embed-url.ts
- FOUND: src/lib/lesson-input.ts
- FOUND: tests/programme-service.test.ts
- FOUND: tests/module-lesson-service.test.ts
- FOUND: tests/embed-url.test.ts
- FOUND commit: 182ce14 (Task 1)
- FOUND commit: 9e70a08 (Task 2)
- FOUND commit: b55d6bf (Task 3)
