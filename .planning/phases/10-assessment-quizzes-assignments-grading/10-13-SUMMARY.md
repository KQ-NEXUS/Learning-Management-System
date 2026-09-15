---
phase: 10-assessment-quizzes-assignments-grading
plan: 13
subsystem: ui
tags: [nextjs, react, server-actions, grading, rbac, zod]

# Dependency graph
requires:
  - phase: 10-assessment-quizzes-assignments-grading (plan 10-07)
    provides: grading-service.ts (getGradingDetail, saveDraftGrade, releaseGrade)
  - phase: 10-assessment-quizzes-assignments-grading (plan 10-09)
    provides: grade-override-service.ts (overrideGrade, mandatory-reason correction)
provides:
  - The grade-entry screen (route, client island, server actions) fulfilling ASM-05/ASM-06's
    save-draft/release/override-with-reason flow, D-07's never-both-Save-and-Override rendering
    contract, and the §6.2 named-gap certificate-impact placeholder
  - A staff submission-download route (/api/submissions/[submissionId]/download)
  - getGradingDetail extended with cohortId/assessment (title, totalMarks, passMark);
    resolveActorNames for override-history actor display
affects: [11-certificates (consumes grade.overridden), 10-14+ (learner-facing submission/results UI)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ConfirmModal's description slot (ReactNode) carries an extra form field (the override's
      new-score input) instead of widening ConfirmModal's own props"
    - "Client-side blank-input guard before any Number() coercion (Number('') === 0 is a real
      footgun for an empty score field) — parseScore() returns null, never a silent 0"
    - "Release chains Save+Release under one user-facing button when no Grade row exists yet,
      keeping Release a single explicit user action distinct from Save while still requiring a
      persisted gradeId for the service call"

key-files:
  created:
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/page.tsx
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/actions.ts
    - src/app/api/submissions/[submissionId]/download/route.ts
    - tests/components/grade-entry-client.test.tsx
    - tests/grade-entry-routes.test.ts
  modified:
    - src/server/services/grading-service.ts

key-decisions:
  - "Extended getGradingDetail's return (cohortId, assessment.{title,totalMarks,passMark}) under
    the SAME submissions.view grant rather than adding a second courses.view-gated call the
    grader may not hold"
  - "Added resolveActorNames as a standalone, non-withPermission export (supplementary display
    data, mirrors payment-read-service.ts's own refund-actor-name lookup) rather than changing
    the injectable GradingServiceDeps shape and risking the existing grading-service.test.ts harness"
  - "Built a dedicated staff download route instead of embedding a presigned URL in the
    server-rendered page — a 60s-TTL URL baked into static HTML would go stale before a grader
    clicks it; mirrors lesson-resources/[id]/download/route.ts's on-click-presign/302 pattern"

