---
phase: 13-transactional-communications-notifications
plan: 12
subsystem: communications
tags: [email, delivery-log, rbac, resend, resource-table, prisma, real-postgres]

requires:
  - phase: 13-transactional-communications-notifications (Plan 01)
    provides: communications/contracts.ts (TEMPLATE_IDS, TEMPLATE_CATEGORY, EMAIL_STATUS, MAX_SEND_ATTEMPTS)
  - phase: 13-transactional-communications-notifications (Plan 04)
    provides: email-dispatch-service.ts's resend (compare-and-set requeue + same-transaction audit) and ResendNotAllowedError
  - phase: 13-transactional-communications-notifications (Plan 06)
    provides: StaffShell bell mount and the staff-layout-nav.test.ts isolation pattern (NotificationBell mocked)
provides:
  - "email-delivery-log-service.ts: a permission-gated (audit.view list / users.manage resend) read-only projection over EmailDispatch that never exposes templateParams, plus a server-enforced 10-character resend reason minimum delegating the actual requeue to Plan 04's resend"
  - "/staff/email-log: a ResourceTable-based delivery log page with status/template filters, empty/error/denied states matching the UI-SPEC exactly, and an audited Resend dialog"
  - "The staff sidebar's Administration group gains 'Email log', gated by audit.view, positioned after Audit"
affects: []

actuals:
  tokens: 12500
  tasks: 2
  commits: 0   # commit_policy_override: no commits made this run

tech-stack:
  added: []
  patterns:
    - "Courtesy canResend projection (status/category/params/known-template) mirrors resend()'s own eligibility checks but never substitutes for them — the real gate (including the recipient's live ACTIVE status) stays inside email-dispatch-service.ts's transaction, so the list and the mutation can never disagree about *why* a resend failed"
    - "A too-short resend reason and an ineligible row both throw the same ResendNotAllowedError, so neither the length gate nor the eligibility gate becomes an oracle a caller can use to tell them apart"

key-files:
  created:
    - src/server/services/email-delivery-log-service.ts
    - src/app/staff/email-log/page.tsx
    - src/app/staff/email-log/EmailLogTable.tsx
    - src/app/staff/email-log/actions.ts
    - src/app/staff/email-log/loading.tsx
    - tests/email-delivery-log-service.test.ts
    - tests/email-delivery-log.integration.test.ts
    - tests/staff-email-log-actions.test.ts
    - tests/components/email-log-table.test.tsx
  modified:
    - src/app/staff/layout.tsx
    - tests/staff-layout-nav.test.ts

key-decisions:
  - "The delivery log's action column header is the visible string 'Actions' rather than an empty string (CertificateQueueTable's precedent) — axe's empty-table-header rule flagged the blank header as a real screen-reader gap once this plan added the first axe check over a ResourceTable action column; fixed rather than carried forward (Rule 2)."
  - "'Last error' truncates with `truncate` plus a native `title` attribute carrying the full string, rather than a click-to-expand row detail like AuditTable's — the plan's own <action> text specifies only a truncated column, and the must-have's 200-character readability requirement is explicitly a visual backstop (jsdom cannot measure truncation layout), not an automated one."
  - "StatusPill tones follow the plan's literal four-tone mapping (SENT success / QUEUED+SENDING accent / FAILED danger / SKIPPED neutral) rather than the broader UI-SPEC vocabulary's amber next-attempt nuance, which the plan's own action text for this column does not ask for."

requirements-completed: []  # COM-01/COM-02 blocked — see Next Phase Readiness.

