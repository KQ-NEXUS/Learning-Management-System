---
phase: 08-finance-reconciliation-dashboards-reporting-exports
plan: "04"
subsystem: reporting
tags: [nextjs, prisma, postgresql, dashboards, rbac, vitest]
requires:
  - phase: 08-finance-reconciliation-dashboards-reporting-exports
    plan: "03"
    provides: Fixed report registry, collection authorization, reports hub and normalized query foundation
provides:
  - Ten fixed dashboard routes with four database-backed reports and six explicit unavailable states
  - Scope-filtered report rows, aggregates, drill-down links and refund export-row projection
  - Responsive dashboard trust frame with manual refresh, filters, metrics, breakdown and row evidence
affects: [08-05-exports, 08-07-export-worker, reporting-verification]
actuals:
  tokens: 15500
  tasks: 2
  commits: 0
tech-stack:
  added: []
  patterns:
    - One authorized normalized request supplies complete filtered rows, metrics, links and paginated presentation
    - Inclusive Africa/Lagos business-day boundaries are converted to instants before database filtering
    - Filter-option failure degrades independently of successful row and metric projections
key-files:
  created:
    - src/app/staff/reports/[dataset]/page.tsx
    - src/app/staff/reports/[dataset]/ReportDashboard.tsx
    - src/app/staff/reports/[dataset]/loading.tsx
  modified:
    - src/server/services/report-query-service.ts
    - tests/report-scope.integration.test.ts
    - tests/components/Reports.test.tsx
key-decisions:
  - Use confirmed payment-attempt dates for payment filtering and exact separate NGN/USD totals.
  - Derive dashboard metrics from the complete scoped row projection before pagination, with links that carry matching filters.
  - Keep the export entry point as a filter-preserving handoff to Plan 08-05 rather than claiming a CSV has already been queued.
requirements-completed: [PAY-06, PAY-12, RPT-01, RPT-02]
coverage:
  - id: D1
    description: Four available datasets return scoped, date-bounded row projections and derived metrics.
    requirement: RPT-01
    verification:
      - kind: integration
        ref: tests/report-scope.integration.test.ts
        status: pass
      - kind: integration
        ref: Read-only local PostgreSQL smoke across registrations, payments, enrolments and attendance
        status: pass
    human_judgment: false
  - id: D2
    description: Refund rows retain provider, currency, amounts, status, references and safe exception context under a trusted collection predicate.
    requirement: PAY-06
    verification:
      - kind: integration
        ref: tests/report-scope.integration.test.ts#uses one scoped refund-row predicate
        status: pass
    human_judgment: false
  - id: D3
    description: Ten fixed dashboard routes distinguish available data from not-yet-operational capabilities and present responsive trust states.
    requirement: RPT-01
    verification:
      - kind: automated_ui
        ref: tests/components/Reports.test.tsx
        status: pass
    human_judgment: true
    rationale: Browser-level narrow-screen and 200%-zoom overflow still require visual UAT.
duration: 6h40m including quota interruption
completed: 2026-09-16
status: complete
---

# Phase 08 Plan 04: Fixed Dashboard Routes and Scoped Report Rows Summary

Four operational dashboards now project authoritative, scoped rows and derived metrics, while the remaining six routes explicitly explain why data is not yet available.

## Performance

- **Tasks:** 2/2
- **Files created or modified:** six plan-owned source/test files plus this summary
- **Commits:** 0, under the explicit user no-commit override
- **HEAD:** `47e5be00ca42021281b53b5cb0a83d9e54f6c937` throughout execution

## Accomplishments

- Expanded the report service with registration, payment, enrolment and attendance adapters; each applies current collection scope before reading, converts inclusive Africa/Lagos dates to instants, derives metrics from complete filtered rows, and paginates only the returned evidence.
- Added the non-dashboard reconciliation-refunds row adapter with provider, currency, date, status and trusted scope filtering for the later CSV producer.
- Added the ten fixed report routes, available/unavailable states, stable loading skeleton, URL-backed filters, explicit Refresh data action, text-bearing metric and breakdown links, responsive row/card evidence and safe error copy.
- Preserved separate NGN/USD money totals and the distinction among manual not-applicable values, pending gateway actuals and genuine numeric zero.

