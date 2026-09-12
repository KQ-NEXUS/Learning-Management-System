---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 12
subsystem: ui
tags: [readiness, publish-dialog, cohort-migration, public-listing, react-server-actions]

requires:
  - phase: 04-06
    provides: evaluateCourseReadiness, ReadinessItem/ReadinessState/ReadinessCategory
  - phase: 04-08
    provides: publishCourse, setPublicListing, unpublishContent, archive/unarchive, getUnpublishedChangeSummary, obligation payload diff
  - phase: 04-09
    provides: the arrange screen the content outline links to
provides:
  - A shared ReadinessPanel/ReadinessSummary rendering with a genuine fourth state (NOT_YET_CHECKED)
  - PublishDialog with per-cohort migration tick-boxes (unticked, no bulk control) and a conditional reason
  - CourseDetailActions — Publish/Unpublish and List/Unlist as two controls under two permissions
  - publish-actions.ts server actions mapping RunningCohortError/StaleOrderError/readiness refusals to typed results
  - publish-service.loadCourseReadinessAggregate and permissions.can() for page-level gating
  - Canonical obligation-payload comparison so the D-05 banner is not permanently stuck on
affects: [04-13, 04-14, 04-15]

tech-stack:
  patterns: [server-evaluated readiness passed as props, courtesy-hide-then-server-refuse controls, canonical jsonb comparison]

key-files:
  created:
    - src/components/catalogue/ReadinessPanel.tsx
    - src/components/catalogue/PublishDialog.tsx
    - src/components/catalogue/CourseDetailActions.tsx
    - src/app/staff/courses/[id]/publish-actions.ts
    - tests/components/readiness-panel.test.tsx
  modified:
    - src/app/staff/courses/[id]/page.tsx
    - src/server/services/publish-service.ts
    - src/server/services/publication.ts
    - src/server/permissions/index.ts
    - tests/publication.test.ts

key-decisions:
  - "The readiness panel is a pure renderer: the page runs evaluateCourseReadiness and passes the ReadinessItem[] in; the component never evaluates (D-27)."
  - "NOT_YET_CHECKED renders with a dot and the text 'Not yet checked — Phase 5', never a grey tick or cross (D-26)."
  - "Publish and public listing are separate controls under courses.publish and programmes.publish; a hidden control is a courtesy, the Server Action re-checks and refuses (T-04-53)."
  - "The publish dialog's cohort tick-boxes start unticked with no bulk control; a reason becomes mandatory the moment any is ticked (D-06)."
  - "Obligation payloads are compared with keys sorted at every depth, because the stored payload is jsonb and PostgreSQL does not preserve key order."

patterns-established:
  - "Page-level permission gating: `can(permission, scope)` returns a boolean without throwing, for deciding whether to render a control."
  - "Imperatively-awaited Server Actions return a discriminated result and let the client navigate/refresh — never redirect() (see also the 04-11 fix)."
  - "Refusals from a modal-driven action surface in that modal's own error slot, not a banner the modal covers."

requirements-completed: [CAT-05, CAT-06, CAT-07, CAT-08]

duration: ~1h
completed: 2026-09-03
---

# Phase 04 Plan 12: Readiness Panel, Publish Dialog & Listing Controls Summary

**The course detail page now carries a persistent readiness panel with a genuine "not yet checked — Phase 5" state, a publish dialog that names every affected cohort unticked by default, an unpublished-obligation-changes banner, and separate permission-gated publish / public-listing / archive controls.**

## Performance

- **Duration:** ~1h across the three build tasks, plus a driven human checkpoint
- **Started:** 2026-09-03T13:04:38+01:00
- **Completed:** 2026-09-03T14:01:10+01:00
- **Tasks:** 3 build + 1 checkpoint
- **Files created/modified:** 10

## Accomplishments