coverage:
  - id: D1
    description: "Tracer: a FAILED email with stored params appears in the permission-gated log, an administrator resends it with an audited reason, and a subsequent drain delivers it — the same EmailDispatch row throughout, one audit.resent row"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/email-delivery-log.integration.test.ts (4 cases, real Postgres)"
        status: pass
      - kind: unit
        ref: "tests/email-delivery-log-service.test.ts (18 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "listDispatches never exposes templateParams, projects only the stored error/skipReason classification, marks stub: provider ids, and computes canResend correctly across the full status/category/params matrix; resendDispatch is refused for a caller without users.manage even when they hold audit.view"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/email-delivery-log-service.test.ts#listDispatches / #resendDispatch"
        status: pass
      - kind: integration
        ref: "tests/email-delivery-log.integration.test.ts (permission-split and projection cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The staff page filters by status/template, shows the exact UI-SPEC empty/error/denied copy, hides Resend from viewers without users.manage, and the sidebar shows Email log only to audit.view holders, positioned after Audit"
    requirement: "COM-02"
    verification:
      - kind: unit
        ref: "tests/components/email-log-table.test.tsx (16 cases, incl. axe on ready/empty states)"
        status: pass
      - kind: unit
        ref: "tests/staff-email-log-actions.test.ts (8 cases)"
        status: pass
      - kind: unit
        ref: "tests/staff-layout-nav.test.ts (2 new cases, 8 total, standalone-isolated)"
        status: pass
    human_judgment: true
    rationale: "The 200-character truncation readability backstop (must-have T-13-… 'long recipient and error text') needs a real browser — jsdom measures no layout. The truncate+title mechanism is implemented; visual confirmation is deferred to the phase's held-out UI-state pass, same as Plan 06's own outstanding backstops."

duration: ~70min
completed: 2026-09-28
status: complete
---

# Phase 13 Plan 12: Staff Email Delivery Log with Audited Resend Summary

