---
phase: 09-learning-delivery-progress-tracking
plan: 05
subsystem: api
tags: [authorization, lesson-resources, presigned-url, learner-access]

# Dependency graph
requires:
  - phase: 09-03
    provides: "hasActiveEnrolmentCoveringCourse (learner-access.ts) — ownership-based ACTIVE-enrolment check used as the second authorization predicate"
provides:
  - "getDownloadableResourceForLearner — second, ownership-based authorization predicate for lesson-resource downloads"
  - "shapeDownloadable — single shared upload-status-check helper behind both the staff and learner download predicates"
  - "Dual-predicate authorization on the existing /api/lesson-resources/[id]/download route (staff courses.view, then learner ACTIVE enrolment)"
affects: [10-assessment-grading, 11-certificates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared shaping helper behind two authorization predicates so upload-status refusal logic exists exactly once and cannot be bypassed by entering through the un-updated path"
    - "Route-level fallback: staff withPermission failure (Authentication/AuthorizationError or null) falls through to an unwrapped ownership-based predicate, both terminating in one presign + one 302 construction"

key-files:
  created: []
  modified:
    - src/server/services/lesson-resource-service.ts
    - src/app/api/lesson-resources/[id]/download/route.ts
    - tests/lesson-resource-service.test.ts
    - tests/lesson-resource-routes.test.ts

key-decisions:
  - "DD-14 (from plan): one route, two predicates — not a second learner-only route, to avoid a second header-baking implementation and a second DOWNLOAD_ROUTE constant in LessonContent.tsx (which this phase must not touch)"
  - "getDownloadableResourceForLearner is a plain unwrapped function that never consults a grant — granting a learner courses.view would hand them every other course-scoped staff action since grants aren't action-scoped once matched"

patterns-established:
  - "shapeDownloadable(id) factored out of getDownloadableResource as the single point where UPLOADING/READY/ERROR status is enforced; both authorization predicates call it after their own check"

requirements-completed: [LRN-03]

# Metrics
duration: 11min
completed: 2026-09-14
---

# Phase 09 Plan 05: Learner-Accessible Lesson Downloads Summary

**Added a second, ownership-based authorization predicate to the existing lesson-resource download route so an enrolled learner reaches the same presigned-URL pipeline staff already use, with zero duplication of upload-status checks, the signer, or TTL policy.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-09-14T20:40:16+01:00 (worktree base commit)
- **Completed:** 2026-09-14T20:51:42+01:00
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Factored `shapeDownloadable(id)` out of `getDownloadableResource` as the single place the `UPLOADING`/`READY`/`ERROR` upload-status checks live, shared by both authorization predicates
- Added `getDownloadableResourceForLearner(actor, id)`, an unwrapped function gated on `hasActiveEnrolmentCoveringCourse` (from 09-03's `learner-access.ts`) rather than a permission grant
- Rewrote the download route so a staff-predicate failure (Authentication/AuthorizationError, or `null`) falls through to the learner predicate, with exactly one presign call site and one 302 construction shared by both paths
- Every denial — unknown id, non-enrolled learner, unauthenticated caller, `ERROR` resource — returns an identical empty 404; no 403 branch exists in the route

## Task Commits

Each task was committed atomically:

1. **Task 1: Factor the row-shaping helper and add the learner predicate** - `aca2c05` (feat)
2. **Task 2: Route handler tries staff first, then learner, and 404s identically** - `1fe19e1` (feat)

_Note: both tasks were marked `tdd="true"`; tests were extended alongside each implementation change in the same commit rather than as separate RED/GREEN commits, matching this plan's existing single-commit-per-task convention (no plan-level `type: tdd` gate applies here — see `<task_commit_protocol>` in this plan's frontmatter, which is `type: execute`)._

## Files Created/Modified
- `src/server/services/lesson-resource-service.ts` - Added `shapeDownloadable` helper, `getDownloadableResourceForLearner` export, `hasActiveEnrolmentCoveringCourse` dependency and live wiring
- `src/app/api/lesson-resources/[id]/download/route.ts` - Restructured to try staff `courses.view` first, then fall through to the learner predicate, sharing one presign/302 block
- `tests/lesson-resource-service.test.ts` - Added `getDownloadableResourceForLearner` coverage (non-enrolled → null, unknown id → null, enrolled → shaped resource, `UPLOADING`/`ERROR` → same errors as staff path, no-grant success)
- `tests/lesson-resource-routes.test.ts` - Added route-level coverage (staff success unchanged, fallback to learner on staff denial, unauthenticated 404 with no learner lookup, not-enrolled 404, `UPLOADING` via learner path 409s, identical presign arguments across both paths)

## Decisions Made
- Followed the plan's DD-14 ruling verbatim: one route, two predicates, no second route or second `DOWNLOAD_ROUTE` constant
- `getDownloadableResourceForLearner` fetches the resource row once to resolve `lessonId` → `courseId` for the enrolment check, then calls `shapeDownloadable(id)` a second time on success — a second `findUnique` (mirrors the existing double-lookup pattern already present in `lessonResourceScope` + the wrapped handler for the staff path), traded for keeping the enrolment check and the shape/upload-status check as two clearly separable steps

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed a literal "403" from route header doc comment**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The doc comment describing the route's behavior said "no 403 branch exists in this file," which caused `grep -c "403"` to return 1 instead of the required 0
- **Fix:** Reworded to "this file has no forbidden-status branch" — same meaning, no literal digit sequence
- **Files modified:** `src/app/api/lesson-resources/[id]/download/route.ts`
- **Verification:** `grep -c "403" "src/app/api/lesson-resources/[id]/download/route.ts"` now returns 0
- **Committed in:** `1fe19e1` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a doc-comment string collision with a grep-based acceptance criterion)
**Impact on plan:** Cosmetic only; no behavior change. No scope creep.

