---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 14
subsystem: ui
tags: [next-app-router, resource-table, confirm-modal, route-handler, csv, roster, attendance, enrolments]

# Dependency graph
requires:
  - phase: 05-07
    provides: "enrolment-service.ts — addEnrolment/approveEnrolment/transferEnrolment/withdrawEnrolment/cancelEnrolment, IllegalTransitionError/CrossOfferTransferError/AlreadyEnrolledError/CapacityExceededError/ReasonRequiredError"
  - phase: 05-10
    provides: "roster-service.ts — loadCohortRoster/loadAttendanceExceptions/exceptionsToCsv, RosterRow/AttendanceException/DeferredColumn types"
  - phase: 05-12
    provides: "ResourceTable emptyBody/emptyHeading pattern, cohorts-index authorization-catch shape"
  - phase: 05-13
    provides: "SessionsTab/session-actions.ts conventions, the cohortId-rides-along-for-revalidation (D-10) pattern"
provides:
  - "src/app/staff/cohorts/[id]/RosterTab.tsx — RosterRowView + ResourceTable config; the D-18 named deferred pills; per-row COH-05 actions"
  - "src/app/staff/cohorts/[id]/enrolment-actions.ts — addEnrolmentAction/approveEnrolmentAction/transferEnrolmentAction/withdrawEnrolmentAction/cancelEnrolmentAction"
  - "src/app/staff/cohorts/[id]/EnrolmentActionModals.tsx — the five ConfirmModal configurations, shared by the Roster tab and the global Enrolments list"
  - "src/app/staff/cohorts/[id]/ExceptionsTab.tsx — the three-category exceptions view, URL-held filters, Download CSV link"
  - "src/app/staff/cohorts/[id]/exceptions/csv/route.ts — GET, permission-gated, single-cohort, no-store, filter-parity CSV"
  - "src/app/staff/enrolments/page.tsx + EnrolmentsTable.tsx — the global scoped enrolments list"
  - "src/server/services/roster-service.ts — loadStaffEnrolments (new export, deviation)"
