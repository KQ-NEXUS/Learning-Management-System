---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 15
subsystem: ui
tags: [next-app-router, detail-layout, server-actions, readiness-panel, confirm-modal, cohorts, publish, cancel]

# Dependency graph
requires:
  - phase: 05-05
    provides: "loadCohortReadinessAggregate, publishCohort, CohortReadinessRefusedError, NoPublishedOfferError"
  - phase: 05-11
    provides: "cancelCohort, CohortCancelBlockedError"
  - phase: 05-12
    provides: "CohortsTable/CohortForm conventions, cohortService, updateCohort, OfferLockedError"
  - phase: 05-13
    provides: "SessionsTab + SessionRow shape"
  - phase: 05-14
    provides: "RosterTab/ExceptionsTab + RosterRowView/AttendanceExceptionView shapes, loadCohortRoster, loadAttendanceExceptions"
provides:
  - "src/app/staff/cohorts/[id]/page.tsx — the tabbed DetailLayout cohort record (Overview/Sessions/Roster/Exceptions), each tab's data loaded independently so one failing load doesn't take the record down"
  - "src/app/staff/cohorts/[id]/publish-actions.ts — publishCohortAction/cancelCohortAction, typed-error mapping to UI-SPEC copy, no readiness evaluation of its own"
  - "src/components/catalogue/CohortDetailActions.tsx — Edit/Publish/Cancel action bar; Publish dialog embeds the shared ReadinessSummary and is a courtesy echo only"
  - "src/app/staff/cohorts/[id]/edit/page.tsx — mounts CohortForm's existing edit mode (deviation — see below)"
  - "src/app/staff/layout.tsx — Cohorts and Enrolments NAV entries now route to real pages"
affects: [05-16]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-section data loads on a DetailLayout tabbed page: sessions/roster/exceptions are each wrapped in their own try/catch, mapped to DetailSection.error on failure, so one denied permission (e.g. attendance.view without cohorts.view) degrades only that tab (T-05-105)"
    - "A bespoke ConfirmModal-shaped publish dialog (not the course PublishDialog) embedding the shared ReadinessSummary — cohorts never migrate, so no migration table or mandatory reason, just blockingFailures(items) driving the disabled state as a courtesy echo of the server gate"
    - "utcToWallParts(date, timezone).label reused directly in a DetailFacts value for the D-23 explicit-timezone-label contract, with no new formatting helper"

key-files:
  created:
    - "src/app/staff/cohorts/[id]/publish-actions.ts"
    - "src/components/catalogue/CohortDetailActions.tsx"
    - "tests/components/cohort-detail-actions.test.tsx"
    - "src/app/staff/cohorts/[id]/page.tsx"
    - "src/app/staff/cohorts/[id]/edit/page.tsx"
  modified:
    - "src/app/staff/layout.tsx"

key-decisions:
  - "The publish confirmation is a small bespoke dialog local to CohortDetailActions.tsx, not a reuse of catalogue/PublishDialog.tsx — that component's cohort-migration table and mandatory-reason-on-migrate logic are course/programme-specific and do not apply to a cohort publish (a cohort never migrates); the shared ReadinessSummary is embedded instead, matching the UI-SPEC's 'ConfirmModal-shaped dialog reusing ReadinessSummary' option."
  - "Each tab's data (sessions/roster/exceptions) is loaded in its own try/catch rather than one shared try/catch around all four loads — only the core load (cohort + readiness aggregate) shares the three-branch catch that can notFound() the whole page; a denial on a single tab's permission degrades only that DetailSection via its error slot (T-05-105)."
  - "Added src/app/staff/cohorts/[id]/edit/page.tsx (Rule 2 deviation, not in this plan's files_modified) — CohortForm's edit mode has existed since 05-12 but no route ever mounted it, so the detail page's required 'Edit' link had no real destination. Mirrors new/page.tsx's courtesy-gate + best-effort offer-picker pattern, pre-fills every CohortForm field from the stored row via a local datetime-local formatter, and passes the row's updatedAt as expectedUpdatedAt for updateCohortAction's existing optimistic-concurrency check."

