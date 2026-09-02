---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 01
subsystem: testing
tags: [vitest, sanitize-html, tiptap, aws-sdk, pg-boss, clamscan, testcontainers, xss]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: with-permission.ts authorization core (createWithPermission, RawGrant) and resource-service.ts factory that this plan's harness and later plans build on
provides:
  - "Every Phase 4 npm dependency installed at its researched version, none of the rejected alternatives present"
  - "A two-project Vitest config (node + jsdom components) with the node suite unchanged and excluding tests/components/**"
  - "tests/support/harness.ts — shared grant()/createTestWithPermission() for future service tests"
  - "src/lib/sanitize.ts — sanitizeLessonBody, the D-30 allow-list sanitiser, called on both save and render"
affects: [04-02, 04-03, 04-04, 04-05, catalogue-authoring, lesson-body-rendering]

# Tech tracking
tech-stack:
  added: [sanitize-html@2.17.7, "@hello-pangea/dnd@18.0.1", "@tiptap/react@3.31.0", "@tiptap/pm@3.31.0", "@tiptap/starter-kit@3.31.0", zod@4.5.4, "@aws-sdk/client-s3@3.1124.0", "@aws-sdk/lib-storage@3.1124.0", "@aws-sdk/s3-request-presigner@3.1124.0", pg-boss@12.29.0, clamscan@2.4.0, testcontainers, "@testcontainers/postgresql", "@testing-library/react", jsdom, "@vitejs/plugin-react"]
  patterns:
    - "Vitest 4 `test.projects` array (not the Vitest 3 `workspace` shape) splits node-mode and jsdom-mode suites into isolated projects sharing one `@` -> src alias"
    - "sanitize-html configured once, in one module, with the raw IOptions object kept private (not exported) so no caller can widen the allow-list without editing src/lib/sanitize.ts directly"

key-files:
  created:
    - tests/support/harness.ts
    - src/lib/sanitize.ts
    - tests/sanitize.test.ts
  modified:
    - package.json
    - package-lock.json
    - vitest.config.mts

key-decisions:
  - "Task 1 package-legitimacy gate: user approved all 9 unaudited/flagged packages exactly as researched (testcontainers, @testcontainers/postgresql, @testing-library/react, jsdom, @vitejs/plugin-react, @types/sanitize-html, @types/clamscan, clamscan, sanitize-html); no substitutions, no postinstall scripts found on any of them"
  - "vitest.config.mts rewritten against the installed Vitest 4.1.11 projects API (test.projects: TestProjectConfiguration[], each entry a Vite UserConfig with its own top-level plugins/resolve and a nested test block) rather than assuming the Vitest 3 workspace-file shape"
  - "sanitize-html options object (allowedTags/allowedSchemes/transformTags/etc.) is a module-private const, never exported — only sanitizeLessonBody and the frozen LESSON_BODY_ALLOWED_TAGS constant are"

patterns-established:
  - "Shared test harness in tests/support/ for authorization-scoped service tests, generalised from the private grant()/harness() idiom in tests/resource-service.test.ts"
  - "Sanitisation-on-write-and-on-render as a single shared function (sanitizeLessonBody), proven idempotent by test, so the render-time second pass is provably a no-op on already-clean content"

requirements-completed: [CAT-04]

