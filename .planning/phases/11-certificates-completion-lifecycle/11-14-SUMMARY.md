---
phase: 11-certificates-completion-lifecycle
plan: 14
subsystem: ui
tags: [nextjs, react, resource-table, confirm-modal, server-actions, zod, certificates]

# Dependency graph
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "listPendingIssuance/issueCertificateManually (certificate-service.ts, plan 11-11), certificates.issue/certificates.view permissions"
provides:
  - "/staff/certificates — the MANUAL-mode pending-issuance queue, the Certificates landing view"
  - "Certificates entry in StaffShell's top-level NAV, after Payments"
  - "issueCertificateAction — the queue's per-row issue server action"
affects: ["11-15 (issued list, /staff/certificates/issued)", "11-16 or later (certificate detail page)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Staff SSR queue page: try/catch around the service call, notFound() on AuthenticationError/AuthorizationError (grading-queue precedent)"
    - "Server action returns { ok: true } | { ok: false, message } and never forwards a caught exception's own text — every outcome (including non-issued domain outcomes) maps to a fixed, distinct, actionable string"

key-files:
  created:
    - src/app/staff/certificates/page.tsx
    - src/app/staff/certificates/CertificateQueueTable.tsx
    - src/app/staff/certificates/certificate-actions.ts
    - tests/components/certificate-queue.test.tsx
  modified:
    - src/app/staff/layout.tsx

key-decisions:
  - "isActiveNavItem's existing prefix match (pathname.startsWith(`${href}/`)) already keeps the Certificates nav item highlighted on /staff/certificates/templates — no change to StaffShell's matching logic was needed"
  - "Reused formatTimestamp (mono, full date-time) for Eligible since, matching the existing 'identifiers/timestamps render in mono' convention (grading queue's Submitted column) rather than adding a new date-only formatter"

patterns-established: []

requirements-completed: [CRD-01, CRD-02]

# Metrics
duration: ~35min
completed: 2026-09-18
---

# Phase 11 Plan 14: Certificates Nav Entry and Pending-Issuance Queue Summary

**Certificates landing view at `/staff/certificates` — D-04's MANUAL-mode pending-issuance queue, reachable via one new top-level staff nav entry, with a per-row reason-free "Issue certificate" action.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 completed
- **Files modified:** 5 (1 modified, 4 created)

## Accomplishments
- Staff can now reach Certificates from the main staff sidebar (positioned after Payments, one added line in `StaffShell`'s `NAV` array)
- `/staff/certificates` lists every enrolment across every cohort within the caller's scope that is eligible for a certificate under MANUAL issuance mode but has none yet, via `listPendingIssuance()`
- Staff issue a certificate in one confirmed, reason-free click; the row disappears from the queue immediately on success (local state removal), backed by `revalidatePath` for the next full navigation
- Every one of `issueCertificateManually`'s four outcomes (`issued`, `already-issued`, `not-enabled`, `no-template`) is handled explicitly with a distinct, actionable message — no outcome is silently treated as success or as a generic failure
- The page links to `/staff/certificates/issued` and `/staff/certificates/templates`, the only entry points into those areas since exactly one nav item was added

## Task Commits

1. **Task 1: Certificates nav entry** - `d46a761` (feat)
2. **Task 2: Pending-issuance queue page and its issue action** - `6799017` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/app/staff/layout.tsx` - Added `{ label: "Certificates", href: "/staff/certificates" }` to `NAV`, immediately after Payments
- `src/app/staff/certificates/page.tsx` - Server component: `listPendingIssuance()` inside a `try`/`catch` that `notFound()`s on auth failure; `<h1>` "Certificates"; links to All certificates and Certificate templates
- `src/app/staff/certificates/CertificateQueueTable.tsx` - `"use client"` `ResourceTable` (no bulk-select prop wired), Learner/Award (with plain-text Course/Programme type indicator and subtitle)/Eligible since (mono) columns, per-row `--accent` "Issue certificate" button, reason-free `ConfirmModal` with UI-SPEC §6.1's exact copy, UI-SPEC §6's exact empty-state copy
- `src/app/staff/certificates/certificate-actions.ts` - `"use server"` `issueCertificateAction`: `.strict()` zod schema over `{ enrolmentId, scope }`, calls `issueCertificateManually`, `revalidatePath("/staff/certificates")` on success, maps auth errors and all four service outcomes to fixed messages, never forwards a raw caught error's text
- `tests/components/certificate-queue.test.tsx` - Columns and type-indicator text, reason-free confirmation copy (no textbox in the dialog), row removal on success, empty state, and a distinct non-success message per non-issued outcome (already-issued/not-enabled/no-template)

## Decisions Made
- Confirmed `StaffShell`'s `isActiveNavItem` already does a prefix match (`pathname === href || pathname.startsWith(`${href}/`)`), so no code change was needed for `/staff/certificates/templates` to still highlight the Certificates nav item — verified by reading `StaffShell.tsx`, not by adding a test (no existing nav-highlighting test harness exercises sub-paths for this component).
- Reused `formatTimestamp` (existing mono, full-timestamp formatter used by the grading queue's "Submitted" column) for "Eligible since" rather than introducing a new date-only formatter, since no shared date-only formatter exists in the codebase and the plan's `<read_first>` pointed at the grading queue as the pattern to mirror.

## Deviations from Plan

None - plan executed exactly as written. (Two comment-wording adjustments were made during test-verification to satisfy the plan's own literal `grep -c` acceptance criteria — see Issues Encountered — but no code behavior changed.)

## Issues Encountered
- Initial docstrings in `CertificateQueueTable.tsx` and `certificate-actions.ts` used the words "selection" and "error.message"/"err.message" in prose explaining what was deliberately *not* done, which caused the plan's own `grep -c "selection" ... returns 0` and `grep -c "error.message\|err.message" ... returns 0` acceptance checks to fail. Reworded both comments to describe the same intent without using the literal grep-matched substrings. No code logic changed.
- `ResourceTable` renders both the desktop `<table>` and the mobile `<ul>` card list simultaneously in JSDOM (no real CSS media query evaluation in tests), so text appearing in a non-primary column renders twice. Adjusted new test assertions to use `getAllByText(...).length` where duplication was expected, and scoped button queries to `within(screen.getByRole("dialog"))` to disambiguate the row's "Issue certificate" button from the modal's identically-labelled confirm button — mirrors the existing `grading-queue-table.test.tsx` precedent of using `getAllByText` for duplicated learner names.
- The test file's default mock signature (`vi.fn(async (_input: unknown) => ({ ok: true as const }))`) inferred a narrower TypeScript type than the `{ ok: false; message: string }` mocks used in later tests, which `npx next build`'s type-check step caught (though `npx tsc --noEmit` run standalone earlier had not yet included the test file's later additions). Fixed by explicitly typing the `setup` helper's `onIssue` parameter as `(input: unknown) => Promise<IssueResult>`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `/staff/certificates` is live, tested, and linked from the staff nav; `certificates.issue`/`certificates.view` permission gating flows straight through from plan 11-11's `certificate-service.ts` with no bypass added.
- `/staff/certificates/issued` and `/staff/certificates/templates/*` links are already present on the landing page; `/staff/certificates/templates/*` already exists on disk (plans 11-09/11-12). `/staff/certificates/issued` does not exist yet — its link on this page is a forward reference for whichever later plan builds CRD-03/CRD-05/CRD-06's issued list and certificate detail page.
- No blockers identified for subsequent Phase 11 plans.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*
