---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 22
subsystem: privacy
tags: [nfr-11, d-12, privacy-tool, staff-ui, server-actions, confirm-modal, licence-mirror, notfound-parity]
status: complete

requires:
  - phase: 15-01
    provides: 15-DECISIONS.md privacy decision (privacy.manage, Global only) and the agreed shared-UI rows for layout.tsx and design-contract.test.ts
  - phase: 15-13
    provides: the staff-operations-privacy design-contract group and the Operations status nav row this plan sits beside
  - phase: 15-16
    provides: privacyAnonymiseService, ANONYMISE_POLICY, AnonymiseConflictError, the privacy.manage permission
  - phase: 15-21
    provides: privacyExportService (requestLearnerExport, getLearnerExportStatus) and the learner-subject export dataset
provides:
  - "privacy-read-service.ts: findLearnerForPrivacy (exact email or learner number, one learner) and getPrivacyRecord, both privacy.manage Global, licence continuity"
  - "Pages /staff/privacy (S2 lookup) and /staff/privacy/[userId] (S3 record) with the nav item Learner privacy"
  - "ExportSection (audited continuity modal, job states) and AnonymiseSection (typed email check, danger modal, after-state)"
  - "Server actions requestLearnerExportAction and anonymiseLearnerAction (strict zod, fixed messages)"
  - "Fifth reviewed licence continuity override (privacy-read-service.ts) in the registry snapshot and the boundary test"
affects: [15-25 permission bypass suite, 15-26, 15-19 axe sweep, 15-31 launch checklist]

actuals:
  tokens: 25000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Exact-match-only lookup with one answer for unknown, staff, partial and malformed input; a denial on the record page is notFound(), the same as an unknown id"
    - "Server page passes the anonymise policy constant to the client section as a prop (type-only import in the client), so the lists cannot drift from the service and the database module stays out of the client bundle"
    - "The client section that owns a success note stays mounted across router.refresh() so the note and its focus survive the server re-render"

key-files:
  created:
    - src/server/services/privacy-read-service.ts
    - src/app/staff/privacy/page.tsx
    - src/app/staff/privacy/actions.ts
    - src/app/staff/privacy/LookupForm.tsx
    - src/app/staff/privacy/PrivacyDenied.tsx
    - src/app/staff/privacy/[userId]/page.tsx
    - src/app/staff/privacy/[userId]/ExportSection.tsx
    - src/app/staff/privacy/[userId]/AnonymiseSection.tsx
    - tests/privacy-read-service.integration.test.ts
    - tests/privacy-actions.test.ts
    - tests/components/privacy-record.test.tsx
  modified:
    - src/app/staff/layout.tsx
    - tests/licence-ui-mirror-gate.test.ts
    - tests/unit/design-contract.test.ts
    - src/server/licence/registry.ts
    - tests/licence-enforcement-boundary.test.ts

key-decisions:
  - "The read service carries a reviewed licence continuity override (a fifth one), because privacy.manage is classified write and without the override the lookup and record pages would refuse in restricted mode, making the continuity export unreachable"
  - "Record export state comes from privacyExportService.getLearnerExportStatus, which is per staff member: another person's finished file is never offered as a download"
  - "Retry export reopens the same audited request modal and calls requestLearnerExportAction again (a new job, a new reason, a new audit row) instead of exportService.retryExport"
  - "The typed email check is a guard against the wrong record only; the action re-checks the target, the reason and the permission and never receives the typed value"

patterns-established:
  - "A client component may import a server module as a type only (import type ... and typeof X), never as a value"
  - "Never leave a never-settling promise in a component test that uses a React async transition: it holds up every later transition in the file"

requirements-completed: []

