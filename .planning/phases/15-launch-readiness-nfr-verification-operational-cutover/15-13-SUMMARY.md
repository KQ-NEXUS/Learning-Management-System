---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 13
subsystem: ops-observability
tags: [nfr-07, nfr-13, operations-status, staff-ui, job-health, testcontainers]
status: complete

requires:
  - phase: 15-01
    provides: 15-DECISIONS.md shared UI ownership rows (layout.tsx and design-contract.test.ts both "agreed")
  - phase: 15-05
    provides: LagosTime and the Lagos-time formatter
  - phase: 15-07
    provides: integrityCheckService.runIntegrityChecks() (seven checks) used by the Data integrity section
provides:
  - src/server/services/ops-status-service.ts (createOpsStatusService, opsStatusService, JOB_STALENESS, OPS_LIST_LIMIT)
  - src/server/services/ops-status-types.ts (pure section shapes and summariseOpsStatus)
  - /staff/operations page (Scheduled jobs, Failed and stuck work, Payment exceptions, Email failures, Data integrity checks)
  - nav item "Operations status" (group Operations, after Support) gated by audit.view
  - exported ORDER_EXCEPTION_REASON_LABELS (and its default label) from event-mappers/staff.ts
  - design-contract group staff-operations-privacy
affects: [15-11, 15-19, 15-20, 15-22, 15-31]

actuals:
  tokens: 31000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Per-section isolation: each section runs in its own try/catch and returns { state: 'error' }; the log line carries the section name and error name only"
    - "Job health from the work a job leaves waiting: queueState(count, oldestDueAt, threshold) with a strict greater-than Behind rule"
    - "List sections return take-10 rows plus an exact count, so 10 rows shows no footer and 11 shows 'Showing 10 of 11.'"

key-files:
  created:
    - src/server/services/ops-status-service.ts
    - src/server/services/ops-status-types.ts
    - src/app/staff/operations/page.tsx
    - src/app/staff/operations/OperationsSections.tsx
    - src/app/staff/operations/OperationsDenied.tsx
    - tests/ops-status-service.integration.test.ts
    - tests/components/operations-page.test.tsx
  modified:
    - src/app/staff/layout.tsx
    - src/server/services/event-mappers/staff.ts
    - tests/unit/design-contract.test.ts
    - tests/staff-layout-nav.test.ts
    - docs/runbooks/job-recovery.md

key-decisions:
  - "Behind is strictly longer than max(3 x schedule interval, 5 minutes); waiting exactly the threshold is Running normally (P-11)"
  - "Export processing is on demand, so its Behind limit is the worker's own 20-minute stale limit instead of an interval rule"
  - "A failed export that has been retried is closed by its retry and not listed; webhooks that were rejected or could not be applied are listed for 14 days only (nothing on the page can resolve them)"
  - "Open reconciliation cases count as payment exceptions in the band figure, and a failing integrity check or a section that could not load keeps the page off 'All clear'"
  - "A job with no stored signal is Not tracked: Notification cleanup always, Licence check until a verification time exists"

patterns-established:
  - "A server page that needs ResourceTable's denied panel renders it through a tiny client wrapper (OperationsDenied), because ResourceTable takes function props"

requirements-completed: [NFR-07, NFR-13]

coverage:
  - id: D1
    description: "Email failures section: FAILED and stale SENDING rows, '{n} of 5 attempts', no address or provider error text"
    requirement: NFR-13
    verification:
      - kind: integration
        ref: "tests/ops-status-service.integration.test.ts#Operations status: email failures"
        status: pass
    human_judgment: false
  - id: D2
    description: "Staleness boundary: exactly three intervals is not Behind and one minute longer is Behind, for event processing, export dispatch, processing and expiry, reconciliation, seat holds, uploads, tickets and the licence check"
    requirement: NFR-07
    verification:
      - kind: integration
        ref: "tests/ops-status-service.integration.test.ts#Operations status: job health"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ten rows with total 10 shows no footer; eleven rows show 'Showing 10 of 11.' and the workspace link"
    requirement: NFR-07
    verification:
      - kind: integration
        ref: "tests/ops-status-service.integration.test.ts (emails, exports, orders)"
        status: pass
      - kind: component
        ref: "tests/components/operations-page.test.tsx#Operations status: ten-row boundary (NFR-07)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Counts render as exact integers with singular and plural forms; zero renders 0"
    requirement: NFR-07
    verification:
      - kind: component
        ref: "tests/components/operations-page.test.tsx (all clear, singular forms)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Privacy: the whole serialised result holds no seeded address, learner name, amount, webhook payload, provider error text or reconciliation evidence"
    requirement: NFR-07
    verification:
      - kind: integration
        ref: "tests/ops-status-service.integration.test.ts (email, event, payment privacy assertions)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Retrying states observable: events with attempts above zero and no processedAt, poisoned events '{n} of 3', emails '{n} of 5', stale sending"
    requirement: NFR-13
    verification:
      - kind: integration
        ref: "tests/ops-status-service.integration.test.ts#event processing"
        status: pass
    human_judgment: false
  - id: D7
    description: "Section isolation, all-clear rule, section error copy, responsive cards and table, long labels wrap, design contract"
    requirement: NFR-07
    verification:
      - kind: component
        ref: "tests/components/operations-page.test.tsx"
        status: pass
      - kind: unit
        ref: "tests/unit/design-contract.test.ts#staff-operations-privacy"
        status: pass
    human_judgment: true
  - id: D8
    description: "Direct visit without audit.view gets the existing denied panel; nav item hidden from non-holders"
    requirement: NFR-07
    verification:
      - kind: integration
        ref: "tests/ops-status-service.integration.test.ts#refuses a caller without audit.view"
        status: pass
      - kind: unit
        ref: "tests/staff-layout-nav.test.ts (15-13 cases)"
        status: pass
    human_judgment: false