**A permission-gated `/staff/email-log` page (`audit.view` to view, `users.manage` to resend) projecting `EmailDispatch` rows with status/attempts/error classification, backed by a service that never exposes `templateParams` and delegates the actual requeue to Plan 04's audited `resend`.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-09-28
- **Completed:** 2026-09-28
- **Tasks:** 2 (both complete)
- **Files:** 9 created, 2 modified (11 total, matching the plan's `files_modified` list exactly)

## Accomplishments

- **Task 1 (tracer):** `email-delivery-log-service.ts` — `createEmailDeliveryLogService(deps)` with `listDispatches` (`audit.view`, empty/global scope) projecting `EmailDispatchRow` to `id, template, toEmail, status, attempts, maxAttempts, nextAttemptAt, error, skipReason, createdAt, sentAt, isStub, canResend` — `templateParams` never leaves the service. `isStub` is true only when `providerMessageId` starts with `stub:`. `canResend` is true only for `FAILED`/`SENT` rows with stored `templateParams`, a known, non-`AUTH` template. `resendDispatch` (`users.manage`, empty/global scope) enforces a server-side 10-character trimmed reason minimum — rejecting with the same `ResendNotAllowedError` an ineligible row gets, so neither gate is a distinguishable oracle — then calls Plan 04's `emailDispatchService.resend` with the authorised actor's id. The staff page (`page.tsx`), the `ResourceTable`-based `EmailLogTable.tsx` and the `resendEmailAction` server action were built together with the service in this task, proven end to end: real-Postgres seed of a `FAILED` row with stored params and an `ACTIVE` recipient, resend as an allowed actor (`QUEUED`, `resentCount` 1, `attempts` 0, one `email.resent` audit row with the actor and reason), then `sendQueued` delivering it to `SENT`.
- **Task 2 (TDD):** Status/template `<select>` filters (options from `TEMPLATE_IDS`), the exact UI-SPEC empty ("No emails sent yet" / "Transactional emails appear here once lifecycle events are processed.") and error ("Couldn't load the delivery log. Reload the page; if it persists, contact an administrator.") copy, an RBAC-06-identical denied state regardless of row count, `loading.tsx` (staff skeleton convention, `role="status"` `aria-busy`), Resend hidden entirely for a viewer without `users.manage` and shown only on `canResend` rows for one who has it, and the sidebar's "Email log" item (`audit.view`, after Audit in Administration). 50 new/extended tests across 4 files (18 service unit + 4 real-Postgres integration + 16 component + 8 action + 2 new nav cases), all green; `tsc --noEmit` and `eslint src/app/staff/email-log src/app/staff/layout.tsx` both clean.

## Task Commits

No commits were made (owner standing rule — see `commit_policy_override`). Suggested messages, hash `uncommitted`:

1. **Task 1: Tracer — delivery log service, page, table, resend action** - `uncommitted` - `feat(13-12): add permission-gated email delivery log service, staff page, table and audited resend action`
2. **Task 2: Filters, states, loading route, sidebar entry and permission variance (TDD)** - `uncommitted` - `test(13-12): add failing tests for delivery log filters, states, resend visibility and nav` then `feat(13-12): add filters, exact-copy states, loading route and Email log sidebar entry`

**TDD note (Task 2):** Given the tracer task (Task 1) already produced the full page/table/filters/loading-route surface end to end (the plan's own Task 1 action text builds most of the UI, and Task 2 layers filters/states/loading/nav on top), the Task 2 tests were authored against that already-built surface rather than against a pre-existing stub confirmed failing first — the same honest deviation from strict commit-by-commit RED-first ordering that Plan 06's summary recorded. Two real defects were found and fixed by running the new tests and lint/axe gates before declaring the task done (see Deviations): an `axe` empty-table-header violation and a `react-hooks/error-boundaries` lint violation. The fix-then-verify loop happened in full; the strict "commit a failing test first" ordering was not independently observed here.

## Files Created/Modified

- `src/server/services/email-delivery-log-service.ts` — permission-gated list/resend service, no `templateParams` in its output
- `src/app/staff/email-log/page.tsx` — server component: filter parsing (unknown URL values ignored), the three error branches, `can("users.manage")` courtesy check
- `src/app/staff/email-log/EmailLogTable.tsx` — `ResourceTable`-based table, filters, states, `ConfirmModal` resend dialog
- `src/app/staff/email-log/actions.ts` — `resendEmailAction`, `.strict()` zod schema, closed error-message map
- `src/app/staff/email-log/loading.tsx` — staff loading skeleton convention
- `src/app/staff/layout.tsx` — "Email log" nav item (Administration, after Audit) + `NAV_PERMISSION` entry (`audit.view`)
- `tests/email-delivery-log-service.test.ts` — 18 unit tests (where-builder, projection, `canResend` matrix, permission split, reason minimum)
- `tests/email-delivery-log.integration.test.ts` — 4 real-Postgres tests (resend + drain to SENT, reason minimum, projection/permission-split, no-`users.manage` refusal)
- `tests/staff-email-log-actions.test.ts` — 8 unit tests (success, schema rejection x2, auth-error mapping x2, generic-failure mapping x2, no-leak)
- `tests/components/email-log-table.test.tsx` — 16 component tests (filters, states, Resend visibility, dialog, axe x2)
- `tests/staff-layout-nav.test.ts` — 2 new cases: Email log shown/positioned for `audit.view` holders, hidden for non-holders

## Decisions Made

See `key-decisions` above: visible "Actions" header (axe fix) instead of CertificateQueueTable's blank-header precedent; `title`-attribute truncation instead of a click-to-expand row detail (matches the plan's literal action text; the 200-character readability check is an explicit visual backstop); the plan's literal four-tone `StatusPill` mapping over the UI-SPEC's broader amber-on-retry nuance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Empty `<th>` on the delivery log's action column failed axe's empty-table-header check**
- **Found during:** Task 2, writing `tests/components/email-log-table.test.tsx`'s axe assertions
- **Issue:** The action column's `header: ""` (matching `CertificateQueueTable`'s existing convention) produces a screen-reader-inaccessible empty table header — a real NFR-09 gap that had gone uncaught elsewhere only because no earlier `ResourceTable` consumer paired this pattern with an axe check.
- **Fix:** Changed the column header to the visible string `"Actions"`.
- **Files modified:** `src/app/staff/email-log/EmailLogTable.tsx`
- **Verification:** `axeViolations` returns `[]` for both the ready and empty states.
- **Committed in:** would be part of the Task 2 `feat` commit (uncommitted)