patterns-established:
  - "Section-scoped load isolation on a tabbed DetailLayout page — the pattern any future multi-tab detail screen in this codebase should follow when different tabs are gated on different permissions."

requirements-completed: [COH-04, COH-05, COH-07]

# Metrics
duration: ~55min
completed: 2026-09-04
---

# Phase 5 Plan 15: Cohort Detail Assembly — Tabs, Readiness, Publish/Cancel, Nav Summary

**The cohort detail record assembled as a tabbed `DetailLayout` (Overview/Sessions/Roster/Exceptions) with a persistent server-evaluated readiness panel, publish and cancel Server Actions that echo but never own the server-side gate, a courtesy-gated edit route filling a pre-existing gap, and the staff nav wired to both new sections.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-09-04
- **Tasks:** 2 (both `auto`) plus one Rule-2 deviation (the edit route)
- **Files:** 5 created, 1 modified

## Accomplishments

- **`publish-actions.ts`** — `publishCohortAction`/`cancelCohortAction`, `.strict()` zod schemas (`expectedUpdatedAt` parsed with millisecond precision, `reason` optional for publish / min-10-char for cancel), delegating straight to `publishCohort`/`cancelCohort`. Zero calls to `evaluateCohortReadiness` in this file (grep-gated) — the gate lives entirely in the service. `toFailure` maps `CohortReadinessRefusedError` to the exact "{n} check(s) that must pass before it can be published" copy (carrying the failing items), `NoPublishedOfferError`, `StaleOrderError` ("Someone else changed this cohort…"), `CohortCancelBlockedError`, `ReasonRequiredError`, and a generic `AuthorizationError`/`AuthenticationError` denial. Revalidates `/staff/cohorts`, the cohort detail route, and `/staff/enrolments`.
- **`CohortDetailActions.tsx`** — Edit link, an accent "Publish cohort" button opening a bespoke `ConfirmModal`-shaped dialog embedding `ReadinessSummary` (disabled while `blockingFailures(items).length > 0`, in-code-documented as a courtesy echo — T-05-99), and a danger "Cancel cohort" button opening the shared `ConfirmModal` (`tone="danger"`, `minReasonLength: 10`, description stating the live active-enrolment count to be withdrawn, D-31/T-05-104). A control the caller lacks permission for is hidden as a courtesy only.
- **`tests/components/cohort-detail-actions.test.tsx`** — 5 cases: Publish disabled + failure count named with a blocking FAIL item; Publish enabled with every item PASS; the cancel confirm button gated on the 10-character reason and its description naming the active-enrolment count; a failed cancel rendering "Action not applied" through the modal's error slot; a successful publish calling the action with the right payload.
- **`page.tsx`** — loads the cohort, `loadCohortReadinessAggregate`, sessions, roster and exceptions; runs `evaluateCohortReadiness` exactly once in the page and feeds the result to both `ReadinessPanel` and `CohortDetailActions` so the panel and the publish refusal agree by construction (T-05-103). `DetailLayout mode="tabbed"` with four sections — Overview (`DetailFacts` covering offer target, enrolment window and dates with the D-23 timezone label via `utcToWallParts(...).label`, seats, price via `Intl.NumberFormat` currency formatting, delivery mode, seat-hold minutes, attendance threshold — plus `ReadinessPanel`), Sessions/Roster/Exceptions (each mounting the plan 05-13/05-14 tab components, badge = row count). Sessions/roster/exceptions are each loaded in their own try/catch and mapped to `DetailSection.error` on an authorization failure, so one denied permission degrades only that tab (T-05-105). The core load (cohort + readiness aggregate) shares a three-branch catch: `AuthenticationError` → session-ended line, `AuthorizationError` → `notFound()` (RBAC-06, matching `courses/[id]/page.tsx`), anything else rethrows; a missing cohort or a null readiness aggregate also calls `notFound()`.
- **`staff/layout.tsx`** — `Cohorts` → `/staff/cohorts`, `Enrolments` → `/staff/enrolments`; no other `NAV` entry changed.
- **`edit/page.tsx`** (deviation) — mounts `CohortForm mode="edit"`, pre-filling every field from the stored row (dates converted to `datetime-local` strings via a local formatter) and passing `updatedAt` as `expectedUpdatedAt` for `updateCohortAction`'s existing stale-check.

