---
phase: 12-support-tickets
plan: 08
subsystem: reporting
tags: [support, reports, csv-export, privacy, postgres]
requires:
  - phase: 12-02
    provides: Ticket, TicketEvent models and lifecycle service
provides:
  - AVAILABLE support report dataset (backlog health + trailing-30-day performance)
  - Metadata-only support CSV with identity columns gated on users.view
affects: [reports hub, export history]
tech-stack:
  added: []
  patterns: [one normalized projection shared by dashboard and export, structural omission of private relations]
key-files:
  created:
    - src/lib/support-report-vocabulary.ts
    - tests/support-report.test.ts
    - tests/support-report.integration.test.ts
  modified:
    - src/server/services/report-registry.ts
    - src/server/services/report-query-service.ts
    - src/server/services/export-service.ts
    - src/app/staff/reports/actions.ts
    - src/app/staff/reports/[dataset]/page.tsx
    - src/app/staff/reports/[dataset]/ReportDashboard.tsx
    - tests/report-registry.test.ts
    - tests/components/Reports.test.tsx
key-decisions:
  - "Support access needs reports.view (any scope) plus tickets.view GLOBAL; identity columns need users.view GLOBAL"
  - "Rows are tickets created in range; backlog metrics drill down with from=2000-01-01 and status=OPEN_BACKLOG so links reconcile"
  - "Owner appears in CSV as opaque ownerId only; owner name is dashboard-only"
  - "Age bands use whole elapsed days: <1d, 1-3d, 4-7d, 8d+"
requirements-completed: [SUP-06]
duration: about 40 min
completed: 2026-09-25
---

# Phase 12 Plan 08: Support Report and CSV Summary

Support is an AVAILABLE report on the existing platform: current backlog health plus trailing-30-day performance, with a metadata-only CSV that reuses the same normalized projection, and no message, note or attachment relation anywhere in the query or row types.

## Tasks

1. Activate and normalize the support dataset: 5c908e5
2. Wire support CSV authorization and reporting UI: 6a12f9e
3. Real-Postgres reconciliation, scope and privacy proof: fa2416b

## Behavior

- Health (as of one frozen instant): Open, Unassigned, Urgent, Escalated, backlog age bands, queue and owner distribution.
- Performance (default asOf minus 30 days through asOf): created, resolved, median first response, median resolution, reopen rate, escalation count and median escalation-to-acceptance time (from TicketEvent). Medians average the two middle values on even counts; empty sets show no data, not zero. Helper text states each denominator.
- Filters: date, category, priority, queue, owner, status (plus OPEN_BACKLOG pseudo-status and UNASSIGNED owner).
- Export producer resolves learner identity only when selected, via a ticket-to-user select; the row type has no body/note/filename/storage/attachment property.

## Verification (actual results)

- `npx vitest run tests/support-report.test.ts tests/report-registry.test.ts tests/components/Reports.test.tsx tests/report-client-boundary.test.ts`: 31 passed (before UI tests added; Reports.test.tsx and boundary re-run: 18 passed).
- `npx vitest run tests/support-report.integration.test.ts --no-file-parallelism` against a testcontainers PostgreSQL: 6 of 6 passed.
- Regression: export-service.integration, report-scope.integration, audit-export-service, reconciliation-export-action, finance-reporting-ui, ExportHistory: 66 passed.
- `tsc --noEmit` clean; ESLint on touched files clean.
- Not run: the full repository test suite; `tests/export-service.integration.test.ts` was run but has no support-specific cases of its own.

## Deviations from Plan

**[Rule 2 - Missing critical functionality] permittedSensitiveColumnsAction.** `src/app/staff/reports/actions.ts` (not in the plan's file list) now requires tickets.view GLOBAL and users.view GLOBAL for support, so the UI hint matches server reauthorization. Committed with Task 2.

**[Rule 3] Client-safe vocabulary module.** Added `src/lib/support-report-vocabulary.ts` so the client dashboard does not import the server registry; the registry re-exports the constants.

**Test updates.** `report-registry.test.ts` and hub counts in `Reports.test.tsx` (5 available, 5 not yet) changed because support is now available.

The pre-existing ticket-service UploadStatusValue mismatch was not touched.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-12-01, T-12-09, T-12-11 mitigated and tested).

## Self-Check: PASSED

Files and commits 5c908e5, 6a12f9e, fa2416b verified present.
