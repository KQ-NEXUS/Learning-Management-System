---
phase: 14-software-licence-deployment-control
plan: 15
subsystem: licensing
tags: [licence, activation, server-actions, diagnostic-download, route-handler, lic-02, lic-03, lic-06, d-14, d-07, oq3]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-07 licenceService.inspect and licenceActivationService.activateLicence; 14-09 buildDiagnosticReport and DIAGNOSTIC_REPORT_KEYS; 14-06 policy.ts sentences; 14-10 licenceStaffService, page and LicenceStatusView slots; 14-DECISIONS.md D-02 option-a, OQ1 option-a, OQ3"
provides:
  - "src/server/services/licence-staff-service.ts: inspectLicenceForStaff, activateLicenceForStaff (licence.activate, explicit continuity), getDiagnosticForStaff (licence.view, audited licence.diagnostic_downloaded)"
  - "src/app/staff/licence/actions.ts: inspectLicenceAction and activateLicenceAction (closed fixed messages, input hygiene, revalidation)"
  - "src/app/staff/licence/ActivateLicenceForm.tsx: two-step activation form with verified preview and ConfirmModal"
  - "src/app/staff/licence/DiagnosticDownloadButton.tsx and src/app/api/staff/licence/diagnostic/route.ts (GET)"
affects: [14-16, 14-17, 14-18, 14-21]

estimate:
  tokens: 75000
  raw_tokens: 75000
  tasks: 3
  confidence: low
actuals:
  tokens: 21600
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Staff service declares the activation pair with an explicit { licence: 'continuity', reason } option and a generic TInput so the handler input is typed, and passes ctx.actor.userId (not a client value) to the activation service"
    - "A use-server file exports only async functions and types; helpers stay module-private; results are fixed sentences from the closed rejection set"
    - "Route handler maps AuthenticationError to 401 JSON, AuthorizationError to an empty 404, everything else to a fixed 500, all with Cache-Control private, no-store and no route segment config export"
    - "Client form imports pure policy.ts constants directly (format.ts top level only needs zod, so it bundles safely) and calls the actions with the text it holds, never preview data"

key-files:
  created:
    - src/app/staff/licence/actions.ts
    - src/app/staff/licence/ActivateLicenceForm.tsx
    - src/app/staff/licence/DiagnosticDownloadButton.tsx
    - src/app/api/staff/licence/diagnostic/route.ts
    - tests/licence-staff-service.test.ts
    - tests/licence-actions.test.ts
    - tests/licence-diagnostic-route.test.ts
    - tests/components/licence-activate-form.test.tsx
    - tests/components/licence-diagnostic-button.test.tsx
  modified:
    - src/server/services/licence-staff-service.ts
    - src/app/staff/licence/page.tsx
    - tests/licence-staff-access.test.ts
    - tests/licence-page.test.ts

key-decisions:
  - "OQ3 (adopted default, visible): the seeded Administrator role keeps licence.activate through the full permission spread (prisma/seed.ts permissions: [...PERMISSIONS]), deviating from PRD 18.4 'deliberately restricted'. Recorded in 14-DECISIONS.md; the client can create a narrower custom role before launch. This plan's activation functions work in restricted continuity mode so the recovery route cannot be locked out (D-07, D-14)."
  - "A failed audit write fails the diagnostic request (500): LIC-06 says no download without evidence."
  - "Activation success is reported only through the action result and the revalidated page; the form makes no client navigation call."

patterns-established:
  - "Plan 14-17 can register inspectLicenceForStaff and activateLicenceForStaff as the licence.activate continuity call sites; the activation service still performs no authorization and its only caller is licence-staff-service.ts"
  - "Plan 14-21 proves OQ3 end to end with a restricted-state activation test using the seeded Administrator grants"

requirements-completed: [LIC-03]

