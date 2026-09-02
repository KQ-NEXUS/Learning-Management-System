---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 08
subsystem: api
tags: [publish, versioning, immutability, listing, archive, rbac, prisma, vitest, testcontainers, tdd]

# Dependency graph
requires:
  - phase: 04-catalogue-authoring-programmes-courses-modules-lessons (plan 02)
    provides: "CoursePublication/ProgrammePublication tables, publiclyListed/publiclyListedAt/slugLockedAt, Programme.contentVersion + publishedById, publication FK pins on Cohort/CohortCourse"
  - phase: 04-catalogue-authoring-programmes-courses-modules-lessons (plan 06)
    provides: "buildCourseObligationTree/buildProgrammeObligationTree, hasUnpublishedObligationChanges, diffObligationTrees, evaluateCourseReadiness/evaluateProgrammeReadiness, blockingFailures, OBLIGATION_PAYLOAD_SCHEMA"
  - phase: 04-catalogue-authoring-programmes-courses-modules-lessons (plan 05)
    provides: "StaleOrderError (reused verbatim for the D-22 publish refusal)"
  - phase: 04-catalogue-authoring-programmes-courses-modules-lessons (plan 03)
    provides: "createResourceService async archive path, src/lib/positions band convention"
provides:
  - "catalogue-guards.ts: blockingCohorts (running cohorts reached directly or via CohortCourse), assertNoRunningCohorts (RunningCohortError naming the codes), assertSlugMutable (D-11 slug freeze + admin override), RunningCohortError, SlugFrozenError"
  - "publish-service.ts: createPublishOperation-derived publishCourse/publishProgramme — one insert-only immutable version per publish, in one transaction, D-22 stale refusal, D-06 per-cohort migration"
  - "setPublicListing — the independent D-08/D-09 commercial switch (gated programmes.publish), blockingFailures the only gate, first listing freezes the slug"
  - "unpublishContent / archiveCatalogueRecord / unarchiveCatalogueRecord — all running-cohort-guarded (D-12/D-14), unarchive returns to DRAFT + unlisted (D-16)"
  - "getLatestPublication / getUnpublishedChangeSummary — the D-05 warning-banner feed for plan 04-12"
  - "createPrismaBackedPublishService — the exported builder so the integration test wires the real loaders + transaction, not a re-derived copy"
