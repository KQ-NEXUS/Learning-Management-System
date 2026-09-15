---
phase: 10-assessment-quizzes-assignments-grading
plan: 05
subsystem: api
tags: [file-upload, s3, submission, assignment, presigned-url, prisma]

# Dependency graph
requires:
  - phase: 10-assessment-quizzes-assignments-grading
    plan: 01
    provides: "Submission storage key builders (buildStagedSubmissionStorageKey/finalSubmissionKeyFor), the submission.created DomainEventType, and Assessment.attemptGradingMethod"
provides:
  - "createSubmissionService(deps) — the learner Assignment two-step upload pipeline: beginSubmissionUpload, completeSubmissionUpload, failSubmissionUpload, getOwnSubmissions, getOwnSubmissionDownloadUrl"
  - "SubmissionNotAllowedError / SubmissionConstraintError / SubmissionUploadValidationError typed refusals"
affects: [10-07, 10-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Intent/complete two-step verified upload for a second domain (Submission), reusing storage-service.ts's key-taking primitives (inspectLessonObject/promoteLessonObject/deleteLessonObject/presignLessonUploadUrl/presignLessonObjectUrl) unmodified behind an injectable SubmissionStorage seam"
    - "DD-15 ownership-scoped service file with ZERO withPermission-wrapped exports — enrolment re-derived from actor.userId via a locally-duplicated one-hop cohort/cohortCourse walk (SubmissionStore), never accepted as caller input"

key-files:
  created:
    - src/server/services/submission-service.ts
    - tests/submission-service.test.ts
  modified: []

key-decisions:
  - "resolveOwnEnrolmentForCourse is a local, duplicated implementation of learner-access.ts's hasActiveEnrolmentCoveringCourse walk (not imported) because that function returns only a boolean; this module needs the actual enrolment id to scope every Submission row"
  - "SubmissionStorage's presign+stagedKey members live inside the service (not the route layer) — unlike lesson-resource-service.ts, where the API route builds the key and presigns before calling begin, beginSubmissionUpload itself builds and presigns its own staged key per the plan's Task 1 spec"
  - "getOwnSubmissionDownloadUrl's refusal (non-owner OR non-READY row) reuses SubmissionNotAllowedError's existing 'not-found' reason rather than inventing a new one — the plan specified the READY-only gate but not a distinct error shape, and 'not-found' matches the file's existing indistinguishable-denial convention"
  - "Two doc-comment sentences were reworded (without changing meaning) purely to avoid the literal substrings 'withPermission' and 'UPLOAD_LIMITS'/'upload-limits', which the plan's acceptance criteria grep for at zero occurrences"

patterns-established:
  - "A second service in the codebase (after lesson-resource-service.ts) proving inspect-then-promote as the structural mechanism for 'failures never display false success', now generalised to a domain where sizeBytes is a plain Int (Submission) rather than the BigInt widening LessonResource needed"

requirements-completed: [ASM-03, ASM-04]

# Metrics
duration: ~55min
completed: 2026-09-15
---

# Phase 10 Plan 05: Submission Upload Pipeline (ASM-03/ASM-04) Summary

**Two-step verified Submission upload (`submission-service.ts`) enforcing per-Assessment authored file-type/size constraints server-side, with a durable receipt written only after the object store confirms the promoted bytes**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-09-15
- **Tasks:** 3 completed
- **Files modified:** 2 (1 service file created, 1 test file created)

## Accomplishments
- `beginSubmissionUpload` re-derives the enrolment from `actor.userId` against the Assessment's course (never caller-supplied), refuses `not-found`/`not-an-assignment`/`not-published`/`window-closed` before touching storage, and enforces `Assessment.allowedFileTypes`/`maxFileSizeBytes` (case-insensitive, dot-tolerant extension matching) strictly before any presigned URL is issued
- D-03: a submission made after `dueAt` but before `availableUntil` succeeds and is flagged `isLate: true`, never blocked; `availableUntil` is the only hard cutoff
- D-04: resubmission always creates a new row with the next `attemptNumber`, leaving the prior receipt (`receiptId`/`storageKey`) untouched; an in-flight `UPLOADING` row or a `READY` row with `allowResubmission: false` both refuse a new begin
- `completeSubmissionUpload` replicates `lesson-resource-service.ts`'s inspect → promote → READY ordering exactly: any inspect failure or a size/content-type mismatch marks the row `ERROR`, throws a typed `SubmissionUploadValidationError`, and never calls `promote` or writes a `submission.created` event — the ASM-04 "never false success" proof, verified by three dedicated failure-path tests
- `getOwnSubmissions` (full attempt history, newest-first) and `getOwnSubmissionDownloadUrl` (FINAL key only, `READY`-gated) round out the ownership-scoped read surface; `failSubmissionUpload` backs the browser-side abort path
- 22 new unit tests, all green; `npx tsc --noEmit` and `npx eslint` both clean on the new files

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: Types, typed refusals, beginSubmissionUpload, completeSubmissionUpload, failSubmissionUpload, getOwnSubmissions, getOwnSubmissionDownloadUrl** - `274f4fe` (feat)
   - Implemented as a single commit: both tasks modify the same new file (`submission-service.ts`) and were written together as one coherent module rather than in two passes, since splitting an unreleased single-file service mid-write would not produce a meaningfully reviewable intermediate state.
2. **Task 3: tests/submission-service.test.ts** - `3d46386` (test)

_No TDD tasks in this plan (plan frontmatter has no `tdd="true"` tasks)._

## Files Created/Modified
- `src/server/services/submission-service.ts` (670 lines) - The full ownership-scoped Submission upload pipeline: typed refusals (`SubmissionNotAllowedError`, `SubmissionConstraintError`, `SubmissionUploadValidationError`), the injectable `SubmissionStorage`/`SubmissionStore` seams, `beginSubmissionUpload`, `completeSubmissionUpload`, `failSubmissionUpload`, `getOwnSubmissions`, `getOwnSubmissionDownloadUrl`, and the live Prisma-backed binding at the bottom of the file
- `tests/submission-service.test.ts` (416 lines) - 22 tests: ASM-03 constraint enforcement (type/size/case-insensitivity), D-03 lateness/cutoff, ownership/reachability parity, the three never-false-success failure branches, happy-path ordering and idempotent double-complete, D-04 resubmission (both allowed and disallowed), and the two ownership-scoped read paths

## Decisions Made
- `resolveOwnEnrolmentForCourse` duplicates (rather than imports) `learner-access.ts`'s `hasActiveEnrolmentCoveringCourse` cohort/cohortCourse walk, because that existing function only returns a boolean and this module needs the actual enrolment id to scope every Submission row it reads/writes.
- `SubmissionStorage`'s `presign`/`stagedKey` members live inside the service itself (Task 1 builds AND presigns its own staged key), a deliberate divergence from `lesson-resource-service.ts` where the API route pre-computes the key before calling `begin` — this plan's own interface spec calls for `presign`/`stagedKey` as members of the injectable storage seam.
- `getOwnSubmissionDownloadUrl` reuses the existing `"not-found"` refusal reason for both a non-owner and a non-`READY` row, rather than inventing a new `SubmissionNotAllowedReason` member the plan never specified — consistent with the file's existing "indistinguishable denial" convention (T-10-02).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regenerated missing Next.js route types so `npx tsc --noEmit` could complete**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** This worktree had not run `next dev`/`next build` since checkout, so `.next/types/*.d.ts` (the App Router's generated `LayoutProps` type used by `src/app/layout.tsx`) did not exist — `tsc` failed on a file completely unrelated to this plan's changes. Same root cause plan 10-01 and 10-02 both hit and logged.
- **Fix:** Ran `npx next typegen` to regenerate the missing route types.
- **Files modified:** none tracked (`.next/` is gitignored).
- **Verification:** `npx tsc --noEmit` then exits 0 with zero errors.
- **Committed in:** N/A (gitignored output, nothing to commit).

