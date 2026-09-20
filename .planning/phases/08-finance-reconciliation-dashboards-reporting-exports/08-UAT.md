---
status: testing
phase: 08-finance-reconciliation-dashboards-reporting-exports
source: [08-VERIFICATION.md]
started: 2026-09-17T03:19:52Z
updated: 2026-09-20T01:20:00+01:00
---

## Current Test

number: 1
name: Deployed asynchronous export lifecycle
expected: |
  A large authorized export progresses in the deployed Netlify/S3 environment, remains visible after leaving the page, downloads only through a short-lived owner-authorized link, and expires safely.
awaiting: user response

## Tests

### 1. Deployed asynchronous export lifecycle

expected: Configure the dispatch secret and private storage in a deployed test environment; queue a large export, leave and return, verify status/download/retry/expiry and denial behavior as described in 08-VERIFICATION.md.
result: pending

### 2. Responsive and 200% zoom visual check

expected: Reconciliation, reports, and Export History reflow at mobile widths and 200% zoom with long text and large NGN/USD values; no clipped amount or page-level horizontal scrolling.
result: pass
observed: Chrome verified Reconciliation, the Reports hub, Export History, and the Payments dashboard at desktop and 390px mobile widths, plus an 823px viewport representing the layout width available at 200% zoom on the 1646px desktop viewport. Controls reflowed, mobile report rows became cards, and large NGN/USD values remained visible without page-level horizontal scrolling. The desktop report table now preserves readable columns inside a labelled horizontal scroll region at the constrained width. The NGN filter produced the expected URL and four matching rows; a filtered Payments CSV export queued successfully and appeared in Export History. The Progress route displayed its explicit `Not available yet` state.

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

### G-08-1: Report dashboard routes crash at the Server-to-Client boundary

- status: resolved
- severity: blocker
- test: 2
- route: `/staff/reports/payments`
- observed: Chrome displayed the Next.js runtime error "Only plain objects, and a few built-ins, can be passed to Client Components from Server Components". The serialized value includes the report definition's Zod `filterSchema` object.
- expected: The dashboard should render its filters, metrics, drill-down records, refresh action, and export control without passing class instances across the Server Component boundary.
- root_cause: `src/app/staff/reports/[dataset]/page.tsx` passes the complete `DatasetReport` directly to the client `ReportDashboard`. `DatasetReport.definition` is sourced from `REPORT_REGISTRY` and includes the executable Zod `filterSchema`, which is a class instance and cannot cross Next.js 16's Server-to-Client serialization boundary. The component tests render `ReportDashboard` directly in jsdom, so they bypass this boundary and did not expose the failure.
- resolution: Added a typed server-to-client projection that strips `filterSchema` before rendering the Client Component, plus a regression test for the boundary. Chrome then rendered the Payments dashboard with its filters, metrics, breakdown, rows, and export controls.

### G-08-2: Wide report columns collapse at the 200% zoom equivalent width

- status: resolved
- severity: major
- test: 2
- route: `/staff/reports/payments`
- observed: At 823px, the fixed-layout Payments table compressed 19 columns until words wrapped one character per line.
- expected: Dense desktop rows remain readable and are reachable without creating page-level horizontal overflow.
- root_cause: The table combined `table-fixed`, `w-full`, and `overflow-wrap:anywhere` without a horizontal overflow container or minimum intrinsic width.
- resolution: The table now uses readable intrinsic column widths inside a keyboard-focusable, labelled `overflow-x-auto` region. Chrome verified the contained scrollbar at 823px, while 390px continues to use stacked row cards.
