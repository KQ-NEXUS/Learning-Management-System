---
phase: 14-software-licence-deployment-control
plan: 10
subsystem: licensing
tags: [licence, status-screen, view-model, rsc, detail-layout, nav, lic-02, lic-03, d-06, d-11, d-14]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-04 LicenceStatusSnapshot, deriveState, daysUntil; 14-06 policy.ts, display.ts, effects.ts; 14-07 licenceService.getStatusSnapshot; 14-DECISIONS.md OQ1 option-a"
provides:
  - "src/server/licence/view-model.ts: buildLicenceStatusView, LicenceStatusViewModel (pure snapshot to display-ready model)"
  - "src/server/services/licence-staff-service.ts: createLicenceStaffService, licenceStaffService.getStatusForStaff (licence.view, Global only)"
  - "src/app/staff/licence/{page,loading,LicenceStatusView,CopyButton}.tsx: the /staff/licence screen with activationSlot and diagnosticSlot for plan 14-15"
  - "Nav entry Licence under Administration (licence.view, global check) with KeyRound icon"
affects: [14-11, 14-15, 14-18, 14-21]

estimate:
  tokens: 70000
  raw_tokens: 70000
  tasks: 3
  confidence: low
actuals:
  tokens: 18300
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "View model re-derives the clock-based states from the injected now with the same deriveState the service uses, so a render at an exact boundary shows that boundary's state and figure"
    - "Page sections with nothing to show return null content so DetailLayout draws no empty heading (activation before 14-15, data block with no slot and no reports access)"
    - "Authorization inside the service before the licence read; the page answers every unauthorized actor with the same denied element, built with no view model so nothing can leak"

key-files:
  created:
    - src/server/licence/view-model.ts
    - src/server/services/licence-staff-service.ts
    - src/app/staff/licence/page.tsx
    - src/app/staff/licence/loading.tsx
    - src/app/staff/licence/LicenceStatusView.tsx
    - src/app/staff/licence/CopyButton.tsx
    - tests/licence-status-view.test.ts
    - tests/components/licence-status.test.tsx
    - tests/licence-staff-access.test.ts
    - tests/licence-page.test.ts
  modified:
    - src/app/staff/layout.tsx
    - src/app/staff/StaffShell.tsx
    - tests/staff-layout-nav.test.ts

key-decisions:
  - "buildLicenceStatusView uses `now` to re-derive ACTIVE, EXPIRING_SOON, GRACE and RESTRICTED_CONTINUITY from the signed expiresAt and graceEndsAt (same deriveState as the service); NOT_ACTIVATED, INVALID and VALIDATION_ATTENTION are taken from the snapshot unchanged."
  - "The 'What is blocked' list follows the restriction flag (snapshot.isRestricted for non-clock states), not the state name, so a Check pending deployment that was restricted when the window opened still lists what is blocked; the screen cannot promise more than enforcement allows."
  - "The deployment ID Copy icon button required by the UI-SPEC (44px, aria-label 'Copy deployment ID') is a small client component, CopyButton.tsx, because the plan's file list omitted it."
  - "The empty state replaces the figure and summary for a deployment that never activated (everActivated false and no licence ID); the Not activated pill, Not available rows and agreement fallback line remain."

patterns-established:
  - "Plan 14-15 passes activationSlot and diagnosticSlot to LicenceStatusView from page.tsx; until then a holder of licence.activate sees no Activate heading"
  - "Plan 14-11 and later banner work can reuse buildLicenceStatusView's effective state and policy.bannerCopy"

requirements-completed: []

