---
phase: 08-finance-reconciliation-dashboards-reporting-exports
plan: "03"
subsystem: reporting
tags: [nextjs, prisma, rbac, zod, vitest]
requires:
  - phase: 01-authentication-and-authorization
    provides: permission catalogue, active grants, and scoped authorization primitives
  - phase: 08-01
    provides: reconciliation case models used by the reporting query layer
provides:
  - collection-level authorization with server-derived cohort predicates
  - immutable report and export metadata registries
  - scope-safe report overview queries with currency-separated payment totals
  - responsive reports hub with explicit availability, loading, zero, and error states
affects: [08-05-exports, 08-09-audit-export, reporting-dashboards]
tech-stack:
  added: []
  patterns:
    - server-derived collection scope predicates
    - immutable report metadata as the availability authority
    - report queries normalized to a single authorization snapshot and as-of instant
key-files:
  created:
    - src/server/permissions/collection-scope.ts
    - src/server/services/report-registry.ts
    - src/server/services/report-query-service.ts
    - src/app/staff/reports/page.tsx
    - src/app/staff/reports/ReportsHub.tsx
    - tests/report-registry.test.ts
    - tests/report-scope.integration.test.ts
    - tests/components/Reports.test.tsx
  modified: []
key-decisions:
  - All ten report definitions require reports.view, while metadata-only reconciliation and audit exports retain their narrower payments.view and audit.view permissions.
  - The registry is the sole authority for available versus not-yet-available report states.
  - Payment headlines remain separate NGN and USD values; no cross-currency total is computed.
  - Collection scope always comes from active server-side grants and is embedded in every relevant Prisma query.
requirements-completed: [RPT-01, RPT-02]
actuals:
  tokens: 13644
  tasks: 3
  commits: 0
duration: 39 min
completed: 2026-09-15
status: complete
---

# Phase 08 Plan 03: Shared Report Contract and Reports Hub Summary

Scope-safe reporting foundations with an immutable ten-report catalogue, server-authorized dashboard queries, and a responsive reports hub that distinguishes unavailable data from genuine zero values.

## Performance

- **Duration:** 39 min
- **Started:** 2026-09-15T20:18:00Z
- **Completed:** 2026-09-15T20:57:00Z
- **Tasks:** 3
- **Files created:** 8 source/test files plus this summary
- **Commits:** 0, by explicit user instruction

## Accomplishments

- Added a reusable collection authorizer that derives a deterministic union of GLOBAL, PROGRAMME, COURSE, and COHORT grants and rejects unauthenticated, empty, or malformed authorization state.
- Established a fixed, ordered catalogue of ten reports and a metadata-only export registry, including safe/sensitive column metadata and explicit availability states.
- Added report overview queries that apply the authorized cohort predicate to orders, enrolments, reconciliation cases, grouped totals, and filter options while preserving null and zero semantics.
- Built the reports hub with grouped cards, destination-named metric links, filter-preserving URLs, separate NGN/USD payment totals, and accessible loading, error, unavailable, zero, timestamp, and long-label states.

## Task Results

### Task 1: Report registry and collection authorization

- Created immutable report/export metadata registries with runtime guards.
- Created collection-level authorization from active grants with auditable denials.
- Verified with 11 registry and scope tests.

### Task 2: Scope-safe report query service

- Added Zod-validated request normalization, as-of/date-range handling, deterministic options, and authorized Prisma predicates in every data path.
- Preserved separate currency totals and explicit absent-group zero values.
- Verified with 12 scope integration tests.

### Task 3: Reports hub UI

- Added the Next.js server page and client-facing presentation component for all report states.
- Added component coverage for ordering, navigation, currency labels, availability, zeroes, loading/errors, long labels, and machine-readable timestamps.
- Verified with the complete 25-test plan suite and a focused mutation regression check for accessible metric links.

## Verification

- `npx vitest run tests/report-registry.test.ts tests/report-scope.integration.test.ts tests/components/Reports.test.tsx --reporter=verbose --no-file-parallelism` — passed: 3 files, 25 tests.
- `npx vitest run tests/components/Reports.test.tsx -t "makes every headline" --reporter=verbose --no-file-parallelism --testTimeout=15000` — passed: 1 focused test, 7 skipped by filter.
- Focused RED proof: temporarily removing the destination aria-label made the focused link test fail on the missing accessible name; the implementation was restored and the focused GREEN run passed.
- `npx tsc --noEmit` — passed with no diagnostics.
- `npx eslint src/server/permissions/collection-scope.ts src/server/services/report-registry.ts src/server/services/report-query-service.ts src/app/staff/reports/page.tsx src/app/staff/reports/ReportsHub.tsx tests/report-registry.test.ts tests/report-scope.integration.test.ts tests/components/Reports.test.tsx` — passed with no diagnostics.

## Decisions Made

- Report availability is data in the registry rather than inferred from absent query results, preventing “not available yet” from being rendered as zero.
- Report requests accept business filters but never accept caller-authored scope; scope is resolved from the current actor's grants.
- The report page resolves data before rendering JSX so framework rendering/control-flow errors are not accidentally swallowed.

## Deviations from Plan

### Process Overrides

- Per explicit user instruction, no task or metadata commits were created and project state/roadmap/requirements files were not modified. All Plan 08-03 changes remain uncommitted for orchestrator review.

### Verification Environment

- One focused component rerun exceeded the suite's default 5-second timeout while the assertion was executing. The identical focused test passed with an explicit 15-second test timeout; the complete 25-test plan suite had already passed under the default configuration.

No functional scope deviations were required.

## Known Stubs

None. The six `NOT_AVAILABLE_YET` catalogue entries are intentional product states required by the plan, not unwired placeholders.

## Self-Check: PASSED

- All eight declared source/test files and this summary exist.
- TypeScript, scoped ESLint, registry/scope tests, and reports component tests pass.
- Repository HEAD remains `47e5be00ca42021281b53b5cb0a83d9e54f6c937`; no commits were created.
- Pre-existing Phase 08-01 work remains present and was not reverted or overwritten.