duration: about 1h 30min
completed: 2026-10-08
---

# Phase 15 Plan 13: Operations status page Summary

**A staff-only `/staff/operations` page, gated by `audit.view`, that shows scheduled job health, failed and stuck work, payment exceptions, email failures and the seven integrity checks from stored records only, with each section loading independently and no personal detail on the page.**

## Accomplishments

- Tracer first: the Email failures section end to end (service gated by `audit.view`, page, nav item, real-Postgres test) before anything else was built. The tracer test passed before the other four sections were added.
- Job health for all ten jobs from stored work, not from the scheduler. Each job has a rule in `JOB_STALENESS`; Behind is strictly longer than `max(3 x interval, 5 minutes)`. Verified at the exact boundary against a real database for event processing (5 versus 6 minutes), export dispatch (5 versus 6), export processing (20 versus 21), export expiry (45 versus 46), payment reconciliation (45 versus 46), seat holds (15 versus 16), abandoned uploads (3 hours versus 3 hours 1 minute past the 24-hour limit), resolved tickets (same, past 7 days) and the licence check (3 hours versus 3 hours 1 minute).
- Failed and stuck work, payment exceptions and email failures each return at most ten rows newest first plus an exact total. Eleven seeded failures give 10 rows and total 11; ten give total 10.
- Order exception reasons come from the single exported `ORDER_EXCEPTION_REASON_LABELS` map; an unknown code, and an inherited property name such as `constructor`, read "Payment needs review".
- Whole-result privacy assertions: no seeded address, learner name, amount, webhook payload text, provider error text, event error text or reconciliation evidence appears anywhere in the serialised result.
- The page renders every UI-SPEC S1 state: band pill and three figures with the "Checked" line, per-section alert dot and `border-t-2 border-danger` rule, stacked cards below 768px and a `table-fixed` table from 768px, "Showing 10 of {n}." footer with the workspace link, the section failure copy, and the all-clear line.
- Existing staff event-mapper tests (42), `staff-layout-nav`, `licence-enforcement-boundary`, `boundary` and `runbooks` tests all still pass.

## Task Commits

None. The owner's standing rule is no commits; everything is left unstaged in the working tree.

## Files

- `src/server/services/ops-status-service.ts` - the service; five independent sections, `JOB_STALENESS` (ten entries), exact boundary helpers (`behindThresholdMs`, `isBehind`, `waitText`).
- `src/server/services/ops-status-types.ts` - pure section shapes and `summariseOpsStatus` (the All clear / Needs attention rule), kept import-free so the component tests never load the database client.
- `src/app/staff/operations/page.tsx`, `OperationsSections.tsx`, `OperationsDenied.tsx` - the page, the five server-rendered sections, and the denied-panel wrapper.
- `src/app/staff/layout.tsx` - one NAV item and one NAV_PERMISSION row (2 added lines).
- `src/server/services/event-mappers/staff.ts` - `export` added to `ORDER_EXCEPTION_REASON_LABELS` and `DEFAULT_ORDER_EXCEPTION_REASON_LABEL`; contents and mapper behaviour unchanged.
- `tests/ops-status-service.integration.test.ts` (17 cases), `tests/components/operations-page.test.tsx` (13 cases), `tests/unit/design-contract.test.ts` (new group), `tests/staff-layout-nav.test.ts` (2 cases).
- `docs/runbooks/job-recovery.md` - signal lines reconciled with what the page shows (see below).

## Deviations from Plan

**1. [Rule 3 - Blocking] Circular import between `event-mappers/staff.ts` and `event-intent-mappers.ts`**
- Importing the label map from `staff.ts` first made `event-intent-mappers.ts` build its mapper table before `staff.ts` had finished evaluating ("Cannot access 'ticketCreatedStaffAlert' before initialization"). The service now imports `event-intent-mappers` first (side-effect import, with a comment saying why it must stay first). I kept the map exported from `staff.ts` as the plan states instead of moving it to a new file. A future cleanup could move the map to its own module.