coverage:
  - id: C1
    description: "LIC-02, D-14: state, licence ID, client, deployment ID, exact UTC expiry and grace end with the licence zone, days remaining, last verification, works and blocked lists, renewal and support contact, and no signing material"
    requirement: "LIC-02"
    verification:
      - kind: unit
        ref: "tests/licence-status-view.test.ts and tests/components/licence-status.test.tsx (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "LIC-03: no control that creates, extends, edits, replaces a signature on or reactivates a licence; the only write control is the activation slot"
    requirement: "LIC-03"
    verification:
      - kind: unit
        ref: "tests/components/licence-status.test.tsx accessible-name and no-form assertions (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "D-11 and boundaries: exact expiry instant, one second either side, grace end, leap day 2028-02-29, each with the paired UTC string; Under 24 hours and 1 day figures"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-status-view.test.ts boundaries describe (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "T-14-10-01 and T-14-10-03: authorization before the licence read; identical denied response whatever the licence state; fixed load-error copy; nav item gated by the global licence.view check"
    requirement: "LIC-02"
    verification:
      - kind: unit
        ref: "tests/licence-staff-access.test.ts, tests/licence-page.test.ts, tests/staff-layout-nav.test.ts (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "Long-text and overflow backstops: 200-character client name and 120-character renewal email wrap inside the sheet at 1280px and 320px; right rail stacks under 1024px"
    requirement: "LIC-02"
    verification:
      - kind: human
        ref: "Task 3 human check (outstanding; class contract asserted by a component test)"
        status: pending
    human_judgment: true

duration: ~40min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 10: Licence & System Status Screen Summary

**A pure snapshot-to-view-model builder, a licence.view-gated staff service, and the /staff/licence page (all seven states, empty state, rail variants, denied and error states) with a nav entry, loading skeleton and slots for the activation panel and diagnostic download that plan 14-15 supplies.**

## Performance

- **Duration:** about 40 min
- **Completed:** 2026-10-01
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 10 created, 3 modified

## Accomplishments

- `view-model.ts` turns the allow-listed `LicenceStatusSnapshot` into plain strings and flags: pill, the days figure and caption, summary, the seven facts in UI-SPEC order (each instant as `31 Mar 2027, 23:59 WAT` with `2027-03-31T22:59:59Z` beside it and the zone name once under the first date), the clock-rollback note only while `clockAlertAt` is set, works and blocked lists from `RESTRICTED_CAPABILITIES`, the "What happens after {graceEnd}" list, renewal block (phone and hours omitted when null), fallback line, empty state, and the two permission flags. Every sentence comes from `policy.ts`; a test asserts neither the view model nor the component sources type the post-grace phrase or read-only wording.
- `licence-staff-service.ts` wraps `getStatusSnapshot` in `withPermission("licence.view", () => ({}))`, so authorization (Global scope only) runs before the licence is read.
- `page.tsx` calls the service and `can("licence.activate")`, `can("reports.view")` in one try: AuthenticationError gives `SessionEnded`; AuthorizationError gives the denied state with permission `licence.view` (no view model, same element for every licence state); anything else gives `LOAD_ERROR_MESSAGE` and never `error.message`.
- `LicenceStatusView.tsx` renders `DetailLayout` stacked: Status (28px figure, 22px when the figure text exceeds 9 characters, caption, summary, clock note, or the empty state), Licence details, What works and what is blocked with the preserved-data note, and the right rail (Renewal and support, Activate a licence slot or the permission note, Data and diagnostics with the exports link only for `reports.view`). No create, extend, edit, replace or reactivate control exists. No CSS or token was added.
- Nav: `Licence` after Email log under Administration, `NAV_PERMISSION["/staff/licence"] = "licence.view"` (not in `SCOPE_AWARE_SECTIONS`), `KeyRound` icon; `loading.tsx` aria-busy skeleton.
- Tracer proven end to end: an active snapshot (expiry 2027-03-31T22:59:59Z, now 2026-10-01T12:00Z) renders figure 182, "31 Mar 2027, 23:59 WAT" with its UTC pair, both capability lists and the exports link.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): view-model.ts, licence-staff-service.ts, page.tsx, LicenceStatusView.tsx, tests. Commit: none (owner policy)
2. Task 2: layout.tsx, StaffShell.tsx, loading.tsx, staff-layout-nav tests. Commit: none (owner policy)
3. Task 3: all seven states, empty state, rail variants, denied and error tests. Commit: none (owner policy)

TDD gate: the implementation was written before its tests (the date and figure expectations were reasoned from the UI-SPEC and plan 14-06 outputs, then confirmed by the first run), so no separate RED run exists. No `test(...)`/`feat(...)` git commits exist because commits are prohibited by owner policy. The tracer gate (re-run `<verify>` end to end, auto-chain flag false, interactive default end-of-phase with automated-only verify) was satisfied by the passing runs below before the expansion tasks.

