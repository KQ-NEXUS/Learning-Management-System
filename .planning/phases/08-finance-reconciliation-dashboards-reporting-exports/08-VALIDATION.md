---
phase: "08"
slug: "finance-reconciliation-dashboards-reporting-exports"
status: human_needed
nyquist_compliant: true
wave_0_complete: true
created: "2026-09-15"
updated: "2026-09-16"
---

# Phase 08 — Validation Map

Vitest 4.1.11 uses Node and jsdom projects from `vitest.config.mts`. PostgreSQL integration tests use disposable Testcontainers databases with all 12 checked-in migrations. The implementation and summaries remain uncommitted for review.

| Requirement | Plans | Automated evidence | Focused result |
|---|---|---|---|
| PAY-06, PAY-12 | 08-01, 02, 04, 05, 12 | `reconciliation-case-service.test.ts`, `reconciliation-case.integration.test.ts`, `report-scope.integration.test.ts`, `components/ReconciliationWorkspace.test.tsx`, `reconciliation-export-action.test.ts` | Green in plan checks |
| RPT-01 | 08-03, 04, 10 | `report-registry.test.ts`, `components/Reports.test.tsx`, `components/finance-reporting-ui.test.tsx` | Green; 24 named UI consideration checks |
| RPT-02 | 08-03, 04, 05, 08, 12 | `report-scope.integration.test.ts`, `export-service.integration.test.ts`, `export-download-route.test.ts`, `components/ExportHistory.test.tsx` | Green, including retry lineage and current-scope download checks |
| RPT-03 | 08-03, 05, 09 | `report-registry.test.ts`, `csv-service.test.ts`, `export-service.integration.test.ts`, `export-snapshot-load.test.ts`, `audit-export-service.test.ts` | Green in focused runs |
| RPT-04 | 08-07, 08, 11 | `aws-sdk-lockfile.test.ts`, `export-storage.test.ts`, `export-worker.integration.test.ts`, `netlify-export-functions.test.ts`, `export-download-route.test.ts`, `phase8-invariants.test.ts` | Green in focused runs |
| RPT-05 | 08-09 | `audit-export-service.test.ts`, `audit-append-only.integration.test.ts`, `components/audit-table.test.tsx` | Green; append-only PostgreSQL fixture passed |

## Cross-surface gates

- `phase8-invariants.test.ts`: seven source/AST boundaries for navigation, server-only code, private downloads, database-authoritative queue processing, currency separation, and dependency/style prohibitions.
- `components/finance-reporting-ui.test.tsx`: 22 named state considerations plus two source-level zoom/large-value backstops. Focused component tests provide interaction evidence; jsdom does not measure visual geometry.
- Current authorization, exact expiry, denial equivalence, audit-before-presign and no-store redirect are exercised in `export-download-route.test.ts`.
- Snapshot bounds, worker claims/replay/expiry, secret-gated dispatch and audit append-only behavior have database/function tests.

## Final regression gate

- All 162 test files were exercised successfully in segmented runs: 99 Node unit files (1,520 passing assertions), 22 PostgreSQL integration files (188 passing assertions), and 41 jsdom component files (384 passing assertions, one pre-existing skip). The node count includes `schema-cohort.test.ts` and the 25,000-row snapshot load file rerun in isolation. Focused reruns resolved audit single-writer, request-only import, legacy Cohort price, spacing, and stale package assertions.
- A single `npm.cmd test` process did **not** exit green. Windows Vitest twice exited with access violation `-1073741819` after many files, and grouped PostgreSQL runs intermittently hit Docker HTTP 409 during disposable-container setup. Every skipped/setup-blocked file subsequently passed as a separate process. The segmented evidence covers both configured projects and every file; it does not establish that the monolithic command is stable on this Windows host.
- `npx.cmd tsc --noEmit`: passed on the corrected source. `npm.cmd run lint`: passed with 0 errors and only pre-existing warnings; the one new warning was removed. `npm.cmd run build`: passed on the corrected source, including Next.js TypeScript and page generation. `git diff --check`: passed with a line-ending normalization notice for `audit/page.tsx`.

## Manual evidence still needed

1. Configure Netlify `EXPORT_DISPATCH_SECRET` for the scheduled dispatcher and Background Function, then queue a large scoped export in a deployed test environment. Leave the page, return after processing, download within the availability window, and confirm later expiry. Local tests do not prove the deployed Netlify/S3 lifecycle.
2. Inspect reconciliation, reports, and history at desktop and mobile widths and 200% zoom with long text and large NGN/USD amounts. The automated backstops check markup and data states, not pixel geometry.

Automated coverage is complete through segmented runs. Phase sign-off awaits the deployed lifecycle and visual UAT items in `08-UAT.md`.
