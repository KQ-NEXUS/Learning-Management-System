---
phase: 12-support-tickets
plan: 09
status: complete
requirements: [SUP-01, SUP-02, SUP-03, SUP-04, SUP-05, SUP-06]
key-files:
  created:
    - tests/ticket-access.integration.test.ts
    - tests/ticket-phase-invariants.test.ts
  modified:
    - src/server/services/ticket-service.ts
    - tests/components/support-workspace.test.tsx
    - .planning/phases/12-support-tickets/12-VALIDATION.md
---

# Phase 12 Plan 09: Cross-surface proof - COMPLETE (all 3 tasks; Task 3 human-approved 2026-09-25)

## Completed

- Task 1 (9954824): real-Postgres ownership parity and attachment lifecycle (intent/complete/download/cap/mismatch/internal-note denial) plus static invariants. 7 suites, 40 tests green.
- Task 2 (24e6248): fixed 15 no-explicit-any lint errors in ticket-service.ts, added 4 component tests, reconciled 12-VALIDATION.md. Full suite 274 files / 3710 passed / 1 skipped (pre-existing audit-table); tsc, prisma validate/generate, build green.

## Follow-up work done after the executor checkpoint

- Ticket RBAC integration test committed (ef63f5f, type error fixed); migration 20260925120000_ticket_queue_changed_event applied to the Neon DB via prisma migrate deploy; status "Database schema is up to date".
- Lint: 3 errors in tests/certificate-pdf-unicode.test.ts fixed with scoped disables (5137b41). npm run lint: 0 errors, 20 warnings.
- Real-Postgres stale ticket-attachment sweep test (2e6304f).
- loading.tsx skeletons for /support, /support/[reference], /staff/support, /staff/support/[reference] (eb126c6); jsdom axe checks on the support surfaces, axe-core added as devDependency (cffeb9a).
- claimTicket now refuses tickets owned by anyone (TicketAlreadyAssignedError, guidance to reassign) and always records CLAIMED (5fa8e16), matching D-07.

## Known gaps (accepted, not blockers)

- Staff queue filtering runs in memory: tracked in .planning/todos/pending/2026-09-25-move-staff-support-queue-filtering-into-sql.md.
- axe runs in jsdom only (contrast/layout not machine-checked); covered by the human walkthrough.

## Task 3 results (deployed human walkthrough)

Reported by the user on 2026-09-25: **all eight steps passed** ("everything passes"): learner creation and keyboard/mobile, uploads and rejections, public/internal separation, staff lifecycle, R2 privacy and attachment disposition, Netlify scheduled auto-close, dashboard/CSV reconciliation, record/cleanup.

Limitation: the user gave an overall approval only. Per-step observations, account identifiers, ticket references, browsers/viewports and cleanup details were not supplied and are not recorded here.