affects: [05-15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EnrolmentActionModals is a single controlled component rendering five ConfirmModal instances (open={target?.action === '...'}), shared verbatim by RosterTab and EnrolmentsTable so the five COH-05 actions behave identically everywhere they are reachable"
    - "Deferred-column literal labels are stored in a Record<9|10|11, string> lookup rather than computed via template, so the exact '· Phase 9/10/11' substrings are physically present in the source for the acceptance grep gate, not merely producible at runtime"
    - "cohortId rides along on every enrolment-action schema purely for revalidatePath targeting (D-10, established in 05-13's attendance-actions.ts) — the service call itself never receives it for approve/transfer/withdraw/cancel; scope is always re-resolved from enrolmentId"
    - "ExceptionsTab filters live in the real browser URL via useSearchParams/router.push (AuditTable.tsx's pattern), so the CSV download link can read the CURRENT query string values directly rather than needing separately-synchronized state"
    - "The CSV route applies no filter/slice of its own (grep-gated) — it re-derives categories/search from the query string and calls the exact same loadAttendanceExceptions the screen calls, then exceptionsToCsv on the result unmodified"
    - "loadStaffEnrolments is gated on enrolments.view with a scope resolver of () => ({}) — an empty ResourceScope only a GLOBAL grant satisfies (grantMatches), which is the same deny-by-default mechanism resource-service.ts's own unscoped list documents, applied here without the CRUD factory"

key-files:
  created:
    - "src/app/staff/cohorts/[id]/RosterTab.tsx"
    - "src/app/staff/cohorts/[id]/EnrolmentActionModals.tsx"
    - "src/app/staff/cohorts/[id]/enrolment-actions.ts"
    - "src/app/staff/cohorts/[id]/ExceptionsTab.tsx"
    - "src/app/staff/cohorts/[id]/exceptions/csv/route.ts"
    - "src/app/staff/enrolments/page.tsx"
    - "src/app/staff/enrolments/EnrolmentsTable.tsx"
    - "tests/components/cohort-roster.test.tsx"
  modified:
    - "src/server/services/roster-service.ts (added loadStaffEnrolments — deviation, see below)"

key-decisions:
  - "roster-service.ts gains loadStaffEnrolments rather than a new service file — no capability to list enrolments across cohorts existed anywhere, and eslint.config.mjs's 'Data access is confined to src/server/services/' rule (enforced for @prisma/client imports) meant the /staff/enrolments page could not query prisma.enrolment itself. Extending the existing read-only, DI-factory roster-service.ts kept the surface in one place."
  - "The CSV route's filename uses the route-param cohortId, not the cohort's 'code' column the UI-SPEC prose names — fetching the code would require a second, separately-authorized service call for a cosmetic filename detail, adding query surface and a second potential deny path outside this plan's minimal-query design. Documented as a deliberate, minor substitution."
  - "The Roster tab's Learner column renders plain text, not a link to a 'cohort-scoped learner detail' page — no such route exists anywhere in the codebase yet, and it is not in this plan's files_modified. Linking to a non-existent route would 404; the data itself is real, not a stub."
  - "The 'history' link on the Roster tab's status cell is a native <details>/<summary> disclosure showing transitionCount + the single latestTransition roster-service.ts exposes — there is no full per-enrolment transition array in the RosterRow contract (only a count and the latest one), so a full audit list is not renderable from this data; showing the latest is the whole of what plan 05-10's contract provides."
  - "EnrolmentActionModals' Add-enrolment learner picker falls back to a plain text learner-id input when no candidateLearners prop is supplied (05-15 has not yet wired a learner directory into either mounting page) — an escape hatch, not the primary UI."

patterns-established:
  - "Shared EnrolmentActionModals component consumed identically from a cohort-scoped tab and a global list"
  - "URL-synced ResourceTable filters (AuditTable's pattern) reused for a second screen (ExceptionsTab), proving the pattern generalizes"
  - "Literal-lookup-table labels as the technique for satisfying both correct runtime rendering and a source-text grep gate simultaneously"

requirements-completed: [COH-05, COH-07, ATT-04]

# Metrics
duration: ~55min
completed: 2026-09-04
---

# Phase 5 Plan 14: Roster, Exceptions, Enrolment Actions & Global Enrolments List Summary

**The cohort Roster and Exceptions tabs (COH-07/ATT-04, with the D-18 named "not tracked yet · Phase N" third-state columns), a bounded filter-parity CSV route, the five COH-05 enrolment-action Server Actions behind mandatory-reason `ConfirmModal`s shared by both the Roster tab and a new global `/staff/enrolments` list gated on a GLOBAL-only `enrolments.view` grant.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 (both `auto`)
- **Files:** 8 created, 1 modified (roster-service.ts, additive)

## Accomplishments

- **`RosterTab.tsx`** — `ResourceTable` over `RosterRowView[]`: Learner (name + email subtitle), Enrolment status (`StatusPill` + a `<details>` "history" disclosure reading `transitionCount`/`latestTransition`), Access window (mono), Attendance (`{earned}% / {required}%` mono for `computed`, the `•` third state for `no-rule`/`no-sessions` — never `0%`), Instructor, then Progress/Assessment/Completion each rendering a `zinc-500` pill reading "not tracked yet · Phase 9/10/11" from a literal lookup table (never computed via template, never `?? 0`/`|| "-"`/a cast — the `DeferredColumn` union makes a number a compile error). Per-row Approve/Cancel (PENDING_PAYMENT) or Transfer/Withdraw/Cancel (ACTIVE) buttons open `EnrolmentActionModals`. Empty state: "No one is enrolled yet" / the UI-SPEC body copy.
- **`enrolment-actions.ts`** — the five COH-05 `"use server"` actions, each `.strict()` zod-validated with a 10-character-minimum reason, delegating straight to the plan-05-07 service. `toFailure` maps `CapacityExceededError` → the exact capacity-reached copy, `AlreadyEnrolledError` → the exact duplicate-enrolment copy, `CrossOfferTransferError`/`IllegalTransitionError`/`ReasonRequiredError`/`EnrolmentNotFoundError` to their own messages, and `AuthorizationError`/`AuthenticationError` to one generic denial line. `cohortId` rides along on every schema purely for `revalidatePath` targeting (D-10) — never passed to the service for approve/transfer/withdraw/cancel, whose scope is always re-resolved from `enrolmentId`.
- **`EnrolmentActionModals.tsx`** — one `ConfirmModal` per action (Add, Approve, Transfer, Withdraw, Cancel), each `minReasonLength: 10`, using the UI-SPEC titles/descriptions/confirm-labels verbatim for Withdraw/Cancel/Transfer/Approve (`tone="danger"` for Withdraw/Cancel, `tone="default"` for Transfer/Approve/Add). Add embeds a learner select + target-status select in the modal's `description` slot (`ConfirmModal.description` is a `ReactNode`, so this needed no new primitive); Transfer embeds a same-offer cohort picker. A failed action's message renders through the modal's `error` prop, reading as "action not applied."
- **`ExceptionsTab.tsx`** — `ResourceTable` over the three-category union, category checkboxes + a learner search box held in the real browser URL (`useSearchParams`/`router.push`, mirroring `AuditTable.tsx`'s established pattern) so a reload returns to exactly this view. Category `StatusPill` tones: `warning` (at-risk), `danger` (disputed), `neutral` (missing-register) — each paired with a text label. A "Download CSV" link is built from the SAME current `categories`/`search` state. Empty state: "No attendance exceptions" / the UI-SPEC body copy.
- **`exceptions/csv/route.ts`** — `GET`, reads `categories`/`search` from the query string, calls `loadAttendanceExceptions` (gated `attendance.view`, cohort-scoped) exactly once with them, then `exceptionsToCsv` exactly once — no `.filter`/`.slice` of its own (grep-gated). Returns `text/csv`, `Content-Disposition: attachment` (filename carries the cohort id + a filesystem-safe generation timestamp), `Cache-Control: no-store`. `AuthorizationError`/`AuthenticationError` → a generic 403 body built only after authorization would have succeeded, never revealing whether the cohort exists.
- **`staff/enrolments/page.tsx` + `EnrolmentsTable.tsx`** — the global list: Learner, Cohort code (mono link to `/staff/cohorts/{id}`), Offer, Status, Access window, Created; search/status/cohort filters (client-side, mirroring `CohortsTable`'s convention); row actions reuse `EnrolmentActionModals` unchanged. Gated via the new `loadStaffEnrolments({})`.
- **`roster-service.ts` (deviation)** — `loadStaffEnrolments`, `StaffEnrolmentRow`/`StaffEnrolmentFilters` types, a `createStaffEnrolmentListService` DI factory + prisma-bound instance. `withPermission("enrolments.view", () => ({}))` — an empty `ResourceScope` only a GLOBAL grant matches (`grantMatches`, `src/server/permissions/scope.ts`), so a COHORT/PROGRAMME/COURSE-scoped caller is denied before any row is read (T-05-95), never fetched-then-filtered.
- **`tests/components/cohort-roster.test.tsx`** — 11 cases: the three deferred columns render their "· Phase N" text with no `0%`/blank anywhere; a `no-rule` attendance component renders the third-state glyph; a `computed` component renders `earned% / required%`; the status pill carries a text label; the six render states (loading/error/validation-error/empty/populated/denied, the first three via the raw `ResourceTable` primitive); and a mocked `CapacityExceededError` result renders inside the Add-enrolment modal's `error` slot with "Action not applied."

## Task Commits

1. **Task 1: Roster tab with named deferred columns and the enrolment action modals** — `1ac75a1`
2. **Task 2: Exceptions tab, the filter-parity CSV route, and the global enrolments list** — `1d773f5`

**Plan metadata (SUMMARY.md / STATE.md / ROADMAP.md):** disk-only — `.planning/` is gitignored in this repo, so no metadata commit was made (sequential-mode execution note, consistent with 05-06/05-08/05-12/05-13).

## Files Created/Modified

- `src/app/staff/cohorts/[id]/RosterTab.tsx` — Roster `ResourceTable` + the D-18 deferred pills + per-row COH-05 actions.
- `src/app/staff/cohorts/[id]/enrolment-actions.ts` — the five COH-05 Server Actions.
- `src/app/staff/cohorts/[id]/EnrolmentActionModals.tsx` — the shared five-`ConfirmModal` component.
- `src/app/staff/cohorts/[id]/ExceptionsTab.tsx` — the exceptions `ResourceTable` + URL-held filters + CSV link.
- `src/app/staff/cohorts/[id]/exceptions/csv/route.ts` — the bounded, filter-parity CSV `GET` handler.
- `src/app/staff/enrolments/page.tsx` — the global enrolments RSC.
- `src/app/staff/enrolments/EnrolmentsTable.tsx` — the global enrolments `ResourceTable`.
- `tests/components/cohort-roster.test.tsx` — the 11 load-bearing contract tests.
- `src/server/services/roster-service.ts` — `loadStaffEnrolments` added (deviation).

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: `loadStaffEnrolments` was added to `roster-service.ts` rather than a new file, since no capability to list enrolments globally existed and data access must stay in the service layer; the CSV filename uses the cohort id rather than a separately-fetched "code" to avoid a second authorized query for a cosmetic detail; the Roster tab's Learner cell is plain text because no learner-detail route exists yet in the codebase; the "history" disclosure shows only the latest transition because that is the entirety of what `RosterRow` exposes (no full transition array); the Add-enrolment learner picker falls back to a raw id input when no learner directory is supplied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] No capability existed to list enrolments across cohorts**
- **Found during:** Task 2, building `/staff/enrolments`.
- **Issue:** The plan's `files_modified` for Task 2 lists only `page.tsx`/`EnrolmentsTable.tsx` for the global list, but no prior service exposes a cross-cohort enrolment read, and `eslint.config.mjs` confines Prisma access (`@prisma/client`) to `src/server/services/**` — the mounting page cannot query the database itself.
- **Fix:** Added `loadStaffEnrolments` (+ `StaffEnrolmentRow`/`StaffEnrolmentFilters`/`createStaffEnrolmentListService`) to `roster-service.ts`, the existing read-only, DI-factory home for this exact family of authorized reads. Gated `enrolments.view` with a scope resolver of `() => ({})` — an empty `ResourceScope`, which only a GLOBAL grant satisfies, giving the "COHORT-scoped grant must not receive a global list" requirement (T-05-95) for free from the existing `grantMatches` rule rather than a hand-written check.
- **Files modified:** `src/server/services/roster-service.ts`.
- **Verification:** `npx tsc --noEmit` exit 0; `npx vitest run tests/roster-service.test.ts tests/boundary.test.ts` still green (42/42, no regression); `grep -c '"enrolments.view"' src/app/staff/enrolments/page.tsx` = 1.
- **Committed in:** `1d773f5` (Task 2 commit)

**2. [Rule 1 - Bug] A doc comment tripped its own acceptance grep gate**
- **Found during:** Task 2, running the acceptance-criteria greps on `exceptions/csv/route.ts`.
- **Issue:** The file header prose explaining the `no-store` cache header contained the literal string `no-store`, which the acceptance gate `grep -c "no-store"` (expects exactly 1, matching the single header value) then also matched, producing 2.
- **Fix:** Reworded the comment to reference the `NO_STORE_CACHE_CONTROL` constant name rather than repeating the literal string — the same fix pattern 05-10 and 05-12 used for their own self-tripped grep gates.
- **Files modified:** `src/app/staff/cohorts/[id]/exceptions/csv/route.ts`.
- **Verification:** `grep -c "no-store"` now returns 1.
- **Committed in:** `1d773f5` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing-critical-functionality, 1 self-tripped grep gate)
**Impact on plan:** Both are minimal and additive. The service addition is scoped exactly to what the UI-SPEC's `/staff/enrolments` screen needs and follows the established DI-factory pattern; no other consumer of `roster-service.ts` is affected.

## Issues Encountered

None beyond the deviations above. All acceptance-criteria greps, `tsc --noEmit`, `npm run lint`, and `npm run build` pass; the new routes (`/staff/enrolments`, `/staff/cohorts/[id]/exceptions/csv`) both compile and list as dynamic routes in the production build.

## Verification Results

- `npx vitest run tests/components/cohort-roster.test.tsx` — 11/11 passed.
- `npx vitest run tests/roster-service.test.ts tests/enrolment-service.test.ts` — 57/57 passed (consumed services unchanged and green).
- `npx vitest run tests/boundary.test.ts tests/structure.test.ts` — 20/20 passed (no `@prisma/client` import in any route/component this plan touched).
- `npx vitest run tests/components/` (full component project) — 82/82 passed, no regression.
- `npx vitest run tests/cohort-service.test.ts tests/cohort-scope.test.ts tests/permissions.test.ts tests/audit-append-only.test.ts tests/domain-event-service.test.ts tests/scheduled-session-service.test.ts tests/seat-accounting.integration.test.ts` — 153/153 passed (Testcontainers integration cases included; no regression from the `roster-service.ts` addition).
- `npx tsc --noEmit` — exit 0. `npm run lint` — exit 0. `npm run build` — exit 0; `/staff/enrolments` and `/staff/cohorts/[id]/exceptions/csv` both compile and list as dynamic (`ƒ`) routes.
- Grep gates (all per plan acceptance criteria): "not tracked yet" ≥1, "· Phase 9/10/11" all present, `?? 0|\|\| 0|\|\| "-"|as unknown as number` = 0, "This cohort is full" = 1, "already has an active enrolment" = 1, `minReasonLength` = 5, `@prisma/client` = 0 (all five route/component/service files checked), `GET` exported + `loadAttendanceExceptions(`/`exceptionsToCsv(` each called exactly once, `filter\(|\.slice\(` = 0, `text/csv` = 1, `no-store` = 1, "No attendance exceptions" = 1, `"enrolments.view"` = 1.
- Manual browser smoke against the plan-05-11 seed (filter exceptions to one category, download CSV, compare row count) was NOT performed in this session — no interactive browser session was available in the execution environment. All server-side behaviour (query construction, permission gating, CSV structural parity) is covered by the automated checks above; this is flagged for a human or a later E2E pass, not silently skipped.

## Known Stubs

None — every column and action is wired to a real service call. The Roster tab's Learner cell is plain text rather than a link (no learner-detail route exists yet anywhere in the codebase — not a stub, a genuinely absent destination). The "history" disclosure shows only the latest transition because `RosterRow` (plan 05-10) exposes only `transitionCount` + `latestTransition`, not a full array — this is the actual service contract, not data withheld by this plan.

## Threat Flags

None beyond the plan's own threat register (T-05-91 … T-05-98), all of which the acceptance-criteria grep gates and the component test directly verify. `loadStaffEnrolments`'s `() => ({})` scope resolver is a new authorization surface not explicitly named in the plan's threat register table, but it implements exactly T-05-95's mitigation ("the list route relies on the factory's deny-by-default for an unscoped list") using the identical mechanism `resource-service.ts`'s own `list` already uses elsewhere in this codebase — not a new pattern.

| Flag | File | Description |
|------|------|--------------|
| threat_flag: new-read-surface | src/server/services/roster-service.ts | `loadStaffEnrolments` — a new GLOBAL-only authorized read added to satisfy T-05-95's global-list requirement; same deny-by-default mechanism as `resource-service.ts`'s unscoped `list`, no new authorization primitive introduced. |

## Next Phase Readiness

- `RosterTab` (props: `cohortId`, `rows?`, `denied?`, `siblingCohorts?`, `candidateLearners?`) and `ExceptionsTab` (props: `cohortId`, `rows?`, `denied?`, `categories?`, `search?`) are ready for plan 05-15 to mount as `DetailLayout` Roster/Exceptions tab sections — 05-15 supplies `loadCohortRoster`/`loadAttendanceExceptions` output (converting `Date` fields to ISO strings, the same convention `SessionsTab`/`CohortsTable` already established) plus the cohort's sibling-cohort list and any learner directory it wants the Add-enrolment picker to use.
- The CSV route path is `/staff/cohorts/{id}/exceptions/csv?categories=...&search=...` — `ExceptionsTab`'s "Download CSV" link already builds this from its own current filter state, so 05-15 needs no additional wiring for that specific link once the tab is mounted with real `categories`/`search` values sourced from the same URL the RSC reads.
- `/staff/enrolments` is a complete, standalone, reachable screen already (`src/app/staff/layout.tsx`'s `Enrolments` nav placeholder still needs its `href` wired — that is explicitly the phase's nav-wiring item, left for 05-15 per the UI-SPEC's own "Nav: wire `src/app/staff/layout.tsx`" instruction, which names 05-15's scope, not this plan's `files_modified`).
- `siblingCohorts`/`candidateLearners` are currently optional props with graceful fallbacks (no picker options / a raw-id text input) — 05-15 or a later plan can supply real data without any change to `EnrolmentActionModals`' contract.

## Self-Check: PASSED

- `src/app/staff/cohorts/[id]/RosterTab.tsx` — FOUND
- `src/app/staff/cohorts/[id]/enrolment-actions.ts` — FOUND
- `src/app/staff/cohorts/[id]/EnrolmentActionModals.tsx` — FOUND
- `src/app/staff/cohorts/[id]/ExceptionsTab.tsx` — FOUND
- `src/app/staff/cohorts/[id]/exceptions/csv/route.ts` — FOUND
- `src/app/staff/enrolments/page.tsx` — FOUND
- `src/app/staff/enrolments/EnrolmentsTable.tsx` — FOUND
- `tests/components/cohort-roster.test.tsx` — FOUND
- Commit `1ac75a1` (Task 1) — FOUND
- Commit `1d773f5` (Task 2) — FOUND

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