coverage:
  - id: C1
    description: "LIC-03: only a Global licence.activate holder can inspect or activate; a licence.view-only actor gets AuthorizationError and the activation fake is called zero times; the screen has no create, extend, edit, replace or reactivate control"
    requirement: "LIC-03"
    verification:
      - kind: unit
        ref: "tests/licence-staff-service.test.ts Tests 1 and 2 and narrower-scope case; tests/components/licence-activate-form.test.tsx Test 8 (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "D-14, D-07: activation and inspection declared { licence: 'continuity' } and run behind a blocking licence guard while a write-class call is refused"
    requirement: "LIC-03"
    verification:
      - kind: unit
        ref: "tests/licence-staff-service.test.ts Test 3 (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "Pattern 12 and D-14 input hygiene: inspect persists nothing, activate re-verifies the submitted text, 8192-character and A-Za-z0-9._- checks before the service, closed sentences, no unverified text echoed, error name only in logs"
    requirement: "LIC-03"
    verification:
      - kind: unit
        ref: "tests/licence-actions.test.ts Tests 4 to 7 incl. 11 malformed-input cases; tests/components/licence-activate-form.test.tsx Tests 2, 4, 6 (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "UI Considerations interaction contract: Checking… with aria-busy, pending ConfirmModal, focus into the dialog, back to Activate licence on cancel, ESC unless pending, success note focused once, last-set of file and paste wins"
    requirement: "LIC-03"
    verification:
      - kind: unit
        ref: "tests/components/licence-activate-form.test.tsx Tests 1, 3, 6, 7 (pass; jsdom)"
        status: pass
      - kind: human
        ref: "Task 2 human check (outstanding, no browser)"
        status: pending
    human_judgment: true
  - id: C5
    description: "LIC-02, LIC-06, D-17: diagnostic returns only DIAGNOSTIC_REPORT_KEYS as an attachment named licence-diagnostic-{id or not-activated}-{YYYYMMDD}.json, Cache-Control private, no-store, 401 no session, empty 404 denied, fixed 500, audited licence.diagnostic_downloaded with the actor"
    requirement: "LIC-06"
    verification:
      - kind: unit
        ref: "tests/licence-diagnostic-route.test.ts and tests/licence-staff-service.test.ts diagnostic describe (pass)"
        status: pass
    human_judgment: false
  - id: C6
    description: "Long-text backstop: a 120-character file name truncates with an ellipsis in the chooser row and never widens the right rail"
    requirement: "LIC-03"
    verification:
      - kind: human
        ref: "Task 2 human check item 4 (outstanding; truncate, min-w-0 and flex-1 classes are in place but unverified visually)"
        status: pending
    human_judgment: true

duration: ~45min
completed: 2026-10-02
status: complete
---

# Phase 14 Plan 15: Licence Activation and Diagnostic Download Summary

**Permission-wrapped two-step licence activation (verify-only inspect, then re-verifying activate that runs in restricted continuity mode) with a verified-preview form, plus an audited, no-store diagnostic report download limited to the D-14 allow-list.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-10-02
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 9 created, 4 modified

## Accomplishments

