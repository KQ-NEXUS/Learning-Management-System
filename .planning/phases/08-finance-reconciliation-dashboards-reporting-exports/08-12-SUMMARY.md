---
phase: 08-finance-reconciliation-dashboards-reporting-exports
plan: "12"
subsystem: reporting
tags: [refunds, reconciliation, csv, nextjs, vitest]
requires:
  - phase: 08-finance-reconciliation-dashboards-reporting-exports
    plan: "05"
    provides: Immutable scoped refund export request and CSV contract
provides:
  - Permission-gated refund export control in the reconciliation workspace
  - Strict server action bound to the reconciliation-refunds dataset
affects: [08-10-phase-verification]
actuals:
  tokens: 2300
  tasks: 1
  commits: 0
tech-stack:
  added: []
  patterns:
    - Presentation capability is derived from current grants while the action reauthorizes transactionally
key-files:
  created:
    - tests/reconciliation-export-action.test.ts
  modified:
    - src/app/staff/reconciliation/ReconciliationWorkspace.tsx
    - src/app/staff/reconciliation/actions.ts
    - src/app/staff/reconciliation/page.tsx
    - tests/components/ReconciliationWorkspace.test.tsx
key-decisions:
  - Keep refund transaction status separate from reconciliation case status; the export dialog has its own refund status selection.
  - Pass only provider, currency, date and refund status filters to the fixed server-owned refund dataset.
requirements-completed: [PAY-06, RPT-02, RPT-03]
coverage:
  - id: D1
    description: Provider-filtered refund CSV request and current capability control
    requirement: PAY-06
    verification:
      - kind: automated_ui
        ref: tests/components/ReconciliationWorkspace.test.tsx
        status: pass
      - kind: integration
        ref: tests/export-service.integration.test.ts
        status: pass
      - kind: unit
        ref: tests/reconciliation-export-action.test.ts
        status: pass
    human_judgment: false
completed: 2026-09-16
status: complete
---

# Phase 08 Plan 12: Refund Reconciliation CSV Entry Point

**Finance staff with current view and export grants can queue a scoped refund CSV from the reconciliation workspace.**

## Accomplishments

- Added a permission-gated control and accessible options dialog that preserves provider, currency, date, refund status, sensitive column choice, and operational reason after a failed request.
- Added a strict action that fixes `reconciliation-refunds` on the server, rejects forged scope/rows/dataset fields, and returns only job reference and status.
- Added All, Stripe, Paystack, Manual, queued-success and failure-retention component coverage. Existing real-PostgreSQL export tests cover exact provider-specific snapshot/CSV parity.

## Verification

- Reconciliation component suite: 15 passed after the new cases failed against the missing feature.
- Reconciliation export action suite: 2 passed.
- Report scope suite: 17 passed. Export service integration suite: 9 passed against disposable PostgreSQL during Plan 08-05 verification.
- TypeScript, owned-file ESLint and whitespace checks passed.

## Deviations from Plan

- `src/app/staff/reconciliation/page.tsx` was updated to derive conservative server-side capability hints. The action remains the authoritative authorization boundary.
- The existing workspace `status` URL parameter represents a reconciliation case status, so the dialog uses a separate refund status selection for refund rows.
- No commits were created under the user's project-specific review instruction.

## Self-Check: PASSED

The action, control, permission hint, tests, and this summary are present. No synchronous file bytes, storage key, or signed URL enters the action result.