affects: [04-09, 04-10, 04-11, 04-12, 04-13, 05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared operation factory for a capability the resource-service factory lacks (publish): createPublishOperation is parameterised over { kind, permission, toScope, load, buildPayload, evaluate, affected, commit } and both publishCourse and publishProgramme are derived from it (D-04) rather than written twice"
    - "Insert-only immutable artefact: a publication row is only ever created, never updated (grep-asserted); the next version is max(version)+1 computed inside the same transaction that inserts, and @@unique([parentId, version]) is the actual guarantee"
    - "Exported Prisma-backed builder (createPrismaBackedPublishService) so a real-Postgres integration test exercises the production loaders and the production $transaction path instead of a hand-rebuilt copy that can drift"
    - "Per-content-type permission dispatch: archive/unarchive need courses.edit (Course) vs programmes.manage (Programme), so two separately withPermission-wrapped handlers plus a thin kind dispatcher, because withPermission takes a static permission not a function of input"

key-files:
  created:
    - src/server/services/catalogue-guards.ts
    - src/server/services/publish-service.ts
    - tests/archive-guards.test.ts
    - tests/publish-service.test.ts
    - tests/publish.integration.test.ts
  modified: []

key-decisions:
  - "publishCourse takes { courseId } and publishProgramme takes { programmeId } (matching 04-RESEARCH Pattern 2's worked example) via a thin wrapper over the shared { id } operation — kind-specific call sites read better and the shared core stays single-implementation"
  - "archive/unarchive do NOT delegate to createResourceService.archive/restore as the plan text suggested: courseService is configured without restoreData (so it exposes no restore at all — see 04-03), and its default archiveData writes only { status: 'ARCHIVED' } with no publiclyListed:false. publish-service does its own withPermission-gated, audited single update { status, publiclyListed:false } instead — one write, one audit row, the D-14/D-16 columns correct"
  - "unpublishContent is gated on courses.publish for BOTH Course and Programme, per the plan's explicit behavior bullet — unpublish is treated as one content-act permission, not split by kind"
  - "removeCourseFromAllProgrammes (D-14) hard-deletes the ProgrammeCourse membership edges for the archived Course and renumbers survivors 0..n-1 ascending; published ProgrammePublication.payload rows are immutable and untouched — proven byte-identical in the integration test"
  - "createCatalogueGuards is re-instantiated against the passed client inside createPrismaBackedPublishService so the guards query the same database as the rest of the operation (critical for the integration test's testcontainer)"

patterns-established:
  - "createPublishOperation: the shared-publish factory pattern any future versioned artefact should copy rather than re-implement per model"
  - "createXBackedService builder exported alongside the production singleton, so integration tests get production wiring for free"

requirements-completed: [CAT-05, CAT-06, CAT-07, CAT-08]

# Metrics
duration: ~75min
completed: 2026-09-03
---

# Phase 4 Plan 08: Publish Operation, Listing Switch & Archive Guards Summary

**The operation the resource-service factory does not have — publish — as one insert-only, transaction-wrapped implementation shared by Course and Programme, plus the independent public-listing switch (D-08/D-09) and the running-cohort guards that stop unpublish and archive from pulling material out from under a live Cohort (D-12/D-14), proven against a real Postgres.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-09-02T23:45:00Z (worktree branch-check)
- **Completed:** 2026-09-03T00:20:00Z
- **Tasks:** 3/3 completed
- **Files modified:** 5 (all created)

## Accomplishments
- `blockingCohorts({ courseId | programmeId })` returns running Cohorts (`PUBLISHED`/`IN_PROGRESS`, date window contains now) reached directly (`Cohort.courseId`) or through `CohortCourse` for a Course, or by `Cohort.programmeId` for a Programme — selecting exactly `{ id, code, title, endsAt, _count.enrolments }`, the field set D-06's dialog and D-12's refusal both consume. `CANCELLED`/`COMPLETED`/`DRAFT` never block, whatever their dates.
- `RunningCohortError` carries the full list and names the cohort `code`s in its message (D-12 requires the control to name them); shared verbatim by unpublish and archive so staff learn one principle.
- `assertSlugMutable` implements D-11: editable while `slugLockedAt` is null, `SlugFrozenError` once set, admin override permitted only with a non-blank reason.
- `createPublishOperation` — `publishCourse`/`publishProgramme` derived from one config-parameterised factory (D-04). A publish: claims `updatedAt` with a conditional `updateMany` (D-22, reuses `StaleOrderError`), computes `max(version)+1` in the same transaction, inserts one `CoursePublication`/`ProgrammePublication` (never updates one — grep-asserted), sets the parent's `status`/`publishedAt`/`publishedById`/`contentVersion`, repoints pins for ticked Cohorts only, and audits.
- D-06 migration is `migrateCohortIds: string[]` (default `[]`), non-blank `reason` required when non-empty, and every ticked id is verified against the real running-cohort list (T-04-30 forged-list defence) before any pin moves.
- `setPublicListing` (gated `programmes.publish`, D-09) re-runs `blockingFailures(evaluate(...))` server-side as the **only** gate — no `status`-published check — so a DRAFT course whose four blockers pass is listable (D-08 early-bookings, proven end to end). First listing stamps `publiclyListedAt` + `slugLockedAt`; a later re-listing moves neither; listing-off always succeeds even mid-cohort (D-12).
- `archiveCatalogueRecord` / `unarchiveCatalogueRecord`: `courses.edit` (Course) / `programmes.manage` (Programme), reason-required, running-cohort-guarded; archive also removes the Course from every Programme's DRAFT ordering and returns the affected Programme names as a warning, leaving published `ProgrammePublication.payload` byte-identical; unarchive returns to `DRAFT` + unlisted, never straight to sale (D-16).
- Real-Postgres proof (15 `it` blocks, testcontainers): two publishes → v1 & v2 with v1 payload+`publishedAt` byte-identical afterwards; unticked cohort keeps its v1 pin; ticked cohort moves to v2 with a reason'd audit row; a lesson withdrawn post-v1 still appears in v1's payload and still resolves live; `@@unique([courseId, version])` rejects a duplicate; archived Course leaves a published Programme snapshot untouched; slug freezes on first listing; stale token writes zero publication rows; DRAFT+listed reachable; `publishProgramme` writes `Programme.contentVersion` + `publishedById`; plus the two D-09 authorization boundaries with scoped grants.
- Full suite green: `npx vitest run` — 23 files / 322 tests. `npx eslint .` clean. `npx tsc --noEmit` clean except the pre-existing unrelated `src/app/layout.tsx` `LayoutProps` error.

## Task Commits

Each task followed a RED (failing test) → GREEN (implementation) cycle, committed atomically:

1. **Task 1: Shared guards — running cohorts and the slug freeze**
   - `93b6741` (test) — `tests/archive-guards.test.ts`, 18 `it` blocks
   - `9e6a3d5` (feat) — `src/server/services/catalogue-guards.ts`
2. **Task 2: The shared publish operation and cohort migration**
   - `1b24b52` (test) — `tests/publish-service.test.ts`, 18 `it` blocks
   - `7768d8c` (feat) — `src/server/services/publish-service.ts` (publishCourse/publishProgramme/unpublishContent + D-05 helpers)
3. **Task 3: Listing switch, archive/unarchive, and the real-Postgres proof**
   - `ad91e91` (test) — `tests/publish.integration.test.ts`, 15 `it` blocks
   - `1613cfc` (feat) — `setPublicListing`, `archiveCatalogueRecord`, `unarchiveCatalogueRecord`, `createPrismaBackedPublishService`

_No separate plan-metadata commit here — worktree-isolated parallel execution; the orchestrator makes the STATE.md/ROADMAP.md commit after merge._

## Files Created/Modified
- `src/server/services/catalogue-guards.ts` — `blockingCohorts`, `assertNoRunningCohorts`, `assertSlugMutable`, `RunningCohortError`, `SlugFrozenError`, `createCatalogueGuards` factory
- `src/server/services/publish-service.ts` — `createPublishService` / `createPrismaBackedPublishService`, `publishCourse`, `publishProgramme`, `setPublicListing`, `unpublishContent`, `archiveCatalogueRecord`, `unarchiveCatalogueRecord`, `getLatestPublication`, `getUnpublishedChangeSummary`, typed errors
- `tests/archive-guards.test.ts` — fake-Prisma-delegate unit coverage of the guard predicate, the error payload/message, and the pure slug rule
- `tests/publish-service.test.ts` — in-memory `PublishDb` fake + harness `withPermission`; authorization, version increment, insert-only, stale refusal, migration, unpublish
- `tests/publish.integration.test.ts` — real `postgres:16-alpine` via `tests/support/pg.ts`; immutability, FK pins, unique index, snapshot preservation, D-08 reachability, D-09 boundaries

## Decisions Made
See frontmatter `key-decisions`. The load-bearing ones: `publishCourse({ courseId })`/`publishProgramme({ programmeId })` call shape; archive/unarchive implemented directly in publish-service rather than delegated to the resource-service factory (which lacks the needed `restoreData` and `publiclyListed:false` archive payload); `unpublishContent` gated on `courses.publish` for both kinds per the plan's explicit bullet.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] archive/unarchive do not delegate to the resource-service factory's archive/restore**
- **Found during:** Task 3
- **Issue:** The plan's Task 3 action says archive/unarchive should delegate "the actual write to the plan-04-03 factory's `archive` / `restore` so the audit path is not duplicated". But `courseService` (and `programmeService`) are configured **without** `restoreData`, so per 04-03's conditional return type they expose **no `restore` method at all**; and the factory's default `archiveData` writes only `{ status: "ARCHIVED" }`, never the `publiclyListed: false` that D-14/D-16 require. Delegating was not possible without editing 04-04-owned service files (off-limits this worktree) or adding config the plan did not ask for.
- **Fix:** `archiveCatalogueRecord` / `unarchiveCatalogueRecord` perform their own `withPermission`-gated, reason-required, audited single `update` (`{ status, publiclyListed: false }` for archive; `{ status: "DRAFT", publiclyListed: false }` for unarchive). One write, one audit row per action — the audit path is not actually duplicated, it is just emitted here instead of by the factory.
- **Files modified:** `src/server/services/publish-service.ts`
- **Verification:** `tests/publish.integration.test.ts` cases 6 (archive) and 8 (unarchive) assert the resulting row state and the untouched published Programme snapshot; `npx eslint .` clean; full suite green.
- **Committed in:** `1613cfc` (Task 3 GREEN)

**2. [Rule 2 - Missing Critical] `removeCourseFromAllProgrammes` — the D-14 draft-ordering removal**
- **Found during:** Task 3
- **Issue:** D-14 requires archiving a Course to "remove the course from their [Programmes'] draft ordering while leaving already-published programme snapshots untouched". The plan named the warning (affected Programme names) but not the mechanism for the removal.
- **Fix:** Added a production helper that deletes the `ProgrammeCourse` membership edges for the archived Course (a pure membership edge holds no history — same reasoning as `programme-service`'s `removeCourseFromProgramme`) inside one transaction and renumbers each affected Programme's survivors to a contiguous `0..n-1` ascending (no unique-index collision). Published `ProgrammePublication.payload` rows are immutable and never touched.
- **Files modified:** `src/server/services/publish-service.ts`
- **Verification:** `tests/publish.integration.test.ts` case 6 asserts the published snapshot is byte-identical after archive and that the membership row count drops to 0.
- **Committed in:** `1613cfc` (Task 3 GREEN)

**3. [Rule 3 - Blocking] Exported `createPrismaBackedPublishService` builder**
- **Found during:** Task 3
- **Issue:** The integration test needs the real loaders + real `$transaction` bound to a testcontainer client, not the production Neon singleton. Re-deriving all six loader functions in the test file would drift from production over time.
- **Fix:** Refactored the production binding into an exported `createPrismaBackedPublishService(client, withPermission, audit?)`. Production calls it with `(prisma, liveWithPermission)`; the integration test calls it with `(testDb.prisma, harnessWithPermission, testAuditSink)`. The guards are re-instantiated against the passed client too, so a running-cohort check hits the same database.
- **Files modified:** `src/server/services/publish-service.ts`
- **Verification:** `npx tsc --noEmit` clean; integration suite green against the real container.
- **Committed in:** `1613cfc` (Task 3 GREEN)

**4. [Rule 1 - API clarity] `publishCourse`/`publishProgramme` take kind-specific id keys**
- **Found during:** Task 2/3
- **Issue:** The shared operation internally keys on `input.id`; exposing that raw would make every call site read `publishCourse({ id })` where `id` is really a course id, contradicting 04-RESEARCH Pattern 2's own example `publishCourse({ courseId })`.
- **Fix:** Thin wrappers: `publishCourse({ courseId, ... })` → `publishCourseOp({ id: courseId, ... })`, likewise `publishProgramme({ programmeId, ... })`. The shared core stays one implementation.
- **Files modified:** `src/server/services/publish-service.ts`, `tests/publish-service.test.ts`
- **Verification:** unit + integration suites green.
- **Committed in:** `7768d8c` / `1613cfc`

---

**Total deviations:** 4 auto-fixed (2 blocking, 1 missing-critical, 1 API clarity)
**Impact on plan:** No scope creep. Deviation 1 was forced by 04-03's actual (correct) design — the factory deliberately has no `restore` for records with no withdrawn band. Deviations 2–4 are mechanism/ergonomics fills the plan's own decisions imply. All success criteria and acceptance greps satisfied.

## Issues Encountered
- The worktree spawned on an ancestor of the expected base (`0d8b501`, behind `2ed75b6`); corrected via the mandated `git reset --hard` to the expected base per the branch-check protocol before any work began (only untracked `.claude/` files present, no work lost).
- `withPermission(permission, resolveScope)` takes a **static** permission, so operations whose permission depends on record kind (archive = `courses.edit` vs `programmes.manage`) cannot be one wrapped handler — resolved with two wrapped handlers plus a kind dispatcher.

## Known Stubs
None. Every exported operation is fully wired to Prisma in production and exercised against a real Postgres in the integration test.

## Threat Flags
None beyond the plan's `<threat_model>`. T-04-30 (forged migration list), T-04-31 (retroactive version edit), T-04-32 (mass-migration boolean), T-04-33 (stale arrangement), T-04-34 (mid-study content removal) and T-04-36 (unattributed publish) are each covered — see Accomplishments and the grep-asserted acceptance criteria.

## User Setup Required
None - no external service configuration required. (Docker must be running for `tests/publish.integration.test.ts`; it was available and all 15 cases passed. `.env` was copied into the worktree only to reach the shared dev database for the non-container suite; it stays gitignored and uncommitted.)

## Next Phase Readiness
- Plan 04-12 can call `getUnpublishedChangeSummary` / `getLatestPublication` for the D-05 warning banner and the publish dialog, and `setPublicListing` + `evaluateCourseReadiness` for the listing dialog (one evaluator, D-27).
- Plan 04-09/04-11 (public catalogue pages) can read `publiclyListed` + `slugLockedAt` and rely on the slug being immutable once listed.
- Phase 5 (Cohort authoring) builds the UI around `Cohort.coursePublicationId` / `CohortCourse.coursePublicationId` / `Cohort.programmePublicationId` — this plan defined the pins and the migration path; Phase 5 wires cohort creation to select the pinned publication.
- No blockers for downstream plans.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-03*

## Self-Check: PASSED

- FOUND: src/server/services/catalogue-guards.ts
- FOUND: src/server/services/publish-service.ts
- FOUND: tests/archive-guards.test.ts
- FOUND: tests/publish-service.test.ts
- FOUND: tests/publish.integration.test.ts
- FOUND commit: 93b6741 (Task 1 test)
- FOUND commit: 9e6a3d5 (Task 1 feat)
- FOUND commit: 1b24b52 (Task 2 test)
- FOUND commit: 7768d8c (Task 2 feat)
- FOUND commit: ad91e91 (Task 3 test)
- FOUND commit: 1613cfc (Task 3 feat)
- `npx vitest run`: 23 files / 322 tests passing
- `npx eslint .`: clean
- `npx tsc --noEmit`: clean except pre-existing unrelated src/app/layout.tsx error