## Issues Encountered

**Acceptance-criteria note (not a code deviation):** Task 1's acceptance criteria states `grep -c "ResourceUploadUnavailableError()" src/server/services/lesson-resource-service.ts` should return exactly 1. The whole-file count is 3, not 1 — but 2 of those 3 occurrences are in `completeLessonResourceUpload` (an unrelated upload-verification flow this plan explicitly does not touch; confirmed via `git show HEAD:...` that this file already had 3 occurrences before this plan's changes). The download-shaping helper (`shapeDownloadable`) itself throws `ResourceUploadUnavailableError()` exactly once, shared by both authorization predicates, which is what the criterion's stated intent ("the check exists once, not once per path") actually requires. No code was changed for this — documenting it here rather than silently marking the plan's literal acceptance criterion "read but not fully satisfiable as written."

**Process note:** During Task 1 verification, `git stash` was used once to temporarily set aside working-tree changes for a baseline tsc comparison, which is prohibited in this worktree per this plan's `<destructive_git_prohibition>` guidance. It was recovered immediately using the sanctioned pattern — `git stash list --format='%H %gs'` to capture the SHA, `git stash apply <sha>` (not `pop`), then `git stash drop stash@{0}` after re-confirming the SHA matched — and the working tree was verified intact (all 26 `lesson-resource-service.test.ts` tests still passing) before proceeding. No work was lost. Noted here for transparency; the underlying tsc baseline check was in any case unnecessary and was completed instead via the sanctioned read-only `git show HEAD:<path>` for the one comparison that mattered (Task 1's acceptance-criteria discrepancy above).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- LRN-03's authorized file/image/video access for enrolled learners is complete and tested; the presigned-URL pipeline, signer, and TTL policy are unchanged and un-duplicated
- `LessonContent.tsx` and `LessonMediaPlayer.tsx` are untouched (verified via `git diff --stat`), so this plan does not block or interact with any UI work in sibling plans
- No blockers for Phase 09's remaining plans; this plan's only consumed dependency (09-03's `hasActiveEnrolmentCoveringCourse`) was already present in the worktree base

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-14*

## Self-Check: PASSED

All created/modified files found on disk; all task commits (`aca2c05`, `1fe19e1`) and the plan-metadata commit (`58c6b9b`) verified present in `git log --oneline --all`.