# Metrics
duration: ~35min (Tasks 2-3, this continuation session; Task 1's human-verify gate ran in a prior session)
completed: 2026-09-02
---

# Phase 04 Plan 01: Dependencies, Vitest Split, and D-30 Sanitiser Summary

**Installed all 18 Phase 4 npm packages at researched versions, split Vitest into node/jsdom projects, and shipped a TDD-proven nine-tag allow-list sanitiser (`sanitizeLessonBody`) that strips `javascript:`/`data:`/protocol-relative hrefs, `style` attributes, and `h1`/`script` tags while forcing `rel="noopener noreferrer nofollow"` on every anchor.**

## Performance

- **Duration:** ~35 min (this continuation session covering Tasks 2-3)
- **Completed:** 2026-09-02T20:02Z
- **Tasks:** 3/3 (Task 1 resolved in a prior session; Tasks 2-3 executed in this session)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- All 18 Phase 4 dependencies (11 runtime, 7 dev) installed at exact-minor researched versions; confirmed none of the rejected alternatives (`react-beautiful-dnd`, `@dnd-kit/*`, `isomorphic-dompurify`) are present
- `vitest.config.mts` now declares two projects — `node` (unchanged behaviour, now excludes `tests/components/**`) and `components` (jsdom + `@vitejs/plugin-react`, scoped to `tests/components/**/*.test.tsx`) — verified against the installed Vitest 4.1.11 `projects` type, not assumed from memory
- `tests/support/harness.ts` extracts the `grant()` / `harness()` idiom duplicated across `tests/resource-service.test.ts` and `tests/with-permission.test.ts` into `grant()` and `createTestWithPermission()` for future service tests to reuse (existing test files intentionally left untouched)
- `src/lib/sanitize.ts` ships `sanitizeLessonBody` (D-30) via full TDD: `tests/sanitize.test.ts` written and run RED first, then the implementation made it GREEN — 10 tests covering every `<behavior>` bullet including idempotence
- Full pre-existing suite (94 tests across 11 files, up from 84/10) and `npx eslint .` both pass clean after the change

## Task Commits

Each task was committed atomically:

1. **Task 1: Package legitimacy gate** - human-verify checkpoint, no commit (nothing built; verification only, resolved in prior session — see Deviations/Issues below)
2. **Task 2: Install dependencies and split Vitest into node and component projects** - `a63ceb5` (feat)
3. **Task 3: The D-30 sanitisation allow-list** - `46facd7` (test, RED) then `df76dc9` (feat, GREEN) — no refactor commit needed, implementation was clean at GREEN

## Files Created/Modified
- `package.json` / `package-lock.json` - 18 Phase 4 dependencies added, no rejected alternatives
- `vitest.config.mts` - two-project split (`node`, `components`) on the Vitest 4 `projects` API
- `tests/support/harness.ts` - `grant()`, `createTestWithPermission()` shared test helpers
- `src/lib/sanitize.ts` - `sanitizeLessonBody`, `LESSON_BODY_ALLOWED_TAGS` (D-30/D-29/T-04-03)
- `tests/sanitize.test.ts` - 10 tests, all `<behavior>` bullets covered including idempotence

## Decisions Made
- Task 1 gate: developer approved all 9 unaudited/flagged packages as researched — no substitutions. `sanitize-html` confirmed at 2.17.7 (>= the 2.17.7 floor), and `npm view sanitize-html clamscan testcontainers @testcontainers/postgresql jsdom scripts.postinstall` returned no output, confirming none declares a postinstall script.
- Vitest config written against the actual installed `node_modules/vitest/dist/chunks/reporters.d.*.d.ts` types (`test.projects: TestProjectConfiguration[]`, each item a full Vite `UserWorkspaceConfig` with its own `plugins`/`resolve` and a nested `test` block) rather than assumed from the Vitest 3 `workspace` array-of-globs shape.
- The `sanitize-html` `IOptions` object is kept as a module-private `const`, not exported, per the plan's explicit requirement — only `sanitizeLessonBody` and the frozen `LESSON_BODY_ALLOWED_TAGS` are exported.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Ran `npx prisma generate` before the full-suite verification**
- **Found during:** Task 2 verification (`npx vitest run` — full suite, beyond the plan's required `tests/resource-service.test.ts tests/boundary.test.ts` subset)
- **Issue:** `tests/course-service.test.ts` failed with "`@prisma/client` did not initialize yet" — the fresh worktree's `node_modules/.prisma/client` had the type stubs but no generated client, because a fresh `npm install` on this Prisma version does not regenerate it without an explicit `prisma generate`.
- **Fix:** Ran `npx prisma generate`. It completed cleanly in this session (the resume-instructions warned of a possible Windows `EPERM` file-lock conflict with a `next dev` process in the main checkout, but none occurred here).
- **Files modified:** none tracked by git (`node_modules/.prisma/client` is gitignored generated output)
- **Verification:** Full suite went from 1 failed/9 passed to 10/10 files, 84/84 tests passing (pre-Task-3 baseline), then 11/11 files, 94/94 after Task 3.
- **Committed in:** not applicable — no source files changed, nothing to commit for this fix.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to reach the plan's own `<verification>` bar ("npm test still passes the pre-existing 84 tests"); no scope creep, no source files touched.

## Issues Encountered
None beyond the Prisma-generate deviation above. `testcontainers@12.1.0` printed an `EBADENGINE` warning (wants Node >= 22.22; this environment runs 22.14.0) during `npm install` — a non-fatal warning, not used in this plan (its first consumer is 04-05), left as-is and not treated as a blocker.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `src/lib/sanitize.ts` is ready for the Lesson authoring/render plans (both the Tiptap editor's save path and the learner-facing Server Component render path) to import `sanitizeLessonBody` directly.
- `tests/support/harness.ts` is ready for 04-02 onward's service tests (Programme/Module/Lesson) to import instead of re-deriving `grant()`/`harness()`.
- The `components` Vitest project is ready for the first `.tsx` test under `tests/components/**` (D-19 keyboard reorder, D-26 readiness rendering) — no such file exists yet, which is expected; this plan only stands up the infrastructure.
- No blockers for 04-02/04-03 sibling work (this plan intentionally left `prisma/schema.prisma` and `src/server/services/resource-service.ts` untouched per the resume instructions).

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-02*

## Self-Check: PASSED

- FOUND: tests/support/harness.ts
- FOUND: src/lib/sanitize.ts
- FOUND: tests/sanitize.test.ts
- FOUND: vitest.config.mts
- FOUND commit: a63ceb5 (Task 2)
- FOUND commit: 46facd7 (Task 3 RED)
- FOUND commit: df76dc9 (Task 3 GREEN)