- Built `ReadinessPanel` / `ReadinessSummary` as pure renderers: four visually distinct `data-state` treatments, `NOT_YET_CHECKED` as a real third state, every PXR category heading present even when empty, state conveyed by text as well as colour (NFR-09).
- Built `publish-actions.ts` (publish / unpublish / list / archive / unarchive), `PublishDialog` (unticked per-cohort migration, no bulk control, conditional reason, Publish disabled while blocking), and `CourseDetailActions` (two controls under two permissions, `ConfirmModal` for archive/unarchive, cohort codes named on `COHORTS_RUNNING`).
- Amended the course detail page: server-evaluated readiness feeding the panel, the D-05 banner listing changed obligations, a module/lesson outline replacing the placeholder, and the action bar in the layout's `actions` slot — with `AuthorizationError -> notFound()` preserved.
- Drove all 13 checkpoint steps against the live app; 12 confirmed, step 6 has no UI surface in this phase.

## Task Commits

1. **Task 1: readiness panel + RED test** - `1f49009` (test written first and run RED; committed together)
2. **Task 2: publish dialog and the catalogue action module** - `aeca408`
3. **Task 3: wire into the course detail page** - `04ed5ab`
4. **Checkpoint fix: refusals inside the ConfirmModal** - `2eec151`
5. **Checkpoint fix: canonical obligation-payload comparison** - `25fec66`
6. **Checkpoint fix: name the blocking items in a refusal** - `9199683`
7. **Task 4: human verification** - approved by the developer 2026-09-03; steps 2-5, 7-13 confirmed

## Files Created/Modified

- `src/components/catalogue/ReadinessPanel.tsx` - `ReadinessPanel` + `ReadinessSummary`; renders an already-evaluated `ReadinessItem[]`, never evaluates.
- `src/components/catalogue/PublishDialog.tsx` - readiness summary, unpublished-change list, a table of running cohorts (code / learner count / end date) with unticked checkboxes and no bulk control, a reason that becomes required on the first tick.
- `src/components/catalogue/CourseDetailActions.tsx` - Publish/Unpublish under `courses.publish`, List/Unlist under `programmes.publish`, Archive/Un-archive via `ConfirmModal`; a `COHORTS_RUNNING` result names the cohort codes in the modal.
- `src/app/staff/courses/[id]/publish-actions.ts` - `"use server"`; each action zod-validates and delegates to `publish-service`, mapping `RunningCohortError -> COHORTS_RUNNING` (with the list), a readiness refusal `-> NOT_READY` (with failures), a stale token `-> STALE`.
- `src/app/staff/courses/[id]/page.tsx` - loads the tree, the readiness aggregate and the change summary server-side; runs `evaluateCourseReadiness`; renders the panel, the banner, the content outline and the action bar.
- `src/server/services/publish-service.ts` - adds `loadCourseReadinessAggregate` (authorized `courses.view`).
- `src/server/services/publication.ts` - `hasUnpublishedObligationChanges` now compares canonically.
- `src/server/permissions/index.ts` - adds the non-throwing `can(permission, scope)` helper.
- `tests/components/readiness-panel.test.tsx` - 9 `it` blocks covering the four states, the Phase 5 text, category order, the blocking label, and the summary line.
- `tests/publication.test.ts` - adds a key-reorder regression test for the canonical comparison.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `loadCourseReadinessAggregate` and `can()`**

- **Found during:** Task 3
- **Issue:** The plan expected the page to call `evaluateCourseReadiness` directly, but the app layer cannot build a `ReadinessCourseInput` (it would need a Prisma query, forbidden under the service-layer boundary), and there was no non-throwing permission check for deciding whether to render a control.
- **Fix:** Added `publish-service.loadCourseReadinessAggregate` (authorized `courses.view`, returns the same aggregate the publish/listing operations evaluate) and `permissions.can(permission, scope)`. The page still runs the evaluator itself.
- **Files modified:** `src/server/services/publish-service.ts`, `src/server/permissions/index.ts`, `src/app/staff/courses/[id]/page.tsx`
- **Verification:** `tsc`, `eslint`, boundary test green; the panel's own grep for evaluator calls stays 0.
- **Committed in:** `04ed5ab`

**2. [Rule 1 - Bug] Obligation payload comparison was not canonical**