- `licence-staff-service.ts` gains `inspectLicenceForStaff` and `activateLicenceForStaff`, both `withPermission("licence.activate", () => ({}), { licence: "continuity", reason })` (Global only), so they run in restricted continuity mode while a write-class call behind the same guard is refused. `activateLicenceForStaff` passes `ctx.actor.userId` and the submitted text to `activateLicence`; the activation service still does no authorization of its own. `getDiagnosticForStaff` is gated on `licence.view` and writes `licence.diagnostic_downloaded` (actorId, targetType LICENCE, targetId the licence id or null, scope GLOBAL, outcome SUCCESS, no before or after).
- `actions.ts` (use server) validates with a strict zod schema, trims, enforces 1 to 8192 characters and `^[A-Za-z0-9._-]+$` before the service is called, and returns `{ ok, ... }` results built only from the closed sentence set. Inspect returns a preview of preformatted `{ local, utc }` strings (no raw text); activate returns `ACTIVATION_SUCCESS(state label)` or `Licence not activated. {sentence}` and revalidates `/staff` (layout) and `/staff/licence` (page) on success and on CONCURRENT_CHANGE, ALREADY_ACTIVE and OLDER_THAN_ACTIVE. Unexpected errors log only `error.name`.
- `ActivateLicenceForm.tsx` follows the UI-SPEC flow: file chooser (name in mono, truncated) and monospace paste box where the last-set input wins, size check before reading, `Check licence` then `Checking…` with `aria-busy`, a surface-2 verified preview (Licence ID, Client, Deployment with "Matches this deployment", Issued, Starts, Expires, Grace ends, optional Replaces, local and UTC), `Activate licence` (the only `BTN_PRIMARY`), `Choose a different file`, the `ConfirmModal` (eyebrow "Audited action", no reason field), role-correct notes with one-time focus, and reset on success. Confirm sends the held text, never preview data.
- `DiagnosticDownloadButton.tsx` and `route.ts`: the route returns `JSON.stringify(report, null, 2)` as an attachment with `Cache-Control: private, no-store`, 401 for no session, an empty 404 for a denied caller, and a fixed `{ error: "diagnostic_unavailable" }` 500; it exports only `GET`. The button fetches, saves through a temporary anchor and shows `DIAGNOSTIC_ERROR_MESSAGE` on failure.
- `page.tsx` passes `activationSlot` only when `can("licence.activate")` and `diagnosticSlot` to every viewer.
- OQ3 is visible here: the seeded Administrator role keeps `licence.activate` (`prisma/seed.ts` uses `[...PERMISSIONS]`), which deviates from PRD 18.4 "deliberately restricted"; see key-decisions.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): licence-staff-service.ts, actions.ts, two test files. Commit: none (owner policy)
2. Task 2: ActivateLicenceForm.tsx, page.tsx slot, component test. Commit: none (owner policy)
3. Task 3: route.ts, DiagnosticDownloadButton.tsx, page.tsx slot, route test, button test. Commit: none (owner policy)

TDD gate: the implementation was written before its tests (behaviour reasoned from the plan lists and the UI-SPEC, then confirmed by the first run, which passed on first execution for the action, service, route and component tests), so no separate RED run exists, and no `test(...)` or `feat(...)` git commits exist because commits are prohibited by owner policy. The tracer gate (re-run Task 1 `<verify>` before the expansion tasks) was satisfied: 45 tests passed across the four node files before Task 2 began. Passing-on-first-run tests were spot-checked by assertion content (for example the exact preformatted dates, the `["raw"]`-only call argument, and the zero-call counts), not by mutation testing.

## Verification Results (real output)