coverage:
  - id: D1
    description: "S2 lookup: exact email (case-insensitive, trimmed) or exact learner number finds one learner and redirects; partial, staff, unknown and malformed input give one message with the value refilled and focus on the alert; empty submit has its own message"
    requirement: NFR-11
    verification:
      - kind: integration
        ref: "tests/privacy-read-service.integration.test.ts#findLearnerForPrivacy: exact match only"
        status: pass
      - kind: unit
        ref: "tests/components/privacy-record.test.tsx#S2 lookup page, S2 lookup form"
        status: pass
    human_judgment: false
  - id: D2
    description: "S3 record page: Learner details facts, Export data and Anonymise account sections with the UI-SPEC copy; unknown id, staff account and missing permission all give notFound()"
    requirement: NFR-11
    verification:
      - kind: integration
        ref: "tests/privacy-read-service.integration.test.ts#getPrivacyRecord, permission: nobody else learns whether an account exists"
        status: pass
      - kind: unit
        ref: "tests/components/privacy-record.test.tsx#S3 record page"
        status: pass
    human_judgment: false
  - id: D3
    description: "Export section: audited continuity modal with a 10-character reason, job states Being prepared, Ready, Failed, Expired, disabled button with a visible reason, usable in licence restricted mode"
    requirement: NFR-11
    verification:
      - kind: unit
        ref: "tests/components/privacy-record.test.tsx#ExportSection"
        status: pass
      - kind: unit
        ref: "tests/licence-ui-mirror-gate.test.ts (ExportSection.tsx in CONTINUITY_MODAL_FILES)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Anonymise section: policy lists rendered from ANONYMISE_POLICY, deletion note, typed email check on blur or Enter, danger modal with a 20-character reason, success note with focus, after-state line, reload copy for a concurrent change"
    requirement: NFR-11
    verification:
      - kind: unit
        ref: "tests/components/privacy-record.test.tsx#AnonymiseSection"
        status: pass
      - kind: unit
        ref: "tests/licence-ui-mirror-gate.test.ts (AnonymiseSection.tsx in WRITE_MODAL_FILES)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Server actions are public POST endpoints: strict zod input, delegation to the services, fixed messages, no exception text returned"
    requirement: NFR-11
    verification:
      - kind: unit
        ref: "tests/privacy-actions.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Nav item Learner privacy (Administration, after Learner numbers) shown only to holders of privacy.manage"
    requirement: NFR-11
    verification:
      - kind: other
        ref: "grep of src/app/staff/layout.tsx for /staff/privacy in NAV and NAV_PERMISSION"
        status: pass
    human_judgment: true
    rationale: "The nav is filtered by a runtime permission check in the layout; no test renders the layout with and without the permission. A person with and without privacy.manage should look at the sidebar once."
  - id: D7
    description: "Look and feel of the two screens against the UI-SPEC S2 and S3 layouts in a real browser, including the danger zone, focus order and 320px reflow"
    requirement: NFR-11
    verification: []
    human_judgment: true
    rationale: "No browser run was part of this plan. The design-contract gate grades the class strings and jsdom tests grade structure, but spacing, contrast and reflow are covered by the later axe and responsive sweeps (plans 15-19 and 15-20) and a human look."

duration: about 1 h wall clock (most of it Docker and Testcontainers waits)
completed: 2026-10-09
---

# Phase 15 Plan 22: Learner privacy screens Summary

**Staff holding `privacy.manage` can find one learner by exact email or learner number, export their data and anonymise their account through `/staff/privacy` and `/staff/privacy/[userId]`, with a typed email guard and a 20-character reason before the irreversible step, and with a 404 (not a refusal) for anyone who should not know the account exists.**

## Performance