**2. [Rule 1 - Bug] `react-hooks/error-boundaries` lint failure from constructing the success JSX inside the `try` block**
- **Found during:** Task 2, `npx eslint src/app/staff/email-log`
- **Issue:** `page.tsx` originally returned `<EmailLogTable rows={...} .../>` from inside the same `try` that awaited `listDispatches`/`can`, which this codebase's `react-hooks/error-boundaries` rule rejects (JSX construction does not itself throw, so wrapping it in try/catch doesn't do what it looks like it does) — the exact pattern `audit/page.tsx` already avoids by returning the success JSX after the try/catch.
- **Fix:** Moved the awaited calls into a `let rows; let canManageUsers` pair populated inside `try`, with the success `return <EmailLogTable .../>` after the `try`/`catch` block, matching `audit/page.tsx`'s established shape exactly.
- **Files modified:** `src/app/staff/email-log/page.tsx`
- **Verification:** `npx eslint src/app/staff/email-log src/app/staff/layout.tsx` exits 0; `npx tsc --noEmit` clean; full test suite still green.
- **Committed in:** would be part of the Task 1 `feat` commit (uncommitted)

**3. [Rule 3 - Blocking] `templateParams: null` in a test fixture failed to compile against Prisma's generated nullable-Json input type**
- **Found during:** Task 1, `npx tsc --noEmit` after writing `tests/email-delivery-log.integration.test.ts`
- **Issue:** Prisma 6's generated `EmailDispatchCreateInput.templateParams` type is `NullableJsonNullValueInput | InputJsonValue | undefined` — a bare `null` literal does not satisfy it (the field must be omitted, or `Prisma.JsonNull` used, to leave the column null).
- **Fix:** Omitted the field from that one `create()` call (its default is already `null` in the database).
- **Files modified:** `tests/email-delivery-log.integration.test.ts`
- **Verification:** `npx tsc --noEmit` clean; the test still asserts `canResend: false` for that (`templateParams`-absent) row.
- **Committed in:** would be part of the Task 1 `test` commit (uncommitted)

---

**Total deviations:** 3 auto-fixed (1 Rule 2 — accessibility, 1 Rule 1 — lint-rule bug, 1 Rule 3 — test-only compile blocker).
**Impact on plan:** All three fixes were necessary to reach the plan's own stated `tsc`/`eslint`/test-suite verification bar. No scope creep — none touch files outside this plan's `files_modified` list.

## Issues Encountered

- A first attempt at `npx vitest run` across all four Task 2 files hit a `[vitest-pool-runner]: Timeout waiting for worker to respond` for `tests/components/email-log-table.test.tsx` on one run — a worker-thread flake in this sandbox, not a code or test defect (a bare retry of the identical command ran all 50 tests to completion). Noted for the record; not treated as a deviation since no source change was needed.
- `ResourceTable` renders its desktop `<table>` and its `sm:hidden` mobile card list simultaneously in jsdom (no CSS is applied), so a single qualifying row's Resend button appears twice in the raw DOM — the same characteristic `tests/components/audit-table.test.tsx`'s own header comment documents for `AuditTable`. Scoped the affected assertions with `within(screen.getByRole("table"))` / `getAllByRole(...)[0]`, matching the established convention in `certificate-queue.test.tsx` and `grading-queue-table.test.tsx`.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None. The page, table, service and action are all wired to the real Plan 01/04 schema and dispatch service; no placeholder data or hardcoded empty branch was introduced.

## Threat Flags

None beyond the plan's own threat model (T-13-77, T-13-78, T-13-79, T-13-50/51/52 — all covered by the tests listed in `coverage` above).

## Next Phase Readiness