patterns-established:
  - "cohortId/assessmentId ride along on grade-entry action schemas purely for revalidatePath
    targeting, never for scope resolution (mirrors enrolment-actions.ts's D-10 convention)"

requirements-completed: [ASM-05, ASM-06]

# Metrics
duration: ~70min
completed: 2026-09-15
---

# Phase 10 Plan 13: Grade-Entry Screen Summary

**Staff grade-entry screen (score/feedback, explicit release, RELEASED-only mandatory-reason override) with a Cohort-scope banner, prior-submission history, and a named-gap certificate-impact placeholder — plus the read-model and download-route infrastructure it needed but didn't yet have.**

## Performance

- **Duration:** ~70 min (includes one ~5 min `next build --webpack` verification run)
- **Tasks:** 3 planned tasks, all completed
- **Files modified:** 7 (4 created route/action/component files, 1 new API route, 1 extended
  service file, 2 new test files — 8 total counting both test files individually)

## Accomplishments

- Grade-entry route (`page.tsx`) renders the D-05 Cohort-scope banner inline, cross-checks the
  submission's own cohort/assessment against the route params (T-09-44-style membership proof),
  and lists every prior submission newest-first with its own download link.
- `actions.ts` exposes `saveDraftGradeAction`/`releaseGradeAction`/`overrideGradeAction`, each
  zod-parsed (override reason requires ≥10 trimmed characters) and mapping every service refusal
  (`GradeAlreadyReleasedError`, `GradeNotReleasedError`, `OverrideReasonRequiredError`,
  `AuthorizationError`/`AuthenticationError`) to a typed form result — nothing propagates as a
  thrown 500.
- `GradeEntryClient.tsx` renders two mutually exclusive control sets keyed on `status`: DRAFT (Save
  draft always available, Release once a valid score is entered, no override affordance anywhere)
  and RELEASED (read-only score/feedback, a single "Override grade" action, Save/Release GONE).
- The override flow opens `ConfirmModal` with `minReasonLength={10}`, carries the new-score field
  inside the modal's `description` slot, and renders override history newest-first plus the §6.2
  named-gap "Certificate impact — not yet evaluated (arriving in a future update)" placeholder.

## Task Commits

1. **Task 1: The grade-entry route and its server actions** - `066befa` (feat)
2. **Task 2: GradeEntryClient — draft entry, explicit release, RELEASED-only override** - `27fe6af` (feat)
3. **Task 3: Component and route tests** - `55c1a70` (test)

## Files Created/Modified

- `src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/page.tsx` - Server Component:
  banner, `DetailLayout` stacked read-only facts + prior history, mounts `GradeEntryClient`
- `src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/actions.ts` - three zod-parsed
  Server Actions delegating to `grading-service.ts`/`grade-override-service.ts`
- `src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx` - the
  DRAFT/RELEASED client island
- `src/app/api/submissions/[submissionId]/download/route.ts` - staff-authorized submission file
  download (302 to a freshly presigned URL, `no-store`)
- `src/server/services/grading-service.ts` - `getGradingDetail` now also returns `cohortId` and
  `assessment.{title,totalMarks,passMark}`; added `resolveActorNames`
- `tests/grade-entry-routes.test.ts` - action-boundary and `@prisma/client` AST-boundary tests
- `tests/components/grade-entry-client.test.tsx` - DOM-rendering tests for both modes

## Decisions Made

See `key-decisions` in frontmatter. In short: extend the existing `getGradingDetail` read model
under its own already-correct permission grant rather than add a second, mismatched-permission
service call; keep the actor-name lookup outside the injectable/testable service surface since
it's supplementary display data, not a security decision; and build a real download route instead
of a page-embedded presigned link, since the established codebase precedent
(`lesson-resources/[id]/download/route.ts`) exists for exactly this staleness reason.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended `getGradingDetail` with `cohortId` and `assessment` fields**
- **Found during:** Task 1 (route implementation)
- **Issue:** The plan's interfaces section describes `getGradingDetail` as returning "the current
  `Grade`... the full prior-`Submission` history... and the current grade's `GradeOverride` rows,"
  but the actual 10-07 implementation returns neither the submission's own `cohortId` (needed to
  cross-check the route's `[id]` param per D-05, mirroring the codebase's existing T-09-44
  membership-proof pattern) nor the `Assessment`'s `title`/`totalMarks`/`passMark` (needed for the
  page header, the Score field's "out of {totalMarks}" hint, and pass/fail context). Calling the
  separate `assessmentService.get()` would require a DIFFERENT permission (`courses.view`) a
  Cohort-scoped-only grader may not hold — a real access-denial bug for a legitimate grader.
