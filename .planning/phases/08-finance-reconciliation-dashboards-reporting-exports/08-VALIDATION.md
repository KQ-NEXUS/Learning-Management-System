---
phase: "08"
slug: "finance-reconciliation-dashboards-reporting-exports"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-15"
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 with Node/jsdom projects; Testcontainers 12.1.0 for PostgreSQL integration |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/<target>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | Targeted checks generally under 30 seconds; full suite timing measured during execution |

---

## Sampling Rate

- **After every task commit:** Run the new or changed targeted test file(s).
- **After every plan wave:** Run all Phase 8 tests plus affected payment, permission/scope, audit, storage, and function-boundary regression tests.
- **Before `$gsd-verify-work`:** Run `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, PostgreSQL/MinIO integration tests, and the deployed background-function smoke test.
- **Max feedback latency:** 30 seconds for targeted task checks; integration/build gates may take longer and belong at wave/phase boundaries.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-W0-01 | 08-01/02/04/05/12 | 1–4 | PAY-06, PAY-12 | V4 | Scoped payment/refund reconciliation totals and provider-filtered refund CSV rows match; provider/manual fields remain honest; permission-gated payment/refund/enrolment corrective links and correlated operational history satisfy D-07 without resolution side effects | integration + component | `npx vitest run tests/reconciliation-case.integration.test.ts tests/reconciliation-case-service.test.ts tests/report-scope.integration.test.ts tests/export-service.integration.test.ts tests/components/ReconciliationWorkspace.test.tsx` | ❌ W0 | ⬜ pending |
| 08-W0-02 | 08-03/04 | 1–2 | RPT-01 | V4 | Fixed definitions expose correct availability, date basis, refresh, empty, and error states | unit + component | `npx vitest run tests/report-registry.test.ts tests/components/Reports.test.tsx` | ❌ W0 | ⬜ pending |
| 08-W0-03 | 08-03/04/05/08/12 | 1–5 | RPT-02 | V4 | Scope applies before aggregates, rows, filters, identifiers, export snapshots, and downloads | integration + route | `npx vitest run tests/report-scope.integration.test.ts tests/export-download-route.test.ts` | ❌ W0 | ⬜ pending |
| 08-W0-04 | 08-03/05/09 | 1–5 | RPT-03 | V5 | Metadata-only registry and server-only trusted producers reject browser rows/scope; stable columns, frozen metadata, row reconciliation, spreadsheet-safe cells, and measured snapshot bounds | unit + integration/load | `npx vitest run tests/report-registry.test.ts tests/csv-service.test.ts tests/export-service.integration.test.ts tests/export-snapshot-load.test.ts tests/audit-export-service.test.ts` | ❌ W0 | ⬜ pending |
| 08-W0-05 | 08-07/08/11 | 4–5 | RPT-04 | V4, V12 | Claim/retry/expiry are idempotent; authenticated scheduled dispatch reaches processing without caller instructions; current authorization gates downloads | integration + function + route | `npx vitest run tests/aws-sdk-lockfile.test.ts tests/export-worker.integration.test.ts tests/netlify-export-functions.test.ts tests/export-download-route.test.ts` | ❌ W0 | ⬜ pending |
| 08-W0-06 | 08-09 | 5 | RPT-05 | V4, V7 | Audit export remains append-only, permission-gated, correlated, and secret-redacted | unit + integration | `npx vitest run tests/audit-export-service.test.ts tests/audit-append-only.integration.test.ts` | ❌/partial W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/reconciliation-case-service.test.ts` and `tests/reconciliation-case.integration.test.ts` — payment/refund lifecycle, payment timeline and corrective links, reopen, assignment, resolution isolation, and provider-filtered refund parity.
- [ ] `tests/report-registry.test.ts` and `tests/report-scope.integration.test.ts` — fixed definitions, availability, scope unions, and totals/rows/filter parity.
- [ ] `tests/csv-service.test.ts` — stable columns and spreadsheet-safe serialization.
- [ ] `tests/export-service.integration.test.ts`, `tests/export-snapshot-load.test.ts`, and `tests/export-worker.integration.test.ts` — immutable snapshot, 25,000-row/25-MiB measured bounds, claim races, retry lineage, expiry, and idempotency.
- [ ] `tests/export-download-route.test.ts` — current authorization, expiry, ownership/scope, and no-store redirect behavior.
- [ ] `tests/audit-export-service.test.ts` — safe/sensitive columns, operational reason, redaction, and correlation.
- [ ] `tests/aws-sdk-lockfile.test.ts` — exact direct/lockfile `@aws-sdk/lib-storage@3.1125.0` plus unchanged sibling AWS dependencies.
- [ ] `tests/netlify-export-functions.test.ts` — one-minute authenticated dispatcher, instruction-resistant Background Function, and expiry boundaries.
- [ ] `tests/components/ReconciliationWorkspace.test.tsx`, `tests/components/Reports.test.tsx`, and `tests/components/ExportHistory.test.tsx` — required UI states and interactions.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deployed asynchronous export completes outside the request lifecycle | RPT-04 | Local/unit tests cannot prove the production Netlify background runtime and deployed storage integration | Request a large scoped export in a deployed test environment, leave the page, return to Export History, observe lifecycle completion, download within 24 hours, and confirm expiry afterward. |
| Finance workspace and reports remain understandable across desktop and mobile | PAY-06, RPT-01 | Visual hierarchy and responsive usability require human inspection | Exercise exception tabs/detail/resolution and all Reports hub states at desktop and mobile widths with representative data. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verification or explicit Wave 0 dependencies.
- [ ] Sampling continuity: no three consecutive implementation tasks without an automated check.
- [ ] Wave 0 covers every currently missing test reference.
- [ ] No watch-mode flags appear in verification commands.
- [ ] Targeted feedback latency remains under 30 seconds where practical.
- [ ] `nyquist_compliant: true` is set after test references exist and the map is assigned to concrete plans/tasks.

**Approval:** pending