## Verification Results (real output)

- `npx vitest run tests/licence-status-view.test.ts tests/components/licence-status.test.tsx tests/staff-layout-nav.test.ts tests/components/staff-shell.test.tsx tests/licence-purity.test.ts tests/licence-staff-access.test.ts tests/licence-page.test.ts`: 7 files passed, 112 tests passed, 0 failed (13.70 s). Per file: licence-status-view 34, licence-status (component) 20, licence-staff-access 4, licence-page 5; staff-layout-nav and staff-shell and licence-purity make up the rest.
- `npx tsc --noEmit`: exit 0, no output (0 errors; no new error).
- `npx eslint src/app/staff/licence src/server/licence src/server/services/licence-staff-service.ts src/app/staff/layout.tsx src/app/staff/StaffShell.tsx` plus the five touched test files: exit 0, no output.
- Acceptance greps: `layout.tsx:57 "/staff/licence": "licence.view"`; `StaffShell.tsx` lines 11 and 53 contain `KeyRound`; `page.tsx:33` has `permission: "licence.view"` in the denied state.
- Next.js 16.3.4 docs read before writing: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` (layouts do not re-render on soft navigation; the layout edit adds only a nav constant, so nothing there depends on it).
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-10-PLAN.md LIC-02 LIC-03`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-02",
    "LIC-03"
  ],
  "total": 2
}
```

  No requirement was marked complete (both are blocked; LIC-03's write path, the activation panel, is plan 14-15).

## Files Created/Modified

- `src/server/licence/view-model.ts` - pure builder and the `LicenceStatusViewModel` type
- `src/server/services/licence-staff-service.ts` - permission-wrapped staff read
- `src/app/staff/licence/page.tsx` - server component, error and denial mapping
- `src/app/staff/licence/loading.tsx` - aria-busy skeleton
- `src/app/staff/licence/LicenceStatusView.tsx` - presentational screen with the two slots
- `src/app/staff/licence/CopyButton.tsx` - 44px copy-deployment-ID icon button (client)
- `src/app/staff/layout.tsx`, `src/app/staff/StaffShell.tsx` - nav entry, permission map, icon
- `tests/licence-status-view.test.ts`, `tests/components/licence-status.test.tsx`, `tests/licence-staff-access.test.ts`, `tests/licence-page.test.ts`, `tests/staff-layout-nav.test.ts`

## Decisions Made

See key-decisions. Copy not dictated verbatim by the UI-SPEC: the labels "Renewal contact:" (subtitle), "Renewal email", "Support email", "Phone", "Hours" in the rail; the rest of the licence wording is imported from `policy.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Copy deployment ID button from the UI-SPEC was not in the plan's task text**
- **Found during:** Task 1 (reading the UI-SPEC Licence details row)
- **Issue:** The UI-SPEC requires a 44px "Copy" icon button, aria-label "Copy deployment ID", on the Deployment ID row; plan 14-10 and 14-15 do not build it, and clipboard access needs a client component.
- **Fix:** Added `src/app/staff/licence/CopyButton.tsx` (client, polite live-region "Copied") and used it only when a deployment ID exists. Its accessible name does not match any forbidden control name; tests cover it.
- **Files modified:** src/app/staff/licence/CopyButton.tsx, src/app/staff/licence/LicenceStatusView.tsx, tests/components/licence-status.test.tsx
- **Commit:** none (owner policy)

**2. [Rule 2 - Missing critical functionality] Direct tests for T-14-10-01 and T-14-10-03 were not in the plan's file list**
- **Found during:** Task 1 (threat register review)
- **Issue:** The register's mitigations (authorization before the licence read, identical denied response whatever the state, fixed error copy) had no test that would fail if the page or service stopped authorizing first.
- **Fix:** Added `tests/licence-staff-access.test.ts` (real service over an injected guard: Global holder allowed, no grant, narrower scope and anonymous all denied with the licence never read, denial audited) and `tests/licence-page.test.ts` (page output for five licence states under denial is identical; session-ended; fixed load-error copy never carries the error message).
- **Files modified:** tests/licence-staff-access.test.ts, tests/licence-page.test.ts
- **Commit:** none (owner policy)

### Interpretation choices (no behaviour change to the plan's listed tests)