- **Found during:** Task 4, step 8
- **Issue:** `hasUnpublishedObligationChanges` (plan 04-08) compared a freshly-built obligation tree against the stored payload with raw `JSON.stringify`. The payload column is `jsonb` and PostgreSQL does not preserve object key order, so the comparison always returned true — the D-05 "unpublished obligation changes" banner was permanently on for every published course, and the step 8 body-vs-obligation distinction could not be observed.
- **Fix:** `hasUnpublishedObligationChanges` now serialises with object keys sorted at every depth before comparing; array order is still significant (position is an obligation). Added a key-reorder regression test.
- **Files modified:** `src/server/services/publication.ts`, `tests/publication.test.ts`
- **Verification:** 23/23 in `publication.test.ts`; the driven checkpoint then showed a body-only edit leaving the banner clear and a `required`-flag change raising it with the change listed.
- **Committed in:** `25fec66`

**3. [Rule 1 - Bug] Archive/unpublish refusal hidden behind the ConfirmModal**

- **Found during:** Task 4, step 11
- **Issue:** A `COHORTS_RUNNING` refusal from unpublish or archive was written only to the action bar's feedback banner, which the still-open `ConfirmModal` covered — so the message naming the blocking cohorts was invisible.
- **Fix:** Route the failure to each modal's own `error` slot and keep the modal open.
- **Files modified:** `src/components/catalogue/CourseDetailActions.tsx`
- **Committed in:** `2eec151`

**4. [Rule 2 - Missing detail] A NOT_READY refusal did not name the blocking item**

- **Found during:** Task 4, step 3
- **Issue:** A listing/publish refusal showed only "This course is not ready. Clear the blocking items first." — step 3 expects it to name Summary.
- **Fix:** Append the failing item labels the service already returns in `result.failures`.
- **Files modified:** `src/components/catalogue/CourseDetailActions.tsx`
- **Committed in:** `9199683`

---

**Total deviations:** 4 (1 blocking interface gap, 3 bug/detail fixes — two of them in files owned by earlier plans, both with the checkpoint as the trigger).
**Impact on plan:** Deviation 2 restores a decision-support signal that was silently broken since 04-08; the rest are UI-refusal polish. No product scope added.

## Verification Results

- `npx tsc --noEmit`: clean.
- `npx eslint .`: clean.
- `npx vitest run`: 34 files, **441 tests passed** (the 2 integration files need Docker; a transient daemon drop during one run was environmental, re-run green).
- Task 1 acceptance greps: 9 `it` blocks, four distinct `data-state` values, "Phase 5" text asserted, zero evaluator calls in the component, `data-state` present.
- Task 2 acceptance greps: one `"use server"`, `COHORTS_RUNNING` present, zero `selectAll`/`migrateAll`, zero `defaultChecked`, `enrolmentCount`/`learners` present, `courses.publish` and `programmes.publish` both present, zero `@prisma/client` in the components.
- Task 3 acceptance greps: `ReadinessPanel`, `CourseDetailActions`, `evaluateCourseReadiness` present; placeholder gone; `notFound()` present; zero `@prisma/client`.
- Human checkpoint: driven against the live app on 2026-09-03. Steps 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13 confirmed; step 1 trivial; step 6 (slug edit) has no UI in this phase — the freeze is enforced by `assertSlugMutable`, unit-tested in 04-04.

## Next Phase Readiness

- Plan 04-13 reuses `ReadinessPanel` / `ReadinessSummary` and the `publish-actions` pattern for programmes.
- Plan 04-14's checkpoint can rely on the readiness panel and the D-05 banner being correct now that deviation 2 is fixed.
- Plan 04-15 adds the public-route `revalidatePath` calls to `publish-actions.ts` (deliberately omitted here — the routes do not exist yet).

## Self-Check: PASSED

- All three build tasks' production and test files exist and are committed on `Khaliddev`.
- Every task acceptance criterion and the plan-level `tsc` / `eslint` / `vitest` commands pass.
- The developer approved the checkpoint; the D-01 and D-08 observations only a human can make were both confirmed by driving the live app.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-03*