- `npx vitest run tests/licence-staff-service.test.ts tests/licence-actions.test.ts tests/components/licence-activate-form.test.tsx tests/licence-diagnostic-route.test.ts tests/components/licence-status.test.tsx` (plan verification): 5 files passed, 88 tests passed, 0 failed.
- Focused node run `tests/licence-staff-service.test.ts tests/licence-actions.test.ts tests/licence-diagnostic-route.test.ts tests/licence-page.test.ts tests/licence-staff-access.test.ts tests/licence-purity.test.ts tests/boundary.test.ts --project node`: 6 of 7 files passed; 104 tests passed and 1 failed (the boundary timeout described below, not a licence test).
- Components run `tests/components/licence-activate-form.test.tsx tests/components/licence-diagnostic-button.test.tsx tests/components/licence-status.test.tsx --project components`: 3 files, 49 tests passed (activate form 23, diagnostic button 6, status view 20).
- `tests/boundary.test.ts`: in the combined parallel run one test, "the PDF library (pdf-lib) has exactly one importer under src/", failed with `Test timed out in 5000ms` (a filesystem walk starved by parallel load; unrelated to this plan). Re-run alone: 24 of 24 passed in 14.46 s. `tests/licence-purity.test.ts`: passed.
- `npx tsc --noEmit`: exit 0, no output (0 errors; no new error).
- `npx eslint` on `src/app/staff/licence`, `src/app/api/staff/licence`, `licence-staff-service.ts` and the nine touched or created test files: exit 0, no output.
- Acceptance greps: `licence.activate` (5 hits) and `continuity` (3 hits) in `licence-staff-service.ts`; `Check licence`, `Choose a different file` and `eyebrow="Audited action"` in `ActivateLicenceForm.tsx`; `private, no-store` in `route.ts`; a test asserts the route exports only `GET`.
- Next.js 16.3.4 docs read before writing: `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` (actions are untrusted POST entry points, 1 MB body cap is a backstop, constrain return values, authenticate inside every action), `01-app/03-api-reference/04-functions/revalidatePath.md` (type 'layout' or 'page', callable in Server Functions), `01-app/03-api-reference/03-file-conventions/route.md` (GET handler, no segment config needed).
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-15-PLAN.md LIC-02 LIC-03 LIC-06`, output verbatim:

```
{
  "ready": [
    "LIC-03"
  ],
  "blocked": [
    "LIC-02",
    "LIC-06"
  ],
  "total": 3
}
```

  Only LIC-03 is marked complete. LIC-02 and LIC-06 stay open (blocked by plans outside this one, for example the cross-phase checks plan 14-21 owns).

## Files Created/Modified

- `src/server/services/licence-staff-service.ts` - inspect, activate and diagnostic functions added
- `src/app/staff/licence/actions.ts` - the two server actions
- `src/app/staff/licence/ActivateLicenceForm.tsx` - activation form
- `src/app/staff/licence/DiagnosticDownloadButton.tsx` - download control
- `src/app/api/staff/licence/diagnostic/route.ts` - GET report download
- `src/app/staff/licence/page.tsx` - fills `activationSlot` and `diagnosticSlot`
- `tests/licence-staff-service.test.ts`, `tests/licence-actions.test.ts`, `tests/licence-diagnostic-route.test.ts`, `tests/components/licence-activate-form.test.tsx`, `tests/components/licence-diagnostic-button.test.tsx` (new); `tests/licence-staff-access.test.ts`, `tests/licence-page.test.ts` (modified)

## Decisions Made

See key-decisions. Copy not dictated by `policy.ts`: the field chrome "Licence file", "Choose file", "No file chosen", "Or paste the licence text", "Use the file exactly as provided.", "Verified", "Matches this deployment" and the preview row labels are UI-SPEC wording held as local constants in the form; every licence sentence is imported from `policy.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing access test constructed the service with the old deps**
- **Found during:** Task 1 (the new deps made `createLicenceStaffService({ withPermission, licence: { getStatusSnapshot } })` a type error)
- **Fix:** `tests/licence-staff-access.test.ts` now passes `vi.fn()` fakes for `inspect`, `buildDiagnosticReport`, `activation.activateLicence` and `audit`. No assertion changed.
- **Files modified:** tests/licence-staff-access.test.ts
- **Commit:** none (owner policy)

**2. [Rule 2 - Missing critical functionality] Header-injection and path-trick guards on the diagnostic file name**
- **Found during:** Task 3 (the attachment name is built from a stored licence id)
- **Fix:** `route.ts` replaces any character outside `A-Za-z0-9._-` in the id before building `Content-Disposition`; the button only accepts a `filename="[A-Za-z0-9._-]+"` value and otherwise falls back to `licence-diagnostic.json`. Both are covered by tests. Also added `X-Content-Type-Options: nosniff`.
- **Files modified:** src/app/api/staff/licence/diagnostic/route.ts, src/app/staff/licence/DiagnosticDownloadButton.tsx
- **Commit:** none (owner policy)

**3. [Rule 2 - Missing critical functionality] Page-level slot wiring test and a component test file for the button**
- **Found during:** Tasks 2 and 3
- **Issue:** the plan's file list had no test proving `page.tsx` gives the activation form only to holders and the download to every viewer, and the plan's button Test 4 is a jsdom test that cannot live in the node-project `tests/licence-diagnostic-route.test.ts`.
- **Fix:** added a case to `tests/licence-page.test.ts` and created `tests/components/licence-diagnostic-button.test.tsx`.
- **Commit:** none (owner policy)

### Interpretation choices (no change to the plan's interface contract)

- Inspect rejections append " Nothing was changed." except ALREADY_ACTIVE ("... No change was made.") and CONCURRENT_CHANGE ("... Nothing was changed. ..."), whose closed sentences already say so; repeating it would read as a duplicated claim.
- The catch site uses `refusalMessage(error, ACTIVATION_PERMISSION_NOTE)` from `permissions/refusal.ts` instead of a separate `LicenceRestrictedError` branch, so a licence refusal (which cannot occur for continuity calls) would still never be shown as a role denial.
- Inspecting a file whose own text is oversize or empty shows the BAD_FORMAT sentence at choose time, so the user is never left with a silently disabled Check button; the file is not read when oversize.
- The preview panel replaces the chooser while shown (so the held text cannot change between check and confirm); "Choose a different file" resets and moves focus to the file control.
- `getDiagnosticForStaff` fails closed: an audit-write failure turns the download into a 500.