## Task Commits

1. **Task 1: Publish and cancel Server Actions with the detail action bar** — `72543bc` (feat)
2. **Task 2: Tabbed cohort detail page and staff nav wiring** — `b812385` (feat, includes the edit-route deviation)

**Plan metadata (SUMMARY.md/STATE.md/ROADMAP.md):** disk-only — `.planning/` is gitignored (sequential-execution-mode note, consistent with every prior Phase-5 plan).

## Files Created/Modified

- `src/app/staff/cohorts/[id]/publish-actions.ts` — publish/cancel Server Actions.
- `src/components/catalogue/CohortDetailActions.tsx` — the detail action bar + bespoke publish dialog.
- `tests/components/cohort-detail-actions.test.tsx` — the 5 load-bearing contract tests.
- `src/app/staff/cohorts/[id]/page.tsx` — the tabbed detail RSC.
- `src/app/staff/cohorts/[id]/edit/page.tsx` — the edit route (deviation).
- `src/app/staff/layout.tsx` — NAV wiring for Cohorts/Enrolments.

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: the publish confirmation is a small bespoke dialog (not `PublishDialog.tsx` reused verbatim) since cohorts never migrate; each tab's data load is isolated in its own try/catch so a single denied permission degrades one tab, not the whole record; the edit route was added as a Rule 2 deviation to give the required Edit link a real destination.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `CohortForm`'s edit mode had no mounting route**
- **Found during:** Task 1, designing `CohortDetailActions`' required "Edit" secondary link.
- **Issue:** The plan's action text requires an Edit link on the detail page, but `CohortForm` (plan 05-12) supports `mode="edit"` and no route in the codebase has ever mounted it — only `new/page.tsx` (create mode) exists. An Edit link with no destination would be a dead link, which the staff shell's own "nothing promises a page that does not exist" convention (`staff/layout.tsx`'s doc comment) exists specifically to avoid.
- **Fix:** Added `src/app/staff/cohorts/[id]/edit/page.tsx`, mirroring `new/page.tsx`'s courtesy-gate (`notFound()` on a denial or missing cohort) and best-effort published-offer-picker pattern, pre-filling `CohortForm`'s `values` from the stored row via a local `datetime-local` formatter and passing `updatedAt.toISOString()` as `expectedUpdatedAt`.
- **Files modified:** `src/app/staff/cohorts/[id]/edit/page.tsx` (new).
- **Verification:** `npx tsc --noEmit` exit 0; `npm run build` lists `/staff/cohorts/[id]/edit` as a compiled dynamic route; `npx eslint` clean.
- **Committed in:** `b812385` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical functionality)
**Impact on plan:** Additive only — fills a pre-existing gap from plan 05-12 so this plan's own required Edit link is not a dead end. No architectural change, no new dependency, no schema change.

## Issues Encountered

None beyond the deviation above. The first full `npm test` run showed two Testcontainers integration files (`attendance-service.integration.test.ts`, `reorder.integration.test.ts` — neither touched by this plan) failing with a 180s `beforeAll` hook timeout; this was Docker/DB container-startup contention from running `npm run build`, `npm run lint` and `npx tsc --noEmit` concurrently with the full suite in the same session. Re-running both files in isolation immediately afterward passed cleanly (22/22). The one remaining failure, `tests/password-reset-service.test.ts`'s lockout-reset case, is the pre-existing timing flake this phase's environment notes explicitly call out to ignore.