- The delivery log is fully wired to Plan 04's `resend`/`sendQueued` and Plan 01's contracts; Plan 11's failed-email administrator alert (per the plan's own objective) can link straight to `/staff/email-log`.
- **Requirements COM-01 and COM-02 are intentionally NOT marked complete in `REQUIREMENTS.md`.** Both are shared across sibling plans in this phase; `gsd-tools query requirements ready-ids .planning/phases/13-transactional-communications-notifications/13-12-PLAN.md COM-01,COM-02` reports both `blocked` (plans 13-09, 13-10, 13-11 and 13-13 have no `SUMMARY.md` on disk yet). They will flip to `Complete` automatically once the last declaring plan in this phase finishes.
- **Outstanding human verification (backstop truth, not a code defect):** confirm in a real browser that a 200-character recipient address or error classification stays readable — truncates cleanly with the full text reachable via the native title attribute, no horizontal overflow — matching this plan's own `<verify>` "backstop" designation. jsdom cannot measure truncation layout.
- Plans 13-09, 13-10 and 13-11 remain unexecuted in this phase (no `SUMMARY.md`); this plan's dependencies (`13-01`, `13-04`, `13-06`) were all already complete, so it executed cleanly out of numeric order. `STATE.md`'s "Plan: 9 of 13" pointer was deliberately left untouched rather than advanced to "10 of 13" by `state.advance-plan` — that command increments a bare counter and does not reconcile against which `SUMMARY.md` files actually exist on disk (a gap `STATE.md`'s own Blockers/Concerns section already documents), and advancing it here would have asserted plan 9 was completed, which it was not. `roadmap.update-plan-progress 13` (disk-count based) and `state.record-metric` were run instead; the phase-level plan/summary counts in `ROADMAP.md` and `STATE.md`'s Performance Metrics table are accurate.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-28*

## Self-Check: PASSED

- All 9 created files exist on disk and appear in `git status --porcelain` as `??` (untracked): `src/server/services/email-delivery-log-service.ts`, the `src/app/staff/email-log/` directory (4 files), and the 4 new test files. Both modified files (`src/app/staff/layout.tsx`, `tests/staff-layout-nav.test.ts`) appear as `M`.
- No commits exist for this plan (`git log` was not consulted per `commit_policy_override`) — the absence of commits is expected under the owner's no-commit rule, not a Self-Check failure.
- Every test referenced above was actually run in this session and passed: `tests/email-delivery-log-service.test.ts` + `tests/email-delivery-log.integration.test.ts` (25 tests, real Postgres via Testcontainers, confirmed `at "localhost:<port>"` — not Neon), then the full plan-level line `tests/email-delivery-log-service.test.ts tests/email-delivery-log.integration.test.ts tests/staff-email-log-actions.test.ts tests/components/email-log-table.test.tsx tests/staff-layout-nav.test.ts --no-file-parallelism` (54 tests, all passed). `tests/staff-layout-nav.test.ts` was additionally re-run standalone (8/8) to confirm its Plan 06-established mock-isolation note still holds after this plan's edit. Spot-check: `tests/boundary.test.ts`, `tests/email-dispatch-service.test.ts`, `tests/components/staff-shell.test.tsx`, `tests/components/audit-table.test.tsx` (76 passed, 1 pre-existing skip, no regressions).
- `npx tsc --noEmit` and `npx eslint src/app/staff/email-log src/app/staff/layout.tsx` were both actually run and passed (0 errors).
- `gsd-tools query requirements ready-ids <plan-path> COM-01,COM-02` was run using the correct positional form and reported both IDs `blocked`; neither was marked complete in `REQUIREMENTS.md`.
- The Neon database was never contacted: `tests/support/pg.ts` starts its own `postgres:16-alpine` Testcontainer with an explicit `DATABASE_URL` override passed only to that child process's `prisma migrate deploy` invocation, and the Prisma output for that run showed `at "localhost:<port>"`, never a `neon.tech` host.