- `now` is meaningful in the view model: clock-based states are re-derived from `now` (see key-decisions), which is what lets the boundary tests fix `now` at the exact expiry instant, one second either side and the leap day. A snapshot evaluated at the same moment gives identical output; a page rendered a few seconds after evaluation can differ by at most that boundary.
- The Blocked list follows the restriction flag rather than the state name (Check pending with `isRestricted` true lists the blocked items).
- Sections with nothing to show draw no heading: the "Activate a licence" section for a licence.activate holder until plan 14-15 passes `activationSlot`, and "Data and diagnostics" with no slot and no `reports.view`. The plan said the page renders the permission note and exports link itself; both do render.
- The plan's human check lists focus order as "Open data exports, then any slot controls". DOM order follows the UI-SPEC (main column first, then the rail: renewal mailto links, activation slot, diagnostic slot, then Open data exports). The human check below uses DOM order.
- Not-activated State row shows the pill only (no "Not available"); Last verification shows its neutral "Not checked yet" pill with no value text.

**Total deviations:** 2 auto-added (Rule 2), 0 bugs. **Impact:** none breaks the interface contract (`getStatusForStaff`, `buildLicenceStatusView(snapshot, { canActivate, canViewReports, now })`, component props `{ vm?, canActivate, state?, activationSlot?, diagnosticSlot? }` are unchanged).

## Issues Encountered

None.

## Known Stubs

None. `activationSlot` and `diagnosticSlot` are intentional, documented extension points for plan 14-15 (the page passes nothing yet, so the activation panel and diagnostic download do not render); this is the plan's own design, not placeholder data.

## Threat Flags

None beyond the plan's register. T-14-10-01 (authorization first, identical denial, nav gated by the same permission), T-14-10-02 (allow-listed snapshot, fixed error copy, serialisation test for key ID and schema version), T-14-10-03 (denied element carries no view model), and T-14-10-04 (no create, extend, edit, replace or reactivate control; accessible-name and no-form assertions) are covered by tests.

## Outstanding human UAT (browser verification was not possible)

Run with the dev server against a seeded licence, as an Administrator, then as staff without `licence.view`:

1. Set a test licence's client name to 200 characters and renewal email to 120 characters; confirm no overflow of the content sheet at 1280px, 320px width and 200% zoom (value wraps; right rail stacks below the main column under 1024px; no horizontal scrollbar).
2. Tab through the page: focus order follows the DOM (renewal and support mailto links, the Copy deployment ID button comes earlier in the main column, then any activation and diagnostic slot controls, then Open data exports) with the 2px accent focus ring visible.
3. Confirm no state is communicated by colour alone (each pill and note has a text label; icons are decorative).
4. Sign in as staff without `licence.view`: `/staff/licence` shows the denied panel and the sidebar has no Licence item.
5. Visual review of the figure sizes: 28px for short figures, 22px for "Under 24 hours" and the restricted/invalid captions; the 28px/22px steps are authored by this plan, no new tokens.

Recorded in `.planning/WINDOWS.md` as an `unrun-verify` entry. The 14-03 database apply remains an outstanding human step (WINDOWS.md entry id 20); this plan does not depend on the live database (no Prisma command was run against the configured DATABASE_URL).

## Next Phase Readiness

- Plan 14-15 supplies `ActivateLicenceForm` as `activationSlot` and the diagnostic download as `diagnosticSlot` in `page.tsx` (both slots exist and are wired to the permission rules).
- Plan 14-11 (banner) can reuse the `staff/layout.tsx` try/catch pattern and `policy.bannerCopy`; the layout edit here did not touch the banner or `bell`.

## Self-Check: PASSED

- FOUND on disk: src/server/licence/view-model.ts; src/server/services/licence-staff-service.ts; src/app/staff/licence/page.tsx; src/app/staff/licence/loading.tsx; src/app/staff/licence/LicenceStatusView.tsx; src/app/staff/licence/CopyButton.tsx; tests/licence-status-view.test.ts; tests/components/licence-status.test.tsx; tests/licence-staff-access.test.ts; tests/licence-page.test.ts; tests/staff-layout-nav.test.ts (modified); src/app/staff/layout.tsx and StaffShell.tsx (modified).
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-01*