**Total deviations:** 1 Rule 3, 2 Rule 2, 0 bugs. **Impact:** none breaks the interface contract (`inspectLicenceForStaff({ raw })`, `activateLicenceForStaff({ raw, correlationId? })`, `getDiagnosticForStaff()`, `inspectLicenceAction(input: unknown)`, `activateLicenceAction(input: unknown)` returning `{ ok: true, ... } | { ok: false; code; message; neutral }`).

## Issues Encountered

- One `tests/boundary.test.ts` timeout under parallel load (see Verification); passes alone.
- A heredoc-based shell command failed while creating two test files (shell parsing of quotes); the files were created with the Write tool instead. No residue on disk.

## Known Stubs

None. No placeholder or hardcoded empty data flows to the UI; the new components render only values returned by the actions and the page.

## Threat Flags

None beyond the plan's register. T-14-15-01 (withPermission around both calls, denial test with the fake never called), T-14-15-02 (activate action sends only the raw text, strict schema rejects extra members, the transaction re-verifies), T-14-15-03 (8192 cap before reading and in the action, ASCII allow-list), T-14-15-04 (fixed messages, error name only), T-14-15-05 (allow-listed keys, private no-store, licence.view, empty 404, audit per download), T-14-15-06 (audit row with the actor) are covered by tests. T-14-15-07 (OQ3) is accepted and documented above.

## Outstanding human UAT (browser verification was not possible)

Run with the dev server against a database where the 14-03 migration is applied (that apply is still an outstanding human step, WINDOWS.md id 20), a licence file minted by the provider tool for this deployment, as an Administrator:

1. Open `/staff/licence`, choose the file, confirm the verified preview appears and no text from the file shows before it.
2. Choose a file with one edited character; confirm the BAD_SIGNATURE sentence appears with "Nothing was changed."
3. Activate the valid file; confirm the banner, pill and lists update without a manual reload (the banner arrives with plan 14-11's layout; this checks the revalidation).
4. Set a 120-character file name; confirm it truncates with an ellipsis and does not widen the 400px right rail (also check at 320px width and 200% zoom).
5. Complete the flow with the keyboard only; confirm focus enters the dialog and returns to the Activate licence button on Cancel and on ESC, and the success note receives focus once.
6. Click Download diagnostic report; confirm the file name `licence-diagnostic-{id}-{YYYYMMDD}.json`, that it contains only the allow-listed members, and that an `licence.diagnostic_downloaded` row with your user appears in the audit log.
7. Sign in as staff with `licence.view` but not `licence.activate`: the activation panel shows the one-line permission note and the download still works.

Recorded in `.planning/WINDOWS.md` as an `unrun-verify` entry.

## Next Phase Readiness

- Plan 14-17 can classify `inspectLicenceForStaff` and `activateLicenceForStaff` as the `licence.activate` continuity call sites; `activateLicence` still has exactly one caller (this façade).
- Plan 14-21 proves OQ3 with a restricted-state activation test (seeded Administrator can activate while restricted).

## Self-Check: PASSED

- FOUND on disk: src/server/services/licence-staff-service.ts; src/app/staff/licence/actions.ts; src/app/staff/licence/ActivateLicenceForm.tsx; src/app/staff/licence/DiagnosticDownloadButton.tsx; src/app/staff/licence/page.tsx; src/app/api/staff/licence/diagnostic/route.ts; tests/licence-staff-service.test.ts; tests/licence-actions.test.ts; tests/licence-diagnostic-route.test.ts; tests/components/licence-activate-form.test.tsx; tests/components/licence-diagnostic-button.test.tsx; tests/licence-staff-access.test.ts (modified); tests/licence-page.test.ts (modified).
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run, and no Prisma command touched the configured DATABASE_URL.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-02*