- **Fix:** Extended `GradingDetail`'s type and `getGradingDetail`'s implementation to resolve and
  return `cohortId` (from the submission's own enrolment row) and `assessment.{title,totalMarks,
  passMark}` (from the submission's own assessment row), both under the SAME `submissions.view`
  grant already gating this read.
- **Files modified:** `src/server/services/grading-service.ts`
- **Verification:** `npx tsc --noEmit`, `npx eslint`, and the full existing
  `tests/grading-service.test.ts` (12 cases) still pass unmodified — the change is additive to the
  return shape and uses deps (`assessment.findUnique`) already present in the injectable interface
  and the test harness's mock.
- **Committed in:** `066befa` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added `resolveActorNames` to `grading-service.ts`**
- **Found during:** Task 1 (route implementation)
- **Issue:** UI-SPEC §6.1's override-history copy reads "...by {actorName}...", but
  `getGradingDetail`'s `overrides` only carry `actorId`. No shared "user id -> name" lookup existed
  the route could call (route files may not import `@prisma/client`).
- **Fix:** Added a standalone `resolveActorNames(actorIds): Promise<Map<string, string|null>>`
  export using `prisma.user.findMany` directly — mirroring `payment-read-service.ts`'s and
  `learner-results-service.ts`'s identical "supplementary display data, not a gate" actor-name
  resolution, deliberately NOT routed through `withPermission` (the caller already proved scope
  over the grade these ids came from).
- **Files modified:** `src/server/services/grading-service.ts`
- **Verification:** `npx tsc --noEmit` clean; exercised indirectly via the route's manual grep/build
  checks (no dedicated unit test — the function is a thin, unauthenticated pass-through, matching
  the codebase's existing precedent of not separately unit-testing this exact helper shape).
- **Committed in:** `066befa` (Task 1 commit)

**3. [Rule 2 - Missing Critical] Added a staff submission-download API route**
- **Found during:** Task 1 (route implementation)
- **Issue:** The plan's Task 1 read_first cites `submission-service.ts`'s `getOwnSubmissionDownloadUrl`
  as "the LEARNER path" and says staff download "goes through the grading detail's download
  reference, which the service resolves" — but `getGradingDetail`'s `downloadRef` is the raw
  `storageKey`, not a usable URL, and no staff-facing download route existed to turn it into one.
  Embedding a presigned URL directly in the server-rendered page would also go stale (the
  established `presignLessonObjectUrl` TTL default is 60s) before a grader clicks it minutes later.
- **Fix:** Added `src/app/api/submissions/[submissionId]/download/route.ts`, mirroring
  `lesson-resources/[id]/download/route.ts`'s exact shape: resolve `getGradingDetail` for
  authorization + the storage key, presign on click, 302 with `Cache-Control: private, no-store`.
  Every non-success outcome is a bare 404 (RBAC-06 denial parity).
- **Files modified:** `src/app/api/submissions/[submissionId]/download/route.ts` (new)
- **Verification:** `npx tsc --noEmit`, `npx eslint`, appears correctly in the `next build --webpack`
  route list (`ƒ /api/submissions/[submissionId]/download`)
- **Committed in:** `066befa` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 2 — missing critical functionality the screen could
not correctly/securely render or link without).
**Impact on plan:** All three additions are read-model/infrastructure gaps between what the plan's
interfaces section assumed 10-07/10-05 already exposed and what those files' actual, already-
committed implementations return. No scope creep beyond making this plan's own listed artifacts
(the grade-entry screen) actually functional and correctly scoped.

## Issues Encountered

- `npx next build` (Turbopack, the default) fails inside this git worktree with "Could not find the
  Next.js package" — Turbopack computes its own hermetic workspace root from the worktree's own
  `package.json` and refuses to resolve `node_modules` from the ancestor main-repo checkout (this
  worktree has no `node_modules` of its own). Worked around with `npx next build --webpack`
  (~5 min), matching the "worktree webpack build" note already recorded in this same wave's
  10-09/10-12 summaries. The full Turbopack build remains the orchestrator's post-merge
  responsibility against the integrated tree.
- Running the FULL `components` Vitest project (`npx vitest run --project components`, no file
  filter) hit a native out-of-memory crash in this sandbox — a pre-existing resource constraint
  (the project's heavy Tiptap/ProseMirror-mounting tests), not caused by this plan's files. Verified
  instead via the plan's own specified targeted commands
  (`npx vitest run --project components tests/components/grade-entry-client.test.tsx`, 10/10 pass)
  plus a broader-but-still-targeted run covering `grading-service`/`grading-routes`/
  `assessment-staff-routes`/`learner-results`/`submission-service` (63/63 pass) to confirm the
  `grading-service.ts` extension caused no regressions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ASM-05/ASM-06's grade-entry surface is complete and independently verified (tsc, eslint,
  webpack build, both targeted test files, plus the touched shared service's existing 31-case
  suite).
- Phase 11 (certificates) can consume the `grade.overridden` `DomainEvent` this screen's override
  path already emits (via `grade-override-service.ts`, unchanged) — the named-gap placeholder here
  is the explicit hook for that future work, not a silent stub.
- Outstanding: a human browser walkthrough of the full save-draft/release/override flow against
  seeded data is not attempted in this sandbox (no browser available) — consistent with this
  project's existing pattern of deferring live UI walkthroughs to a dedicated UAT pass.

---
*Phase: 10-assessment-quizzes-assignments-grading*
*Completed: 2026-09-15*
