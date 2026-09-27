---
phase: 12-support-tickets
plan: 06
subsystem: support
tags: [tickets, dashboard, contextual-help, privacy]
requires:
  - phase: 12-support-tickets
    plan: 02
    provides: ticket service and DTOs
  - phase: 12-support-tickets
    plan: 05
    provides: /support/new context hint validation
provides:
  - Dashboard-level owner-only Support tickets section (max 3, safe fields)
  - Shared GetSupportLink (kind + opaque id only)
  - Get help links on learning overview (cohort), results (latest submission), order receipt, certificate
affects: [12-09]
key-files:
  created:
    - src/components/support/GetSupportLink.tsx
    - tests/components/support-entry-points.test.tsx
    - tests/ticket-context-entry.integration.test.ts
  modified:
    - src/server/services/enrolment-dashboard-service.ts
    - src/app/(learner)/dashboard/page.tsx
    - src/app/(learner)/learn/[enrolmentId]/page.tsx
    - src/app/orders/[reference]/page.tsx
    - src/components/learner/CertificateSlot.tsx
    - src/components/learner/ResultsList.tsx
    - src/server/services/learner-results-service.ts
    - tests/enrolment-dashboard-service.test.ts
    - tests/learner-dashboard-page.test.ts
    - tests/certificate-slot.test.ts
key-decisions:
  - "Tickets moved from a per-card DeferredColumn to a dashboard-level supportTickets list, read once per request via an injected owner-scoped dependency (select of five fields only)."
  - "Result history entries gained an optional submissionId so the results page can link a concrete submission (receiptId is not the submission id)."
requirements-completed: [SUP-01, SUP-05]
metrics:
  completed: 2026-09-25
---

# Phase 12 Plan 06: Dashboard and contextual support entry points Summary

The learner dashboard now shows a real, bounded, privacy-safe Support tickets section, and Get help with this links on the learning overview, results, order receipt and certificate surfaces open the 12-05 creation flow with a hint that is revalidated server-side.

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| 1 dashboard ticket summary | 8bf0e10 | TICKETS_DEFERRED removed, one batched read, UI-SPEC 7.4 copy |
| 2 contextual links | 111958f | GetSupportLink + four placements, tests |

## Verification (actual results)

- `tests/enrolment-dashboard-service.test.ts` and `tests/learner-dashboard-page.test.ts`: 82/82 passed.
- `tests/components/support-entry-points.test.tsx`, `learner-support.test.tsx`, `certificate-slot.test.ts`, results tests: 76/76 passed.
- `tests/ticket-context-entry.integration.test.ts`: 4/4 passed on testcontainers PostgreSQL (real ownership queries for all five kinds incl. foreign/mismatched/unknown ids; dashboard ticket query owner-scoped, closed excluded, max 3, newest first, five safe fields only). This also covers the 12-05 ticket-learner-context-service against a real DB.
- Broader run (boundary, orders, results, all tests/components): 64 files, 670 passed, 1 skipped.
- `npx tsc --noEmit`: clean. ESLint on changed files: 0 errors (one pre-existing warning in VideoWatchTracker.tsx).
- Not run: manual browser check of link placement; full-repo `npm run lint` (ticket-service.ts has pre-existing no-explicit-any errors, untouched).

## Deviations from Plan

**1. [Rule 3 - Blocking] Existing tests referenced `card.tickets`**
- Removing the deferred column broke `tests/certificate-slot.test.ts` typing and the "tickets deferred" assertions; updated them (commit 111958f). Plan Task 1 listed only two test files.

**2. Placement choices**
- Learning overview uses COHORT context (the enrolment's cohort id) rather than Course, since one primary record per surface is required. The plan's `src/app/(learner)/learn/` directory has no separate results-page edit: the Submission link lives in `ResultsList` (rendered by the results page) on the latest submission of each assignment. Quizzes/attempts get no link (no Submission context).
- The dashboard section also renders in the no-enrolments empty state, since a learner may still have tickets.
- Order-receipt and page-level rendering are covered by component-level tests of GetSupportLink; the orders page itself has no new render test.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-12-01 (safe projection with negative assertions), T-12-03 (server re-authorises hint; real-DB proof), T-12-12 (href carries only kind + opaque id; encoding test) mitigated.

## Self-Check: PASSED