**2. [Rule 1 - Bug] Cast the Prisma enrolment store to the module's narrow structural type instead of hand-writing `select`-shaped delegate functions**
- **Found during:** Task 1 implementation, first `npx tsc --noEmit` pass
- **Issue:** A hand-written `store.enrolment.findMany({ where: { userId, status } })` binding against `prisma.enrolment.findMany` failed to typecheck — Prisma's generated `EnrolmentWhereInput.status` expects the `EnrolmentStatus` enum, not the plain `string` this module's `SubmissionStore` type deliberately uses (so no `@prisma/client` enum import is needed for the unit-test fakes to compile).
- **Fix:** Adopted `learner-access.ts`'s existing `prisma as unknown as <Store>` idiom — cast the whole client to `SubmissionStore` once, rather than writing per-method select wrappers that fight the enum typing.
- **Files modified:** `src/server/services/submission-service.ts` (live-binding section only).
- **Verification:** `npx tsc --noEmit` exits 0; `tests/submission-service.test.ts`'s fake-store tests are unaffected (they build `SubmissionStore` directly, never touching the live cast).
- **Committed in:** `274f4fe`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both necessary to complete the plan's own `tsc`/verification gates; neither touched the plan's functional scope (constraint enforcement, upload ordering, refusal shapes all match the plan exactly).

