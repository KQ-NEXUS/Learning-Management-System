---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 12
subsystem: ui
tags: [next-app-router, resource-table, resource-form, zod, server-actions, cohorts]

# Dependency graph
requires:
  - phase: 05-05
    provides: "cohortService (list/get/create/update/archive), updateCohort, OfferLockedError, assertOfferMutable, CohortReadinessRefusedError, NoPublishedOfferError"
  - phase: 05-02
    provides: "isValidTimeZone(tz)"
  - phase: 04-catalogue-authoring
    provides: "ResourceTable / ResourceForm primitives, courseService / programmeService, StaleOrderError (reorder-service.ts), AuthenticationError/AuthorizationError (@/server/permissions)"
provides:
  - "src/app/staff/cohorts/page.tsx — Cohorts index RSC with authorization branches (RBAC-06)"
  - "src/app/staff/cohorts/CohortsTable.tsx — CohortRow type + ResourceTable config for the cohorts list"
  - "src/app/staff/cohorts/actions.ts — createCohortAction / updateCohortAction, CohortActionResult discriminated union"
  - "src/app/staff/cohorts/CohortForm.tsx — ResourceForm-backed create/edit form (kind-then-record offer picker)"
  - "src/app/staff/cohorts/new/page.tsx — the create route"
affects: [05-15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Best-effort supplementary-data fetch: the Cohorts index and the new-cohort offer picker fetch course/programme titles via courseService.list()/programmeService.list() wrapped in .catch(() => []) — a courses.view/programmes.view denial degrades the Offer column/picker to empty rather than blocking the cohorts.view-gated page (the actual RBAC-06 gate is cohortService.list() alone)."
    - "Action-level optimistic concurrency: updateCohort's underlying write has no conditional-update primitive (only publishCohort's transaction does), so updateCohortAction reads the stored updatedAt via cohortService.get() and throws StaleOrderError itself on a mismatch before calling updateCohort — a best-effort check-then-act, not the atomic conditional updateMany the threat model's aspirational language describes."
    - "ResourceTable gained an optional `emptyBody` prop (default-preserving) so a screen can supply its UI-SPEC-mandated exact empty-state sentence instead of the primitive's generic 'Create one to get started.' — CoursesTable is unaffected (no prop passed, same copy as before)."

key-files:
  created:
    - "src/app/staff/cohorts/page.tsx"
    - "src/app/staff/cohorts/CohortsTable.tsx"
    - "src/app/staff/cohorts/actions.ts"
    - "src/app/staff/cohorts/CohortForm.tsx"
    - "src/app/staff/cohorts/new/page.tsx"
    - "tests/components/cohorts-table.test.tsx"
  modified:
    - "src/components/primitives/ResourceTable.tsx"

key-decisions:
  - "cohortService.list({}) returns bare Cohort columns (no course/programme join, since the resource-service factory's Delegate.findMany takes no select/include). page.tsx resolves the Offer column's title by separately calling courseService.list({})/programmeService.list({}) and joining by courseId/programmeId in the RSC, rather than modifying cohort-service.ts (out of this plan's files_modified) to add a joined read."
  - "The single accent 'Create cohort' button lives ONLY in the ResourceTable headerActions (a real next/link, unlike CoursesTable's unwired 'New course' button) — onCreate/createLabel are deliberately left unset on ResourceTable so the empty-state panel never renders a second accent button alongside it (UI-SPEC accent reserved list #1: one primary button per screen)."
  - "CohortForm's offer target is one kind-select (Course/Programme) plus a dependent record-select that only renders once a kind is chosen — the 'both submitted' state is not reachable through the UI, though the XOR is still zod-validated server-side and the DB CHECK is the backstop (T-05-78)."

patterns-established:
  - "Cross-field zod issues (empty `path`, e.g. the XOR refinement) are mapped to the `offerKind` field name in `zodErrors`, so they render in the ResourceForm error summary AND link to a real field (`#field-offerKind`) rather than being silently dropped."

requirements-completed: [COH-01, COH-02]

# Metrics
duration: ~20min
completed: 2026-09-04
---

# Phase 5 Plan 12: Cohorts Index + Create/Edit Form Summary

**The staff Cohorts list (`ResourceTable`, all UI-SPEC columns/filters/copy) and the create form (`ResourceForm`, every COH-02 field, kind-then-record offer picker, integer-minor-units price) with server actions mapping `OfferLockedError`/`StaleOrderError`/authorization failures to their exact UI-SPEC recovery copy.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (both `auto`)
- **Files:** 6 created, 1 modified (shared primitive)

## Accomplishments

- **`src/app/staff/cohorts/page.tsx`** — RSC calling `cohortService.list({})` with the same three-branch `AuthenticationError`/`AuthorizationError`/rethrow shape as `courses/page.tsx`; resolves the Offer column's title via a best-effort join against `courseService.list({})`/`programmeService.list({})`.
- **`src/app/staff/cohorts/CohortsTable.tsx`** — `CohortRow` type (exported for 05-15's reuse) and a `ResourceTable` config: Code (mono, link, zinc-900 — via the primitive's built-in first-column link styling, no override needed), Offer (title + kind subtitle), Delivery mode (`StatusPill`), Window (mono opens→closes + tz subtitle), Seats (`{seatsTaken}/{capacity}`, mono, right), Status (`StatusPill`, tone map covering all five `CohortStatus` members). Search + status + delivery-mode filters. One accent "Create cohort" header link.
- **`src/app/staff/cohorts/actions.ts`** — `createCohortAction`/`updateCohortAction`, `CohortActionResult` discriminated union (exported for 05-15's reuse). Strict zod schema: integer `capacity >= 1`, integer `priceMinor >= 0`, `timezone` refined through `isValidTimeZone`, four coerced/validity-checked dates, Course-XOR-Programme cross-field refinement, start<end and enrolmentOpens<enrolmentCloses refinements. `toFailure` maps `OfferLockedError`, `StaleOrderError` (best-effort optimistic-concurrency check against `cohortService.get()`'s `updatedAt`), and `AuthorizationError`/`AuthenticationError` (one generic line) to the exact UI-SPEC copy.
- **`src/app/staff/cohorts/CohortForm.tsx`** — `ResourceForm` + `useActionState`, every COH-02 field, a kind-then-record offer picker, an `Intl.supportedValuesOf("timeZone")` select, a minor-units-labelled price field, and the seat-hold hint "default 30 · 0 or blank = seat taken only on activation".
- **`src/app/staff/cohorts/new/page.tsx`** — RSC courtesy gate (`can("cohorts.manage", {})`) loading `PUBLISHED` Courses/Programmes for the offer picker.
- **`src/components/primitives/ResourceTable.tsx`** (deviation, see below) — added an optional `emptyBody` prop.

## Task Commits

1. **Task 1: Cohorts index route and ResourceTable configuration** — `49a0afb`
2. **Task 2: Create/edit form and its server actions** — `03cc15e`

**Plan metadata (SUMMARY / STATE / ROADMAP):** disk-only — `.planning/` is gitignored (sequential-execution-mode note).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] `ResourceTable`'s empty-state body copy did not support the UI-SPEC's exact per-screen sentence**
- **Found during:** Task 1, writing the six-state component test.
- **Issue:** The primitive's unfiltered-empty body is a fixed generic string, "Create one to get started." The UI-SPEC requires the Cohorts screen's exact sentence: "Create a cohort to schedule sessions and open enrolment." No prop existed to override it, and no new primitive is authorised.
- **Fix:** Added an optional `emptyBody?: string` prop to `ResourceTableProps`, defaulting to the existing text when omitted (so `CoursesTable` and any other consumer is unaffected). `CohortsTable` passes the UI-SPEC sentence.
- **Files modified:** `src/components/primitives/ResourceTable.tsx`, `src/app/staff/cohorts/CohortsTable.tsx`.
- **Commit:** `49a0afb`

