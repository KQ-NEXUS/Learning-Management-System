---
phase: 10-assessment-quizzes-assignments-grading
plan: 01
subsystem: database
tags: [prisma, postgresql, domain-events, authorization-scope, s3, object-storage]

# Dependency graph
requires:
  - phase: 05-cohorts-scheduling-attendance
    provides: cohort-scope.ts's one-hop resolver shape (mirrored by assessment-scope.ts)
  - phase: 04-catalogue-content
    provides: storage-service.ts's Lesson-scoped key builder/promote pattern (mirrored by the new Submission builders)
provides:
  - AttemptGradingMethod enum and Assessment.attemptGradingMethod column (D-02), migrated to the live database
  - Four new closed DomainEventType members (attempt.submitted, submission.created, grade.released, grade.overridden)
  - assessmentCourseScope resolver for Assessment authoring actions
  - buildSubmissionStorageKey / buildStagedSubmissionStorageKey / finalSubmissionKeyFor storage key builders
affects: [10-02, 10-03, 10-04, 10-05, 10-06, 10-07, 10-08, 10-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One-hop async scope resolver (assessment-scope.ts) mirroring cohort-scope.ts's createXScopeResolvers(deps) factory + deny-by-default {} on a missing row"
    - "Domain-specific staged/final storage key pair (submission-uploads/ -> submissions/) isolated from the Lesson pair (lesson-uploads/ -> lessons/), never a shared generalised promote function"

key-files:
  created:
    - src/server/services/assessment-scope.ts
    - tests/assessment-scope.test.ts
    - tests/submission-storage-keys.test.ts
    - prisma/migrations/20260915124116_add_attempt_grading_method/migration.sql
  modified:
    - prisma/schema.prisma
    - src/server/services/domain-event-service.ts
    - src/server/services/storage-service.ts

key-decisions:
  - "Migration directory timestamp is 20260915124116 (prisma-generated), not the 20260915120000 placeholder named in the plan's frontmatter — expected: prisma migrate dev always stamps its own timestamp, never a hand-picked one"
  - "Ran npx next typegen to generate missing .next/types/*.d.ts (Rule 3 auto-fix) so npx tsc --noEmit could complete — this worktree had never run next dev/build, so the global LayoutProps type Next.js 16 generates did not exist yet; unrelated to any plan file"

patterns-established:
  - "assessmentCourseScope: Assessment authoring actions scope through Assessment.courseId (assessment-scope.ts); grading actions continue to scope through enrolmentCohortScope (cohort-scope.ts) unchanged — two different resolvers for two different trust boundaries per 10-RESEARCH.md Pattern 1"

requirements-completed: [ASM-01, ASM-02, ASM-04, ASM-05, ASM-06]

# Metrics
duration: ~20min
completed: 2026-09-15
---

# Phase 10 Plan 01: Assessment Schema, Domain Events, Scope Resolver & Submission Storage Keys Summary

**Assessment.attemptGradingMethod (D-02) migrated live, four Phase 10 DomainEventType members, assessmentCourseScope authoring resolver, and Submission-scoped storage key builders isolated from the Lesson promote path (T-10-06)**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-09-15
- **Tasks:** 3 completed
- **Files modified:** 7 (2 created service files, 1 modified schema, 2 modified service files, 2 new test files, 1 new migration)

## Accomplishments
- `AttemptGradingMethod` enum (HIGHEST/LATEST/AVERAGE) and `Assessment.attemptGradingMethod` (default HIGHEST) added to the schema, migrated onto the live database, and the Prisma client regenerated with the new field/enum types
- Four new closed `DomainEventType` members added for Phase 10's Attempt/Submission/Grade lifecycle, each with rationale comments distinguishing them from neighbouring event semantics
- `assessment-scope.ts` created, mirroring `cohort-scope.ts`'s one-hop resolver shape: `assessmentCourseScope` reads only `courseId` from the Assessment row and denies by default (`{}`) on a missing row
- Three Submission-scoped storage key builders added to `storage-service.ts`, structurally isolated from the existing Lesson-scoped trio so a staged key from one domain can never promote into the other's final prefix
- Both new modules unit-tested (11 tests); full suite of the plan's four target test files is green (40 tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add AttemptGradingMethod enum and Assessment.attemptGradingMethod to the schema** - `8c82f6e` (feat)
2. **Task 2: Apply the migration to the live database and regenerate the client** - `649164c` (feat)
3. **Task 3: Extend DomainEventType, add assessment-scope.ts, add Submission storage key builders** - `1cac9ec` (feat)

_No TDD tasks in this plan._

## Files Created/Modified
- `prisma/schema.prisma` - `AttemptGradingMethod` enum + `Assessment.attemptGradingMethod` field (D-02)
- `prisma/migrations/20260915124116_add_attempt_grading_method/migration.sql` - checked-in additive migration, applied to the live Neon database
- `src/server/services/domain-event-service.ts` - four new `DomainEventType` union members (attempt.submitted, submission.created, grade.released, grade.overridden)
- `src/server/services/assessment-scope.ts` - new `createAssessmentScopeResolvers`/`assessmentCourseScope` for staff Assessment authoring actions
- `src/server/services/storage-service.ts` - new `buildSubmissionStorageKey`, `buildStagedSubmissionStorageKey`, `finalSubmissionKeyFor`
- `tests/assessment-scope.test.ts` - unit tests for the new scope resolver (known id, missing id, select-shape assertion)
- `tests/submission-storage-keys.test.ts` - unit tests for the new key builders and the cross-domain promote isolation (T-10-06)

## Decisions Made
- Migration directory is timestamped `20260915124116` by `prisma migrate dev`, differing from the plan frontmatter's placeholder `20260915120000` — this is expected `prisma migrate dev` behavior (it always generates its own timestamp), not a deviation from the plan's intent. The migration's content (CREATE TYPE + ALTER TABLE ADD COLUMN) matches the plan's acceptance criteria exactly.
- Copied `.env` (gitignored, not committed) from the main repo checkout into this worktree so the Prisma CLI could resolve `DATABASE_URL` — worktrees do not inherit untracked dotfiles from the primary checkout.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Generated missing Next.js route types so `npx tsc --noEmit` could complete**
- **Found during:** Task 2/3 verification (`npx tsc --noEmit`)
- **Issue:** This worktree had never run `next dev`/`next build`, so `.next/types/*.d.ts` (including the App Router's generated `LayoutProps` type used by `src/app/layout.tsx`) did not exist. `tsc` failed with `Cannot find name 'LayoutProps'` in a file completely unrelated to this plan's changes.
- **Fix:** Ran `npx next typegen` (Next.js 16's lightweight route-type generator, no full build needed) to produce the missing generated types.
- **Files modified:** none tracked (`.next/` is gitignored) — no source file was touched
- **Verification:** `npx tsc --noEmit` then exits 0 with zero errors
- **Committed in:** N/A (gitignored output, nothing to commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to complete the plan's own `tsc` verification gate; touched no plan-scoped file and produced no committed change.

## Issues Encountered

- `npx prisma generate`'s final step (renaming a temp file onto `node_modules/.prisma/client/query_engine-windows.dll.node`) returned `EPERM: operation not permitted` on every retry (15+ attempts over several minutes). Root cause: this worktree resolves `node_modules` by walking up to the shared main-repo `node_modules` (the worktree has no `node_modules` of its own), and another concurrently-running Node process (this is a parallel wave — other worktree agents run their own dev servers/tests against the same shared install) holds an OS-level file lock on that native DLL, which Windows will not let a second process rename over.
  - **Why this did not block the plan:** the Prisma query-engine binary is generic per Prisma version (6.19.3, unchanged by this migration) — only the JS/TS wrapper (`index.js`, `index.d.ts`) needs to change per schema, and both were confirmed fully regenerated with `attemptGradingMethod` (`grep -c` returned non-zero in both files) before the binary-rename step failed. The old, already-present DLL on disk is byte-for-byte what the new one would have been.
  - **Verification this was safe to proceed on:** `npx vitest run tests/assessment-scope.test.ts tests/submission-storage-keys.test.ts tests/boundary.test.ts tests/domain-event-service.test.ts` (40 tests, including `boundary.test.ts` which imports the live generated `@prisma/client`) passed cleanly, and `npx tsc --noEmit` exits 0 against the regenerated types. No downstream plan is blocked by this.
  - Leftover `.tmp` files remain in the shared `node_modules/.prisma/client/` directory (untracked, gitignored, outside this worktree's file scope) — harmless disk litter from the failed renames, not cleaned up since it is shared install state other concurrent agents may still be touching.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The one Phase 10 schema change (D-02) is live in the database; plans 03-09 can read/write `Assessment.attemptGradingMethod` without any further migration.
- `assessmentCourseScope` is exported and ready for `withPermission("assessments.create" | "assessments.edit", ...)` wiring in the plan that builds Assessment authoring.
- `buildSubmissionStorageKey`/`buildStagedSubmissionStorageKey`/`finalSubmissionKeyFor` are exported and ready for the Submission upload/presign/promote flow (ASM-04).
- All four new `DomainEventType` members compile and are ready for `writeDomainEvent` calls in the Attempt/Submission/Grade services this phase builds next.
- No blockers for downstream Phase 10 plans.

---
*Phase: 10-assessment-quizzes-assignments-grading*
*Completed: 2026-09-15*

## Self-Check: PASSED

All 8 claimed files found on disk; all 3 task commits (8c82f6e, 649164c, 1cac9ec) confirmed in `git log`.
