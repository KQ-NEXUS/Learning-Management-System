---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 13
subsystem: ui
tags: [programmes, reference-not-clone, arrange-board-reuse, publish-dialog-reuse]

requires:
  - phase: 04-04
    provides: programmeService, addCourseToProgramme, removeCourseFromProgramme, DuplicateMembershipError
  - phase: 04-05
    provides: assertSlugMutable / SlugFrozenError (D-11)
  - phase: 04-08
    provides: publishProgramme, setPublicListing, archive/unarchive, insert-only ProgrammePublication
  - phase: 04-09
    provides: ArrangeBoard, UnsavedOrderGuard, the course arrange action shape
  - phase: 04-12
    provides: ReadinessPanel, PublishDialog, the course detail page layout this one mirrors
provides:
  - Programme index (ResourceTable) with the same non-enumerating denial as the course index
  - Programme create/edit form and actions, slug changes gated by assertSlugMutable
  - Programme course-composition screen — add by reference, reorder via ArrangeBoard, remove per row
  - Programme detail page mirroring the course one, reusing ReadinessPanel and PublishDialog
affects: [04-15]

tech-stack:
  patterns: [programme-service read helpers for the UI, ArrangeBoard optional-slot extension, programme mirror of CourseDetailActions]

key-files:
  created:
    - src/app/staff/programmes/page.tsx
    - src/app/staff/programmes/ProgrammesTable.tsx
    - src/app/staff/programmes/ProgrammeForm.tsx
    - src/app/staff/programmes/new/page.tsx
    - src/app/staff/programmes/actions.ts
    - src/app/staff/programmes/[id]/page.tsx
    - src/app/staff/programmes/[id]/ProgrammeDetailClient.tsx
    - src/app/staff/programmes/[id]/publish-actions.ts
    - src/app/staff/programmes/[id]/arrange/page.tsx
    - src/app/staff/programmes/[id]/arrange/ProgrammeArrangeClient.tsx
    - src/app/staff/programmes/[id]/arrange/actions.ts
  modified:
    - src/app/staff/layout.tsx
    - src/server/services/programme-service.ts
    - src/server/services/publish-service.ts
    - src/components/catalogue/ArrangeBoard.tsx
    - src/components/catalogue/CourseDetailActions.tsx
    - src/app/staff/courses/[id]/publish-actions.ts

key-decisions:
  - "Adding a Course to a Programme creates a ProgrammeCourse edge only — no clone path. The composition screen's copy says so explicitly and names each Course's other Programmes per row."
  - "Removing a Course is a hard delete of the edge; the Course, other Programmes and every already-published ProgrammePublication.payload are untouched (D-14 / D-18)."
  - "ArrangeBoard is reused, not forked: it gained two optional, backward-compatible slots (renderItemAction, emptyContainerLabel) rather than a second drag implementation."
  - "ProgrammeDetailClient mirrors CourseDetailActions and reuses PublishDialog directly; the publish dialog is not copied."
  - "The ProgrammesTable omits the bulk-action buttons rather than copy CoursesTable's no-op handlers."

patterns-established:
  - "Service read helpers for the staff UI (listProgrammesForIndex, loadProgrammeComposition, listAddableCourses) — authorized programmes.view, adding only the joins/counts the CRUD list/get lack."
  - "A catalogue action that carries a warning payload (programmeWarnings) must surface it — the UI names the blast radius, it does not swallow it."

requirements-completed: [CAT-02, CAT-05, CAT-07, CAT-08]

duration: ~50m
completed: 2026-09-03
---

# Phase 04 Plan 13: Programme Staff UI Summary

**The Programme half of the staff workspace: an index, a create/edit form, a Course-composition screen that adds by reference and reorders through the same `ArrangeBoard`, and a detail page that mirrors the Course one and reuses the shared readiness panel and publish dialog.**

## Performance

- **Duration:** ~50m across three build tasks plus a driven checkpoint
- **Started:** 2026-09-03T14:16:38+01:00
- **Completed:** 2026-09-03T14:50:23+01:00
- **Tasks:** 3 build + 1 checkpoint
- **Files created/modified:** 17

## Accomplishments

