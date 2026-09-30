---
phase: 08-finance-reconciliation-dashboards-reporting-exports
verified: 2026-09-17T03:19:52Z
status: passed
human_verified: 2026-09-30
score: 7/7 requirements implemented and verified; 2/2 human checks passed (08-UAT.md)
behavior_unverified: 0
coincidental_reliance_items: []
---

# Phase 08 Verification Report

**Goal:** Finance/Operations staff can trust reconciled, correctly scoped, exportable numbers across providers.

## Goal achievement

| Requirement | Result | Evidence |
|---|---|---|
| PAY-06 | Verified locally | Reconciliation rows, provider filters, per-currency summary, and matching CSV use the same scoped filters; `reconciliation-case.integration.test.ts`, `reconciliation-export-action.test.ts`, `report-scope.integration.test.ts`. |
| PAY-12 | Verified locally | Payment/refund case detail presents provider, currency, price and fee components, references, state, and safe evidence; `reconciliation-case-service.test.ts`, `components/ReconciliationWorkspace.test.tsx`. |
| RPT-01 | Verified locally | Ten fixed report definitions expose metric descriptions, filters, timestamps, and explicit Available/Not available yet states for source systems still pending; `report-registry.test.ts`, `components/Reports.test.tsx`, `components/finance-reporting-ui.test.tsx`. |
| RPT-02 | Verified locally | Current grants and collection scope govern dashboards, aggregates, filters, job history, and download; `report-scope.integration.test.ts`, `export-service.integration.test.ts`, `export-download-route.test.ts`. |
| RPT-03 | Verified locally | Fixed registry columns, applied filters, frozen as-of/timezone, stable CSV rows, and reconciliation path; `csv-service.test.ts`, `export-service.integration.test.ts`, `export-snapshot-load.test.ts`. |
| RPT-04 | Verified | Queued, processing, success, failure, retry, expiry, and authorized short-lived download are exercised by `export-worker.integration.test.ts`, `netlify-export-functions.test.ts`, `export-download-route.test.ts`, and `components/ExportHistory.test.tsx`. Deployed Netlify/R2 queueing, background progress, signed download, and cross-account denial passed UAT on 2026-09-21; failure, retry, expiry, post-expiry denial, and rerun passed UAT on 2026-09-30 against the Docker stack running the same worker code. |
| RPT-05 | Verified locally | Global grant gates, filtered audit view/export, safe metadata projection, redaction, correlation, and append-only writes are exercised by `audit-export-service.test.ts`, `audit-append-only.integration.test.ts`, `audit-append-only.test.ts`, and `components/audit-table.test.tsx`. |

All seven requirement IDs in `.planning/REQUIREMENTS.md` appear in the 12 Phase 08 plan frontmatter records. The four ROADMAP success criteria are implemented and covered locally.

## Automated evidence

All 162 Vitest files have passing segmented runs: 99 Node unit files (1,520 assertions), 22 PostgreSQL integration files (188 assertions), and 41 jsdom component files (384 assertions, one pre-existing skip). Typecheck, lint with zero errors, production build, and whitespace check pass. The combined `npm.cmd test` command crashed on Windows before a summary; grouped disposable databases also had intermittent Docker HTTP 409 setup failures. Every affected file was rerun successfully in a separate process. `08-VALIDATION.md` records the limitation.

## Human verification required

### 1. Deployed asynchronous export lifecycle

**Test:** In a deployed test environment with `EXPORT_DISPATCH_SECRET` and private S3 storage configured, queue a large authorized export, leave the page, return through Export History, download within its availability window, retry a failed job if induced, and check expiry afterward.

**Expected:** Netlify dispatch accepts only the shared secret and sends a no-instruction background request; the job progresses from database state, the authorized owner receives a short-lived download, a revoked or expired request receives the same safe recovery response, and expiry removes the private object reference.

**Why human:** Local function, database, and storage-adapter tests do not prove the deployed Netlify scheduler/background and S3 configuration together.

**Result:** Passed. On the deployed site (2026-09-21) a Registrations export was queued, progressed to `Succeeded` while the owner was away, downloaded through a 60-second signed R2 URL, and was refused to a different account with the neutral `Download unavailable` response. On 2026-09-30 the self-hosted Docker stack exercised the remaining states with the real worker: a genuine storage outage produced `FAILED` with only the safe message; retry created a linked job with the original frozen as-of and succeeded; the expiry sweep (clock injected +25h) deleted the object and cleared the reference; the owner's post-expiry download got the same neutral 404; rerun created a fresh job with a new as-of. Rejection of a wrong dispatch secret was not re-tried in deployment and rests on `netlify-export-functions.test.ts`. Details in `08-UAT.md` test 1.

### 2. Responsive and 200% zoom visual check

**Test:** Inspect reconciliation, reports, and Export History on desktop and mobile widths at normal and 200% zoom using long names, references, notes, and large positive/negative NGN and USD amounts.

**Expected:** No page-level horizontal scroll or clipped amount; cards reflow, controls wrap, status has text, and mobile cards retain the essential information and actions shown in desktop tables.

**Why human:** The component suite checks markup, content, and responsive classes; jsdom cannot measure visual geometry.

**Result:** Passed after gaps G-08-1 and G-08-2 were fixed. Details in `08-UAT.md` test 2.

## Gaps

No implementation gap found in local evidence. UAT found two gaps (G-08-1 Server-to-Client boundary crash, G-08-2 wide-table collapse at 200% zoom); both are resolved. Both human checks passed; the phase is complete.