## Verification Results

- `npx vitest run tests/components/cohort-detail-actions.test.tsx` — 5/5 passed.
- `npx vitest run tests/components/cohort-detail-actions.test.tsx tests/components/readiness-panel.test.tsx tests/components/cohort-roster.test.tsx tests/components/attendance-mark.test.tsx tests/components/cohorts-table.test.tsx` — 37/37 passed.
- `npx vitest run tests/cohort-readiness.test.ts tests/cohort-service.test.ts` — 70/70 passed (evaluator and gate unchanged).
- `npx vitest run tests/components/ tests/boundary.test.ts tests/structure.test.ts` — 106/106 passed (no `@prisma/client` import in any route/component touched, route conventions intact).
- `npm test` (full suite, Testcontainers included) — 1007 passed / 1 pre-existing flake (`password-reset-service.test.ts`, documented) / 22 skipped, out of 1030; the two integration-file failures from container-startup contention under concurrent load both passed cleanly (22/22) when re-run in isolation.
- `npx tsc --noEmit` — exit 0. `npm run lint` — exit 0. `npm run build` — exit 0; `/staff/cohorts/[id]`, `/staff/cohorts/[id]/edit`, and `/staff/enrolments` all compile and list as dynamic (`ƒ`) routes.
- Grep gates (all per plan acceptance criteria): `evaluateCohortReadiness` in `publish-actions.ts` = 0, in `page.tsx` = 1; `must pass before it can be published` in `publish-actions.ts` = 1; `Someone else changed this cohort` in `publish-actions.ts` = 1; `blockingFailures` in `CohortDetailActions.tsx` ≥ 1; `minReasonLength` in `CohortDetailActions.tsx` ≥ 1; `@prisma/client` = 0 across all six files; `publish-actions.ts` starts with `"use server"` and exports `publishCohortAction`/`cancelCohortAction`; `notFound()` in `page.tsx` = 3; `mode="tabbed"` in `page.tsx` = 1; `"/staff/cohorts"`/`"/staff/enrolments"` in `staff/layout.tsx` = 1 each; `label: "Cohorts", href: null` in `staff/layout.tsx` = 0.

## Known Stubs

None — every field and action is wired to a real service call. `RosterTab`'s `siblingCohorts`/`candidateLearners` props are left unset on this page (as 05-14 documented as an intentional graceful-degradation default, not something this plan was scoped to wire) — the Transfer/Add-enrolment modals fall back to their existing text-input escape hatches, which is the same behaviour every other consumer of `RosterTab` already has today.

## Threat Flags

None beyond the plan's own threat register (T-05-99 … T-05-106), all of which the acceptance-criteria grep gates and the component/integration tests directly verify. The new `src/app/staff/cohorts/[id]/edit/page.tsx` route (the Rule 2 deviation) introduces no new authorization surface — it reuses `cohortService.get`'s existing `cohorts.view` gate and `updateCohortAction`'s existing `cohorts.manage` gate and `StaleOrderError` check verbatim, exactly as `new/page.tsx` already does for create.

## Next Phase Readiness

- The four tab section ids are `overview`, `sessions`, `roster`, `exceptions`.
- The cohort detail route is `/staff/cohorts/{id}` — plan 05-16's manual verification walks these tabs directly.
- The edit route is `/staff/cohorts/{id}/edit`.
- No blockers for 05-16.

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*

## Self-Check: PASSED

- `src/app/staff/cohorts/[id]/publish-actions.ts` — FOUND
- `src/components/catalogue/CohortDetailActions.tsx` — FOUND
- `tests/components/cohort-detail-actions.test.tsx` — FOUND
- `src/app/staff/cohorts/[id]/page.tsx` — FOUND
- `src/app/staff/cohorts/[id]/edit/page.tsx` — FOUND
- `src/app/staff/layout.tsx` — FOUND (modified)
- Commit `72543bc` — FOUND
- Commit `b812385` — FOUND