**2. [Rule 3 - Blocking] Denied panel needs a client wrapper**
- `ResourceTable` takes function props (`getRowKey`), which a server page cannot pass to a client component. Added `OperationsDenied.tsx` (a four-line client file, no data) so a direct visit without `audit.view` shows the existing denied panel with the noun "the operations status". Not in the plan's file list.

**3. [Design - Rule 2] Choices the plan left open, made so the page cannot mislead**
- *Failed exports that were retried are not listed.* A retry leaves the failed row behind for the record, so listing it would keep the page red forever. Un-retried failures stay listed until someone retries them.
- *Rejected webhooks (signature mismatch) and webhooks that could not be applied are listed for 14 days only.* Nothing on the page can resolve a webhook, so without a window it would never clear. Constant `WEBHOOK_LOOKBACK_MS`.
- *Events with attempts above zero and no `processedAt` get a fourth Failed-and-stuck row kind* "{Event} event retrying: {n} of 3 attempts". The UI-SPEC row list had only three kinds; NFR-13 asks for retrying to be visible, so this is additive.
- *Export processing's Behind limit is 20 minutes* (the worker's own reclaim window), because that function is on demand and has no schedule interval for the three-intervals rule.
- *"All clear" also requires:* no open reconciliation case (counted as a payment exception in the band figure), every integrity check passed, and every section loaded. A section that could not load is not evidence of health, so the pill reads "Needs attention".
- *Individual integrity check that could not run* shows "Could not run" (warning) instead of Passed.

**4. [Instruction] Runbook reconciled** (`docs/runbooks/job-recovery.md`, owner instruction 10)
- Removed the "if the row shows Not tracked" hedges for Export expiry, Upload cleanup and Ticket auto-close (those jobs always have a work signal); Notification cleanup is now "always Not tracked"; Licence check notes "Not tracked" before the first verification; Export processing's signal now states the retry exclusion and the 20-minute limit; Event processing mentions retrying rows. Stuck webhooks step 4 no longer claims Operations status lists received-but-unapplied webhooks (it does not; that signal is Reconciliation and the host logs) and step 5 now says rejected or failed webhooks stay listed for 14 days. Failed exports step 3 notes the retry removes the row from the page. `tests/runbooks.test.ts` still passes (32).

**5. [Housekeeping]** Two nav cases added to `tests/staff-layout-nav.test.ts` (not in the plan's file list) so the "nav item shows only to holders" truth has a test. `DEFAULT_ORDER_EXCEPTION_REASON_LABEL` is exported alongside the map so the service does not duplicate the "Payment needs review" string.

## Checks run

- `npx vitest run tests/ops-status-service.integration.test.ts --no-file-parallelism`: 17 passed (Testcontainers).
- `npx vitest run tests/components/operations-page.test.tsx`: 13 passed.
- `npx vitest run tests/unit/design-contract.test.ts --testTimeout=60000`: 107 passed (includes the new group).
- `npx vitest run tests/event-mappers-staff.test.ts tests/event-mappers-enrolment-payment.test.ts`: 42 passed.
- `npx vitest run tests/staff-layout-nav.test.ts tests/licence-enforcement-boundary.test.ts tests/boundary.test.ts`: 100 passed. `tests/runbooks.test.ts`: 32 passed.
- `npx tsc --noEmit`: clean. `npx eslint` on every touched source and test file: clean.
- Acceptance greps: layout diff is 2 added lines; no `toEmail: true` or `error: true` select in the service; the exact strings "No failed or stuck work.", "No payment exceptions.", "No email failures.", "Not tracked" and the section-error sentence are in `OperationsSections.tsx`; `staff-operations-privacy` is in both GROUPS and EXPECTED_GROUPS.
- No Testcontainers left running. No local or shared database was touched outside Testcontainers (no `.env`, no Neon).

## Neon go-live list

None. This plan adds no migration and no schema change.

## Owner notes

- The page has not been looked at in a browser. The two S1 backstop rows (long dataset, template and event labels; real failure data) are proven in code (wrapping classes, seeded-failure integration tests) but the visual check belongs to the accessibility and responsive passes (15-19, 15-20) and the UI review inside Phase 15.
- Plan 15-22 will add the learner privacy files to the same `staff-operations-privacy` design-contract group and its own nav row.
- Where a design choice above (14-day webhook window, retried exports hidden, section error = Needs attention) is not what you want, each is one constant or one line in `ops-status-service.ts` / `ops-status-types.ts`.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the `/staff/operations` page, and it is the surface the plan's threat model covers (T-15-13-01 to T-15-13-03 mitigated and tested; T-15-13-04 accepted).

## Self-Check: PASSED

- Files exist: ops-status-service.ts, ops-status-types.ts, operations/page.tsx, OperationsSections.tsx, OperationsDenied.tsx, both new test files (checked).
- No commits were made (by instruction); nothing is staged (`git diff --cached` is empty).