- Built the Programme index (`ResourceTable`), form and actions: identical non-enumerating denial to the course index (T-04-58), two status pills, slug changes routed through `assertSlugMutable` (D-11), no dead bulk-action handlers.
- Built the composition screen: one `ArrangeBoard` (cross-container off), a searchable "Add a course" picker of non-members showing each candidate's status, per-row "also in <programmes>" and a Remove control, and copy stating plainly that adding references and removing touches only this programme's draft order.
- Built the detail page mirroring the course one: Overview, Courses, a persistent `ReadinessPanel` fed by `evaluateProgrammeReadiness`, the D-05 banner, a Settings tab with the edit form, and a `ProgrammeDetailClient` action bar reusing `PublishDialog`.
- Drove the checkpoint's CAT-02 core against the live app: adding a Course to two Programmes left the Course count unchanged, keyboard reorder persisted, and a member Course cannot be re-added.

## Task Commits

1. **Task 1: programme index, form and actions** - `64928bd`
2. **Task 2: course-composition screen** - `14ca31f`
3. **Task 3: programme detail page** - `febde18`
4. **Checkpoint fix: name the programmes when archiving a member course** - `a249721`
5. **Task 4: human verification** - approved by the developer 2026-09-03

## Files Created/Modified

- `src/app/staff/programmes/page.tsx` / `ProgrammesTable.tsx` - the index; mirrors the course index exactly, two status pills, no bulk-action defect.
- `src/app/staff/programmes/ProgrammeForm.tsx` / `new/page.tsx` / `actions.ts` - create/edit form and `"use server"` actions; slug via `assertSlugMutable`.
- `src/app/staff/programmes/[id]/arrange/*` - `saveProgrammeCourseOrderAction` / `addCourseAction` / `removeCourseAction` (STALE / MISMATCH / DUPLICATE), and `ProgrammeArrangeClient` with the `ArrangeBoard` + picker.
- `src/app/staff/programmes/[id]/page.tsx` / `ProgrammeDetailClient.tsx` / `publish-actions.ts` - the detail page and the programme publish/list/archive bar.
- `src/server/services/programme-service.ts` - `listProgrammesForIndex`, `loadProgrammeComposition`, `listAddableCourses`.
- `src/server/services/publish-service.ts` - `loadProgrammeReadinessAggregate`, `getUnpublishedProgrammeChangeSummary`.
- `src/components/catalogue/ArrangeBoard.tsx` - optional `renderItemAction` and `emptyContainerLabel` props.
- `src/components/catalogue/CourseDetailActions.tsx` / `src/app/staff/courses/[id]/publish-actions.ts` - surface `programmeWarnings` on a course archive.
- `src/app/staff/layout.tsx` - "Programmes" nav entry.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Service read helpers the CRUD surface does not provide**

- **Found during:** Task 1 / Task 2
- **Issue:** `programmeService.list`/`get` return plain rows — no member count, no ordered members, no "other programmes" join, and there is no candidate-course source. The index and composition screens cannot render without these, and the app layer cannot query Prisma.
- **Fix:** Added `listProgrammesForIndex`, `loadProgrammeComposition`, `listAddableCourses` to `programme-service` (authorized `programmes.view`).
- **Committed in:** `64928bd`, `14ca31f`

**2. [Rule 2 - Missing file] A create form the plan implied but did not list**

- **Found during:** Task 1
- **Issue:** Task 1 is named "index, create/edit form, and its actions" and reads `ResourceForm`, but `files_modified` lists no form file and no `new/` route, so "New programme" had nowhere to go.
- **Fix:** Added `ProgrammeForm.tsx` (shared create/edit) and `programmes/new/page.tsx`; the detail page hosts the edit form in a Settings tab.
- **Committed in:** `64928bd`, `febde18`

**3. [Rule 3 - Blocking] `ArrangeBoard` had no per-item action slot**

- **Found during:** Task 2
- **Issue:** "Remove from programme" is a per-row control; `ArrangeBoard` only had Move controls and a withdrawn-band Restore. `ProgrammeCourse` has no withdrawn state, so there is no band to hang Remove on.
- **Fix:** Extended `ArrangeBoard` with two optional, backward-compatible props — `renderItemAction` (mirrors the existing `renderContainerAction`) and `emptyContainerLabel` (the hardcoded "No lessons in this module yet." was wrong for a programme). The 10 existing `ArrangeBoard` tests still pass unchanged.
- **Committed in:** `14ca31f`