## Task Results

### Task 1: Available dashboard aggregates, rows, options and drill-down parity

The service now uses one authorized normalized request per dataset. Database predicates constrain scope and date before row selection; the same complete projection drives aggregate metrics and drill-down links. Refund rows expose safe reconciliation context and stable business-date/id ordering. Tests cover date edges, payment fields, exact currency grouping, refund predicates, pagination and independent option failure.

### Task 2: Fixed dashboard trust frame and UI states

The dynamic Next.js route awaits promised params and search params, rejects unknown datasets without revealing data, and renders four available or six explicit unavailable states from the registry. The client presentation has manual refresh, timestamps, filter form, linked metrics/breakdown, semantic desktop table and mobile cards, checked-zero copy, and section failure treatment.

## Verification

- `npx vitest run tests/report-scope.integration.test.ts tests/components/Reports.test.tsx tests/report-registry.test.ts tests/payment-read-service.test.ts --reporter=dot --no-file-parallelism`: **PASS**, four files and 51 tests.
- Read-only live PostgreSQL smoke against the designated local Docker instance on `localhost:5434`: **PASS**, all four available adapters and the refund-row adapter executed against the migrated schema. The connection existed only in the test process environment; no credentials were printed or env files edited. The temporary smoke test was removed after verification so the ordinary suite has no environment-dependent skip.
- `npx tsc --noEmit --pretty false`: **PASS**.
- ESLint over all six owned source/test files: **PASS**.
- `git diff --check`: **PASS**.

## Deviations from Plan

### Process overrides

- No TDD or metadata commits were created, as explicitly instructed by the user. RED was observed before each new task surface was implemented; the later GREEN suites passed.
- `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` and `.planning/config.json` were not edited.

### Auto-fixed issues

**1. [Rule 1 - Correctness] Aligned metric links with their row predicates**

- **Found during:** Task 1
- **Issue:** Refund/exception metrics and attendance segments needed dedicated status predicates; otherwise a link could open different evidence than its count.
- **Fix:** Added exact status filters and derived session-based attendance segment counts.
- **Files modified:** `src/server/services/report-query-service.ts`
- **Verification:** Report query suite and live PostgreSQL smoke passed.

**2. [Rule 2 - Missing critical] Kept option-query failure from erasing successful report evidence**

- **Found during:** Task 2
- **Issue:** Scoped option discovery is independent of row and metric projection.
- **Fix:** It now emits a section-specific error while retaining successful metrics, rows, scope and timestamps.
- **Files modified:** `src/server/services/report-query-service.ts`, `src/app/staff/reports/[dataset]/ReportDashboard.tsx`
- **Verification:** Focused service/component suites passed.

## Known Stubs

- `src/app/staff/reports/[dataset]/ReportDashboard.tsx`: `Export CSV` preserves dataset and URL filters into `/staff/reports/exports`, but it does not enqueue a job here. Plan 08-05 owns the asynchronous export request and history workflow; this handoff must be wired before end-to-end export acceptance.

## Next Phase Readiness

- Plan 08-05 can use `getDatasetReport` and `getReconciliationRefundRows` as the authorized row sources for immutable export snapshots.
- Browser UAT should check narrow-screen and 200%-zoom overflow, especially the dense PAY-12 payment row projection.

## Self-Check: PASSED

- All six plan-declared implementation and test files and this summary exist.
- The final focused suite, TypeScript, owned-file ESLint, read-only PostgreSQL smoke and whitespace check passed.
- HEAD remains `47e5be00ca42021281b53b5cb0a83d9e54f6c937`; no commit was created.
