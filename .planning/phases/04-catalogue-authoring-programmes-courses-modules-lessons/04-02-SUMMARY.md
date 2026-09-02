---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 02
subsystem: database
tags: [prisma, postgresql, migrations, schema]

# Dependency graph
requires: []
provides:
  - "CoursePublication and ProgrammePublication immutable publish records (CAT-05/CAT-06)"
  - "ScanStatus enum shared by LessonResource, Submission, TicketAttachment (D-28)"
  - "publiclyListed/publiclyListedAt/slugLockedAt on Course and Programme (D-08, D-11)"
  - "withdrawnAt soft-delete on Module and Lesson, two-band position convention documented (D-17)"
  - "Programme.contentVersion / Programme.publishedById for publish-operation parity with Course"
  - "Publication FK pins + indexes on Cohort (both kinds) and CohortCourse (OQ-1)"
  - "LessonResource.sizeBytes widened to BigInt (2GB video cap overflow fix)"
  - "LessonResource uploadedById/scannedAt/scanDetail/position audit fields"
  - "prisma/sql/002_catalogue_integrity.sql — payload jsonb_typeof CHECK constraints"
  - "tests/schema-catalogue.test.ts — 22 regression assertions over the schema text"
affects: [04-03, 04-04, 04-05, 04-06, 04-07, 04-08, 04-09, 04-10, 04-11, 05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Immutable publication row per publish (never updated), pinned by FK from Cohort/CohortCourse — obligation snapshot is a JSON payload, not normalised rows"
    - "Two-band position convention: live rows non-negative, reorder parks near-negative, withdrawal parks at/under WITHDRAWN_PARK_BASE (-1,000,000); unique index stays total, never partial"
    - "Manual raw-SQL paste-in convention (prisma/sql/NNN_*.sql) for constraints Prisma cannot express, applied into the generated migration.sql before running it — this one carries a regression test unlike 001_integrity.sql"
    - "scanStatus String->enum conversion via explicit ALTER COLUMN ... USING ... ::text::EnumType cast instead of Prisma's default DROP+ADD, to avoid silent data loss on non-empty tables"

key-files:
  created:
    - prisma/migrations/20260902183714_catalogue_publications_and_listing/migration.sql
    - prisma/sql/002_catalogue_integrity.sql
    - tests/schema-catalogue.test.ts
  modified:
    - prisma/schema.prisma

key-decisions:
  - "OQ-1 resolved as written: Cohort pins both coursePublicationId and programmePublicationId directly, plus CohortCourse.coursePublicationId for per-course pins inside a Programme cohort"
  - "OQ-2 resolved as written: ScanStatus promoted to a shared Prisma enum across LessonResource, Submission, TicketAttachment in this one migration"
  - "CohortCourse.contentSnapshot kept but documented as history-only; coursePublicationId is the live mechanism"

patterns-established:
  - "Publish-operation schema parity: any model needing a shared publish operation (plan 04-08) needs contentVersion + publishedById, matching what Course already had"

requirements-completed: [CAT-04, CAT-05, CAT-06, CAT-07, CAT-08]

duration: 55min
completed: 2026-09-02
---

# Phase 4 Plan 02: Catalogue Schema Delta Summary

**One Prisma migration adding CoursePublication/ProgrammePublication immutable publish records, a shared ScanStatus enum, D-08/D-11 listing+slug-lock switches, D-17 withdrawnAt soft-delete, and OQ-1's publication FK pins — locked by a 22-assertion schema test.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-02T19:29:00Z (worktree branch-check start)
- **Completed:** 2026-09-02T20:24:00Z
- **Tasks:** 3/3 completed
- **Files modified:** 4 (1 modified, 3 created)

## Accomplishments
- Landed the entire Phase 4 schema delta (all eleven downstream plans' shared dependency) in one migration, avoiding eleven separate migration conflicts
- `CoursePublication` / `ProgrammePublication` immutable publish records with `@@unique([parentId, version])`, giving CAT-06 a real place to record actor/version/time
- `ScanStatus` promoted to a shared enum across `LessonResource`, `Submission`, `TicketAttachment` — the string-to-enum conversion on non-empty tables used an explicit `USING` cast rather than Prisma's default drop-and-recreate, which would have silently discarded existing `'PENDING'` values
- Publication FK pins on `Cohort` (both `coursePublicationId` and `programmePublicationId`, per OQ-1) and `CohortCourse.coursePublicationId`, each indexed — the "which cohorts are on version N" question is now an indexed lookup, not a JSON scan
- `LessonResource.sizeBytes` widened `Int` → `BigInt`, closing the 2GB-video-cap overflow that would otherwise orphan an uploaded object with no row able to reference it
- Position uniqueness on `Module`/`Lesson`/`ProgrammeCourse` confirmed unchanged — still `CREATE UNIQUE INDEX`, never `DEFERRABLE` — verified both by grep across all migration files and by a dedicated test
- `prisma/sql/002_catalogue_integrity.sql` (payload-must-be-a-JSON-object CHECK) pasted into the generated migration and, unlike `001_integrity.sql`, backed by a test asserting the constraint name appears in an applied migration file so it cannot silently go unapplied
- `tests/schema-catalogue.test.ts`: 22 `it` blocks, all passing; full suite (`npx vitest run`) green at 11 files / 106 tests, including the pre-existing `tests/schema-auth.test.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema delta — publications, listing switches, withdrawal, scan enum** - `a838330` (feat)
2. **Task 2: Generate and apply the migration; assert the position indexes are unchanged** - `2879abd` (feat)
3. **Task 3: Schema assertion test** - `319f4ff` (test)

_No separate plan-metadata commit — this is a worktree-isolated parallel execution; the orchestrator makes the final metadata commit after merge._

## Files Created/Modified
- `prisma/schema.prisma` - Added `ScanStatus` enum; `CoursePublication`/`ProgrammePublication` models; listing/slug-lock/withdrawnAt/publish-parity fields on Course, Programme, Module, Lesson; publication pins on Cohort/CohortCourse; upload-audit fields + BigInt sizeBytes on LessonResource; back-relations on User
- `prisma/migrations/20260902183714_catalogue_publications_and_listing/migration.sql` - Applied migration; scanStatus columns converted with explicit `USING` casts; includes the pasted-in `002_catalogue_integrity.sql` CHECK constraints
- `prisma/sql/002_catalogue_integrity.sql` - New manual-paste-in raw-SQL file: `jsonb_typeof(payload) = 'object'` CHECK on both publication tables
- `tests/schema-catalogue.test.ts` - New schema-assertion test file, 22 tests, mirrors `tests/schema-auth.test.ts`'s idiom

## Decisions Made
- Followed both planner decisions (OQ-1, OQ-2) exactly as written in the plan frontmatter — no departures.
- Converted the generated migration's `scanStatus` String→enum change from Prisma's default `DROP COLUMN` + `ADD COLUMN` to an explicit `ALTER COLUMN ... TYPE "ScanStatus" USING "scanStatus"::text::"ScanStatus"`, per the plan's own documented fallback ("If migrate dev reports a cast failure, edit the generated migration SQL..."). Applied proactively because the default form is silent data loss (not merely a cast failure) on any table with existing rows — safer to always use the explicit cast for a String→enum conversion carrying live data risk.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Rewrote the generated migration's scanStatus conversion to avoid silent data loss**
- **Found during:** Task 2
- **Issue:** `prisma migrate dev --create-only` generated `DROP COLUMN "scanStatus"` + `ADD COLUMN "scanStatus" "ScanStatus" ... DEFAULT 'PENDING'` for all three tables (`LessonResource`, `Submission`, `TicketAttachment`), which discards any existing string values rather than converting them — worse than the "cast failure" the plan anticipated, since it does not error, it silently loses data.
- **Fix:** Replaced each with `ALTER COLUMN "scanStatus" DROP DEFAULT`, `ALTER COLUMN "scanStatus" SET DATA TYPE "ScanStatus" USING "scanStatus"::text::"ScanStatus"`, `ALTER COLUMN "scanStatus" SET DEFAULT 'PENDING'`.
- **Files modified:** `prisma/migrations/20260902183714_catalogue_publications_and_listing/migration.sql`
- **Verification:** `npx prisma migrate status` reports the database in sync, no drift; `npx vitest run` green.
- **Committed in:** `2879abd` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/data-safety fix, explicitly anticipated by the plan's own contingency text)
**Impact on plan:** No scope creep — fix stayed inside the plan's own documented fallback path for this exact scenario.

## Known Plan-Verification-Script Discrepancies

Two of Task 1's acceptance-criteria `grep` checks produced counts different from what the plan text states, in both cases because a **pre-existing** field elsewhere in the schema (untouched by this plan) shares the same name/pattern as a field this plan added. Neither represents a defect in the schema delta itself — both are confirmed by inspection:

1. **`grep -c 'withdrawnAt  *DateTime?' prisma/schema.prisma` outputs `3`, not the stated `2`.** `Module.withdrawnAt` and `Lesson.withdrawnAt` (added by this plan, D-17) account for 2; the third is `Enrolment.withdrawnAt`, which already existed before this plan and means something unrelated (a learner withdrawing from a Cohort, COH/REG domain) — not part of Phase 4's catalogue soft-delete mechanism.
2. **`grep -cE 'sizeBytes +Int' prisma/schema.prisma` outputs `2`, not the stated `0`.** The plan's Task 1 action text explicitly scopes the BigInt widening to `LessonResource.sizeBytes` only ("Widen `LessonResource.sizeBytes` from `Int` to `BigInt`" — no mention of `Submission` or `TicketAttachment`). Those two models' `sizeBytes Int` fields belong to Phases 10 (ASM-04) and 12 (SUP-01) respectively and were left untouched, matching the action text. The broader grep pattern in the acceptance criteria doesn't scope to `LessonResource` and therefore also matches the two untouched fields elsewhere in the file.

Both are pre-existing-field false positives in an unscoped `grep`, not regressions introduced by this plan. `tests/schema-catalogue.test.ts` correctly scopes its assertions per-model and all 22 pass.

## Issues Encountered

**`npx prisma generate` intermittently fails with `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`.** Root cause: this worktree resolves `node_modules` up the directory tree to the main repo's shared `node_modules` (the worktree's own `node_modules` is effectively empty), and a long-running `next dev` server process in the main repo holds the native query-engine DLL loaded in memory — Windows will not let any process rename/replace a DLL another process has mapped. This is an environmental condition (a user-owned dev server process outside this plan's control), not a defect introduced by this plan, and killing another process's server was out of scope for a plan executor.

Verified this is benign, not a functional blocker: the query-engine binary's content doesn't depend on `schema.prisma` (only the JS/TS client layer does, and that regenerates independent of the native-binary rename step), and the generate command did successfully update the JS/TS client (`ScanStatus`, `CoursePublication`, etc. all present in `node_modules/.prisma/client/index.d.ts`) before failing on the binary rename. Directly confirmed the client works end-to-end against the new schema:
```
node -e "const {ScanStatus}=require('@prisma/client'); ...` -> OK
node -e "new PrismaClient().coursePublication.count()" -> coursePublication count: 0
```
Both the acceptance criterion's literal `node -e` check and a live query against the newly-created `CoursePublication` table succeed. `npx prisma migrate status` confirms the database is fully in sync with the schema. No further action needed from this plan; a future `npm run dev` restart will pick up a clean `prisma generate` on its own next invocation. No CI-blocking step depends on the literal exit code of the standalone command run here.

## User Setup Required

None - no external service configuration required. (The `.env` file was copied from the main repo checkout into this worktree purely to reach the shared Neon dev database for `prisma migrate dev`; `.env` remains gitignored and was not committed.)

## Next Phase Readiness

- The full Phase 4 schema delta is live in the shared Neon dev database (`prisma migrate status`: up to date, no drift) and in `prisma/schema.prisma`. All eleven downstream Phase 4 plans (04-03 through 04-11) can build directly on `CoursePublication`, `ProgrammePublication`, `ScanStatus`, the listing/slug-lock switches, `withdrawnAt`, and the publication FK pins without further schema changes anticipated by the research.
- Position uniqueness is provably still an index (not a constraint), so plan 04-05's two-pass negative-offset reorder transaction can proceed exactly as designed.
- No blockers for wave 2+ plans in this phase.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-02*