**4. [Rule 3 - Blocking] The D-05 helpers were course-only**

- **Found during:** Task 3
- **Issue:** Task 3 reads `getUnpublishedChangeSummary` as if it worked for Programmes, but that helper (04-08 / 04-12) is `courses.view`-gated and calls `deps.loadCourse`. Same for the readiness aggregate loader.
- **Fix:** Added `loadProgrammeReadinessAggregate` and `getUnpublishedProgrammeChangeSummary` to `publish-service`, mirroring the course versions and reusing `buildProgrammeObligationTree` and the now-canonical comparison.
- **Committed in:** `febde18`

**5. [Rule 1 - Bug] `archiveCourseAction` swallowed the programme warnings**

- **Found during:** Task 4, step 9
- **Issue:** `archiveCatalogueRecord` returns `{ programmeWarnings }` (the Programmes a Course was removed from on archive, D-14), but `archiveCourseAction` returned a bare `{ ok: true }` — the checkpoint's "the warning NAMES the Programmes" could not happen.
- **Fix:** `archiveCourseAction` returns `programmeWarnings`; `CourseDetailActions` appends "removed from the draft order of: … (published versions are unchanged)" to the success message.
- **Committed in:** `a249721`

**6. [Design choice] `ProgrammeDetailClient` mirrors rather than parameterises `CourseDetailActions`**

- **Found during:** Task 3
- **Issue:** The plan suggested "parameterise them over the record kind if needed rather than copying". Parameterising `CourseDetailActions` over kind would also mean threading course-vs-programme action modules through it.
- **Fix:** `ProgrammeDetailClient` is a focused programme mirror that reuses `PublishDialog` and `ConfirmModal` directly (the dialog is not copied — that was the drift the plan worried about). The action-bar shell is small and its divergence from the course one is real (different permissions, no cohort-migration nuance).

---

**Total deviations:** 6 (3 blocking interface gaps in earlier-plan surfaces, 1 missing file, 1 bug, 1 design choice).
**Impact on plan:** No product scope added. Two `publish-service` helpers and the `programmeWarnings` fix close gaps that were latent in 04-08 / 04-12.

## Verification Results

- `npx tsc --noEmit`: clean.
- `npx eslint .`: clean.
- `npx vitest run`: 34 files, **441 tests passed** (the 2 Testcontainers integration files pass whenever the local Docker daemon is up; it dropped repeatedly during this session — an environment fault, confirmed green on a run where it stayed up).
- Task 1 greps: `AuthorizationError` and `programmes.view` in the page, one `"use server"`, `assertSlugMutable` present, zero `onClick: () => {}`, `programmes` in the layout, zero `@prisma/client`.
- Task 2 greps: `commitProgrammeCourseOrder` / `STALE` / `DUPLICATE` present, `ArrangeBoard` reused with no new DnD component, exactly one `allowCrossContainer={false}`, zero `@prisma/client`.
- Task 3 greps: `evaluateProgrammeReadiness`, `ReadinessPanel`, `notFound()`, `PublishDialog` present; zero `@prisma/client`.
- Human checkpoint: approved 2026-09-03. Steps 1, 2, 3, 5, 6 and 9 driven against the live app; steps 4, 7, 8 and 10 confirmed by the developer against reused, already-verified paths (retitle reads `course.title` live; publish/list/archive share the course code path verified in 04-12; `ProgrammePublication` is insert-only, covered by 04-08's integration test).

## Next Phase Readiness

- Plan 04-15 adds the public catalogue pages and the public-route `revalidatePath` calls to both `publish-actions.ts` files.
- Plan 04-14 (learner rendering) is unaffected by this plan.
- Wave 4 (plans 04-09 through 04-13) is complete.

## Self-Check: PASSED

- All three build tasks' files exist and are committed on `Khaliddev`.
- Every task acceptance criterion and the plan-level `tsc` / `eslint` / `vitest` commands pass.
- The developer approved the checkpoint; the CAT-02 reference-not-clone claim was verified by driving the live app and reading the course count before and after.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-03*
