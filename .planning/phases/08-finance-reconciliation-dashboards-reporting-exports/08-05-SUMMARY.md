---
phase: 08-finance-reconciliation-dashboards-reporting-exports
plan: "05"
subsystem: reporting
tags: [prisma, postgresql, exports, csv, nextjs, vitest]
requires:
  - phase: 08-finance-reconciliation-dashboards-reporting-exports
    plan: "04"
    provides: Authorized normalized report and refund row projections
provides:
  - Immutable, transactionally frozen export job snapshots and bounded request lifecycle
  - Stable spreadsheet-safe CSV serialization and validated dashboard export actions
  - Live export migration and real PostgreSQL integration and load proof
affects: [08-07-export-worker, 08-08-export-history, 08-09-audit-export, 08-12-refund-export]
actuals:
  tokens: 12000
  tasks: 3
  commits: 0
tech-stack:
  added: []
  patterns:
    - Request-time snapshot and job are written with audit evidence in one serializable transaction
    - Export producers receive server-derived filters, scope, columns, and as-of time
key-files:
  created:
    - prisma/migrations/20260915130000_export_snapshots/migration.sql
    - prisma/migrations/20260916084923_export_snapshots/migration.sql
    - src/server/services/export-service.ts
    - src/server/services/csv-service.ts
    - src/app/staff/reports/actions.ts
    - tests/export-service.integration.test.ts
    - tests/export-snapshot-load.test.ts
    - tests/csv-service.test.ts
  modified:
    - prisma/schema.prisma
    - src/app/staff/reports/[dataset]/ReportDashboard.tsx
    - tests/components/Reports.test.tsx
key-decisions:
  - Preserve frozen rows on retry and take a new authorized snapshot on rerun after expiry.
  - Keep the second additive migration that removes the temporary updatedAt default; both migrations are applied locally.
  - Keep implementation and documentation uncommitted under the user's project-specific instruction.
requirements-completed: [PAY-06, RPT-02, RPT-03, RPT-04]
coverage:
  - id: D1
    description: Immutable scoped export snapshots, replay, retry, rerun, and atomic bounds
    requirement: RPT-04
    verification:
      - kind: integration
        ref: tests/export-service.integration.test.ts
        status: pass
      - kind: integration
        ref: tests/export-snapshot-load.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Stable safe CSV and dashboard export queue interaction
    requirement: RPT-03
    verification:
      - kind: unit
        ref: tests/csv-service.test.ts
        status: pass
      - kind: automated_ui
        ref: tests/components/Reports.test.tsx
        status: pass
    human_judgment: false
completed: 2026-09-16
status: complete
---

# Phase 08 Plan 05: Immutable Export Snapshots and CSV

**Export requests now freeze authorized rows at request time, queue a bounded job, and expose a stable, spreadsheet-safe CSV contract.**

## Accomplishments

- Added `ExportSnapshotRow` and extended `ExportJob` through two additive migrations, applied to the designated local PostgreSQL database. Prisma migration status reports all 12 migrations current, and Prisma Client generation succeeds.
- Added server-owned export producers, serializable request and audit transaction, 25,000-row and 25-MiB limits, idempotent replay, linked retry, and current-data rerun after expiry.
- Wired strict Server Actions and the dashboard export dialog; CSV metadata and columns remain stable and formula-like cells are neutralized.

## Verification

- `tests/export-service.integration.test.ts`: 9 passed against disposable PostgreSQL.
- `tests/export-snapshot-load.test.ts`: 2 passed, including both boundary fixtures under each operation's 10-second budget.
- `tests/csv-service.test.ts` and `tests/components/Reports.test.tsx`: 22 passed.
- TypeScript, Prisma schema validation, Prisma Client generation, local migration status, and `git diff --check`: passed.

## Issues Encountered

The first combined Vitest run lost one disposable container and timed out starting a worker. Running the PostgreSQL integration and load suites individually passed. The configured Neon database was unreachable in this sandbox, so migration status was checked against the previously designated local PostgreSQL container on port 5434.

## Task Commits

None. The user instructed that Phase 8 implementation, migrations, tests, and summaries remain uncommitted for review.

## Next Phase Readiness

Plans 08-07, 08-08, 08-09, and 08-12 can consume the frozen snapshot and CSV contract. The export worker and authorized download lifecycle are not delivered by this plan.

## Self-Check: PASSED

The plan's three tasks, required files, live migration, and focused verification are complete. No commit was created.