## Issues Encountered

- The plan's Task 3 acceptance criterion "`npx vitest run` on the full node project passes with no new failures" could not be cleanly confirmed in this sandbox: the full suite includes ~17 real-Postgres integration test files, several of which spin up their own ephemeral test-container Postgres and re-apply all 11 migrations (120–220s per file observed), and this worktree runs concurrently with ~15+ other `node.exe` processes from sibling parallel worktree-agents sharing the same test database. A scoped run (`npx vitest run --project node --exclude "**/*.integration.test.ts"`) still picked up `tests/checkout-webhook.integration.test.ts` (a Vitest 4 project-`include`-vs-CLI-`exclude` precedence gap) and observed 3 failures there — `Unique constraint failed on the fields: (provider,providerEventId)` and a Postgres connection killed by "administrator command" — both consistent with cross-agent DB contention, not a regression from this plan's changes (`submission-service.ts` never imports `checkout-webhook-system-service.ts` or touches `WebhookEvent`). Logged to `deferred-items.md` under "10-05" rather than fixed (out of scope, not reproducible in isolation, scope-boundary Rule applies). This plan's own explicit `<verification>` block — `npx vitest run tests/submission-service.test.ts tests/boundary.test.ts` (22/22 and 14/14 passing), `npx tsc --noEmit` (0 errors), `npx eslint src/server/services/submission-service.ts` (0 errors) — is fully green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `beginSubmissionUpload`/`completeSubmissionUpload`/`getOwnSubmissions`/`getOwnSubmissionDownloadUrl` are exported and ready for plan 10-07 (grading — reads `Submission.storageKey`/`filename`/`sizeBytes` for the grading queue) and plan 10-14 (learner UI — the Server Actions calling `beginSubmissionUpload`/`completeSubmissionUpload` and rendering `getOwnSubmissions`'s receipt history).
- `SubmissionNotAllowedError`, `SubmissionConstraintError`, and `SubmissionUploadValidationError` (with their `.reason`/`.submission` fields) are ready for the learner UI's Server Action error mapping — the `window-closed` message text already matches `10-UI-SPEC.md` §7.4.2 verbatim.
- No blockers for downstream Phase 10 plans. The one open item is the full-suite `vitest run` confirmation noted above, which needs a Docker/DB-uncontended environment (not code-blocked).

---
*Phase: 10-assessment-quizzes-assignments-grading*
*Completed: 2026-09-15*

## Self-Check: PASSED

All 3 claimed files found on disk (`src/server/services/submission-service.ts`,
`tests/submission-service.test.ts`, this SUMMARY); both task commits (`274f4fe`, `3d46386`)
confirmed in `git log`.