**2. [Rule 1 - bug] A code comment accidentally tripped its own acceptance grep**
- **Found during:** Task 2, running the acceptance-criteria greps.
- **Issue:** A doc-comment explaining the money-as-integer-minor-units rule literally contained the strings `parseFloat`/`toFixed` as counterexamples, which the acceptance gate `grep -cE "parseFloat|toFixed" actions.ts` (expects 0) then matched.
- **Fix:** Reworded the comment to describe the forbidden calls without using their literal names.
- **Files modified:** `src/app/staff/cohorts/actions.ts`.
- **Commit:** `03cc15e`

No other deviations — the rest of the plan executed as written.

**Known limitation, not a deviation:** `updateCohortAction`'s optimistic-concurrency check (mapping `StaleOrderError`) is a best-effort check-then-act (`cohortService.get()` compare, then `updateCohort()`), not an atomic conditional `updateMany` — the resource-service factory's plain `update()` has no conditional-write primitive (only `publishCohort`'s hand-rolled transaction does). Closing this race properly would mean adding a conditional-update primitive to `cohort-service.ts`, which is out of this plan's `files_modified` scope. Flagging for whoever revisits `cohort-service.ts` next (05-15 or later).

## Verification Results

- `npx vitest run tests/components/cohorts-table.test.tsx` — 6/6 passed (loading, error, empty, filtered-empty, populated, denied).
- `npx vitest run tests/boundary.test.ts tests/structure.test.ts` — 16/16 passed (no Prisma import outside services; route conventions intact).
- `npx tsc --noEmit` — exit 0. `npm run lint` — exit 0.
- `npm run build` — exit 0; `/staff/cohorts` and `/staff/cohorts/new` both compile and are listed as dynamic (`ƒ`) routes.
- Grep gates: `"cohorts.view"` in `page.tsx` = 1; `"No cohorts yet"` in `CohortsTable.tsx` = 1 (doc comment, since the primitive generates the literal string dynamically from `noun`); `seatsTaken` in `CohortsTable.tsx` = 4; `@prisma/client` in all five new route/component files = 0; `priceMinor` in `actions.ts` = 3; `parseFloat|toFixed` in `actions.ts` = 0; `isValidTimeZone` in `actions.ts` = 2; `"locked because it has enrolments"` = 1; `"Someone else changed this cohort"` = 1; `"default 30"` in `CohortForm.tsx` = 1.

## Known Stubs

None — every field is wired to a real service call; no hardcoded empty/placeholder data ships in this plan.

## Threat Flags

None beyond the plan's own threat register (T-05-76 … T-05-82), all of which the acceptance-criteria grep gates and the component test directly verify. The best-effort (non-atomic) `StaleOrderError` check in `updateCohortAction`, noted above, is a known limitation of T-05-81's mitigation, not a newly discovered surface.

## Self-Check: PASSED

- `src/app/staff/cohorts/page.tsx` — FOUND
- `src/app/staff/cohorts/CohortsTable.tsx` — FOUND
- `src/app/staff/cohorts/actions.ts` — FOUND
- `src/app/staff/cohorts/CohortForm.tsx` — FOUND
- `src/app/staff/cohorts/new/page.tsx` — FOUND
- `tests/components/cohorts-table.test.tsx` — FOUND
- Commit `49a0afb` — FOUND
- Commit `03cc15e` — FOUND

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