- **Duration:** about 1 h wall clock
- **Started:** 2026-10-09T08:05:00Z (approximate)
- **Completed:** 2026-10-09T08:57:00Z (approximate)
- **Tasks:** 3 of 3
- **Files:** 11 created, 5 modified (3 of the modified files are outside the plan's list, see Deviations)

## Accomplishments

- **S2 lookup** (`/staff/privacy`): one native GET field; an exact match redirects to the record so the value never stays in the address bar; staff accounts, partial values, wildcards, unknown and malformed input all give the one UI-SPEC message with the value refilled and focus on the alert; an empty submit has its own message. No list, no suggestion.
- **S3 record** (`/staff/privacy/[userId]`): breadcrumbs, title, learner number, status pill and the six facts (a dash for a missing value); Export data and Anonymise account sections; after anonymisation the title reads "Anonymised learner", the export section is gone and the danger zone is replaced by the "anonymised on {time} by {staff name}" line.
- **Read service** (`privacy-read-service.ts`): `findLearnerForPrivacy` does exact equality on the lowercased email or the learner number (no LIKE, so `%` and `_` mean nothing); `getPrivacyRecord` returns only what the screen shows plus this staff member's latest export state. Both read through one `privacy.manage` Global call site.
- **Export section**: audited continuity modal (eyebrow "Audited action", reason of 10), states Being prepared / Ready with the availability time and "Download data file" / Failed with "Retry export" / Expired, the prepare button disabled with the visible reason while a job is open, and the "Export requested" status note with "Check export status".
- **Anonymise section**: "What changes" and "What is kept" rendered from `ANONYMISE_POLICY`, the deletion note, the export-first advice, a typed email check (case and surrounding spaces ignored; the mismatch message appears on blur or Enter, not per keystroke), the danger button with exactly the approved classes, the danger modal with a reason of 20, the success note with focus, and the reload copy for a lost race.
- **Server actions**: both strict zod, both delegate to the services, both return fixed messages; the lost anonymise race gets the reload copy and a licence refusal gets the calm licence note; no caught exception text reaches the browser.
- **Nav**: "Learner privacy" in Administration after Learner numbers, shown only to holders of `privacy.manage`.

## Task Commits

No commits were made, by project policy: the owner commits manually. `actuals.commits` is 0. Work is verified from the working tree and the test runs below, not from `git log`.

1. **Task 1 (tracer): lookup, record page, nav item, read service** - uncommitted (feat)
2. **Task 2: Export section and the server actions** - uncommitted (feat/test)
3. **Task 3: Anonymise danger zone, after-state, design-contract group** - uncommitted (feat/test)

## Verification (commands actually run)

| Command | Result |
| --- | --- |
| `npx vitest run tests/privacy-read-service.integration.test.ts --no-file-parallelism` (Docker, Testcontainers) | 14 passed, 1 file (final run 14 passed in 31 s on a warm Docker; the run before it also passed, in 246 s). One earlier attempt failed only because the container-start hook hit its 300 s ceiling on a cold Docker start; nothing ran, so it counts as a non-result, not a pass |
| `npx vitest run tests/privacy-actions.test.ts tests/licence-ui-mirror-gate.test.ts --testTimeout=60000` | 25 passed, 2 files |
| `npx vitest run tests/components/privacy-record.test.tsx` | 41 passed, 1 file |
| `npx vitest run tests/licence-ui-mirror-gate.test.ts tests/unit/design-contract.test.ts --testTimeout=60000` | 125 passed, 2 files |
| `npx vitest run tests/licence-enforcement-boundary.test.ts tests/privacy-no-hard-delete.test.ts tests/audit-coverage.test.ts tests/licence-effects.test.ts tests/permissions.test.ts tests/permission-groups.test.ts --testTimeout=60000` | 97 passed, 6 files (the suites my out-of-list edits touch) |
| `npx tsc --noEmit -p .` | no errors |
| `npx eslint` on every file this plan created or edited | no output (clean) |

Plan-level `<verification>`: the first command and the second (`privacy-actions`, `privacy-record`, `licence-ui-mirror-gate`, `design-contract`, which I ran as the Task 2 and Task 3 commands) all pass. Docker was available (28.3.3); nothing touched the shared Neon database or `.env`.

Acceptance criteria re-checked: layout.tsx has `"/staff/privacy"` in both NAV and NAV_PERMISSION (my edit is two added lines; `git diff --stat` shows four because the working copy also holds plan 15-13's two uncommitted lines); `[userId]/page.tsx` calls `notFound()` for the denial and unknown paths; `actions.ts` starts with `"use server"` and both schemas are `.strict()`; the exact strings "Permanent deletion is not available until the retention policy is approved." and "Type the learner's email address above to continue." are in `AnonymiseSection.tsx`; `ExportSection.tsx` is in `CONTINUITY_MODAL_FILES` and `AnonymiseSection.tsx` in `WRITE_MODAL_FILES`; the design-contract test passes with the six new files in `staff-operations-privacy`.

## Files Created/Modified

See the frontmatter lists. New client components beyond the plan's list are noted below.

## Decisions Made

- **Continuity override for the reads.** `privacy.manage` is a licence write because it also guards anonymisation. The lookup and the record page run through that permission, so without a reviewed override they would refuse in restricted mode and the continuity export (LIC-08) could not be reached. I added the same kind of override 15-21 added, for `privacy-read-service.ts`.
- **Export state is per staff member.** The record uses `getLearnerExportStatus`, which only looks at the signed-in person's own jobs; the download route requires the requester, so offering someone else's file would be a dead link.
- **Retry export** reopens the audited request modal (a new reason and a new `privacy.learner_export_requested` audit row, fresh data) and calls the same action, instead of `exportService.retryExport`, which 15-21's notes suggested. The plan names exactly two actions, and a retry without a reason would be a second, weaker audit path.
- **Policy as a prop.** `privacy-anonymise-service.ts` reaches the database, so the client section only imports its type; the server page passes `ANONYMISE_POLICY` in. The lists still come from the one constant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Reviewed continuity override for the read service, in two files outside the plan's list**
- **Found during:** Task 1
- **Issue:** the plan gates the reads with `privacy.manage`, which `LICENCE_PERMISSION_EFFECT` classifies as write. In restricted mode `withPermission` would refuse both reads, so a restricted deployment could not reach the export the plan says must stay usable.
- **Fix:** one permission call site in `privacy-read-service.ts` with `{ licence: "continuity", reason: "LIC-08 permitted data access (lookup)" }`, mirrored in the three pinned places: the source, `CONTINUITY_TAG_SNAPSHOT` in `src/server/licence/registry.ts`, and `REVIEWED_OVERRIDES` in `tests/licence-enforcement-boundary.test.ts` (test title now says "five", and the effective-effect list gained the read service). The integration test proves both reads work with the deployment restricted while a write-effect use of the same permission is still refused.
- **Files modified:** `src/server/licence/registry.ts`, `tests/licence-enforcement-boundary.test.ts` (both also carry other plans' uncommitted edits, which I did not touch)
- **Verification:** `licence-enforcement-boundary` passes (97 passed across the six related files); integration cases "keeps both reads working when the deployment is restricted" and "still blocks a write-effect use".

**2. [Rule 3 - Blocking] Two small client components not in the plan's file list**
- **Found during:** Task 1
- **Issue:** UI-SPEC S2 requires focus to move to the no-match alert, which needs a client effect, and the existing denied panel (`ResourceTable`) takes function props, which a server page cannot pass.
- **Fix:** `src/app/staff/privacy/LookupForm.tsx` (the GET form and the focused alert) and `src/app/staff/privacy/PrivacyDenied.tsx` (the denied panel, the same pattern as `OperationsDenied`). Both are in the `staff-operations-privacy` design-contract group.
- **Verification:** `privacy-record.test.tsx` covers the form and the denied states; design-contract passes.

**3. [Rule 1 - Bug] Policy import would have pulled the database into the client bundle**
- **Found during:** Task 3
- **Issue:** importing `ANONYMISE_POLICY` as a value in `AnonymiseSection.tsx` would bundle `@/server/db` into the browser.
- **Fix:** type-only import in the client, with the constant passed from the server page as `policy`.

### Copy not in the UI-SPEC (flagged for review)

- Export action failure: "The export was not requested. Try again; if it fails again, contact an administrator." (the UI-SPEC gives failure copy for anonymise only).
- In "What changes", the four removed items are shown as "Removed: {item}" so a bare noun such as "Email preferences" is not misread as something that was changed.
- The after-state falls back to "by a staff member" if the anonymising account's name cannot be read.

**Total deviations:** 3 auto-fixed (1 Rule 2, 1 Rule 3, 1 Rule 1), plus the three copy additions above.
**Impact on plan:** none on scope; every addition is needed for the plan's own truths to hold (restricted-mode export, focus on the alert, a clean client bundle).

## Issues Encountered

- The first integration run failed in `beforeAll` (300 s container-start ceiling on a cold Docker). Re-running passed. No code change.
- One component test hung until I stopped using a never-settling promise: React holds later async transitions behind an unsettled one. Fixed in the test (deferred promise, settled at the end).

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-15-22-01 (direct POST) is mitigated by the strict schemas plus the services' own checks, tested in `privacy-actions.test.ts`; the full bypass suite is plan 15-25. T-15-22-02 (enumeration) is mitigated and tested: the same refusal for a real learner and an unknown value, one no-match message, `notFound()` on the record page. T-15-22-03 is mitigated by the typed check, the 20-character reason and the server re-check; T-15-22-04 is accepted as planned (the redirect drops the value from the URL).

## User Setup Required

None.

## Neon go-live list

No new migration or schema change in this plan. Items from plans 15-16 and 15-21 still apply (migration `20261007120000_user_anonymisation`; the Administrator role needs `privacy.manage`, by re-running the seed or adding it, or nobody will see the nav item).

## Next Phase Readiness

- The privacy screens are ready for the permission bypass suite (15-25) and the axe, keyboard and responsive sweeps (15-19, 15-20): add `/staff/privacy` and an S3 record before and after anonymisation to the screens manifest.
- Open for the owner: nothing blocking. Worth a human look: the sidebar with and without `privacy.manage`, and the S3 danger zone in a real browser (not run in this plan).
- `requirements-completed` is empty by instruction: NFR-11 is declared by several plans (15-01, 15-16, 15-21, 15-22, 15-31) and the orchestrator owns the checkbox.

## Self-Check: PASSED

- Created files exist on disk (checked with `ls`): the read service, the eight files under `src/app/staff/privacy`, and the three test files.
- Acceptance criteria re-run after the last edit (greps above); all listed vitest commands exit 0.
- No commits were made and nothing was staged.

---
*Phase: 15-launch-readiness-nfr-verification-operational-cutover*
*Completed: 2026-10-09*
