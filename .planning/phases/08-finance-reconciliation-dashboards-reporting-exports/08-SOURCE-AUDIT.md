# Phase 8 Multi-Source Coverage Audit

| SOURCE | ID | Feature / constraint | Plan | Status | Notes |
|---|---|---|---|---|---|
| GOAL | — | Trusted, provider-reconciled, correctly scoped, exportable Finance/Operations numbers | 01–12 | COVERED | Reconciliation, reports, exports, audit, production dispatch and final trust gates. |
| REQ | PAY-06 | Payment/refund reconciliation view/export; totals equal rows; provider/manual distinction; permission protection | 01,02,04,05,10,12 | COVERED | Durable payment/refund subjects plus provider-filtered refund rows, UI entry point, and CSV parity. |
| REQ | PAY-12 | Complete Finance payment projection and safe exception context | 01,02,04,10 | COVERED | Integer minor units and expected/actual/not-applicable semantics. |
| REQ | RPT-01 | Ten fixed dashboards with definitions, filters, refresh and states | 03,04,10 | COVERED | Four authoritative and six explicit unavailable datasets. |
| REQ | RPT-02 | Scope protects aggregates, rows, filters, IDs, exports and downloads | 01–05,08–10,12 | COVERED | Pre-query grant predicates and current download reauthorization. |
| REQ | RPT-03 | Stable CSV, metadata and row-level reconciliation | 05,07,09,10,12 | COVERED | One registry/query/snapshot/serializer seam. |
| REQ | RPT-04 | Async lifecycle, safe retry, history and short-lived download | 05–08,10,11 | COVERED | Immutable jobs, concurrent worker, production dispatch, expiry and download route. |
| REQ | RPT-05 | Filtered append-only redacted audit view/export | 09,10 | COVERED | Dual global permission and redaction tests. |
| RESEARCH | R-01 | Current case plus append-only event ledger and evidence fingerprint | 01,02 | COVERED | Includes concurrent reopening. |
| RESEARCH | R-02 | One normalized typed report registry/query contract | 03,04,05,09 | COVERED | Metadata-only registry plus server-only trusted producer API is used by hub, dashboards, ordinary/refund snapshots and audit snapshots. |
| RESEARCH | R-03 | Collection-aware authorization before every query branch | 03,04,05,08 | COVERED | Covers scope unions and inference resistance. |
| RESEARCH | R-04 | Immutable request-time row materialization with measured safe bound | 05 | COVERED | Worker never requeries mutable rows; 25,000-row/25-MiB/10-second boundary is load-tested and fails atomically when exceeded. |
| RESEARCH | R-05 | Idempotent `SKIP LOCKED` background claim and stale recovery | 07 | COVERED | Conditional terminal effects. |
| RESEARCH | R-06 | Private managed streaming upload and current authorization download | 06–08 | COVERED | SUS package gate and no-store short presign. |
| RESEARCH | R-07 | Central spreadsheet-formula-safe serializer | 05 | COVERED | Adversarial cells and stable columns. |
| RESEARCH | R-08 | Netlify authenticated scheduled dispatch, background generation, and scheduled expiry | 11 | COVERED | DB is authoritative; one-minute dispatcher sends a constant authenticated request and public callers cannot inject instructions. |
| RESEARCH | R-09 | Safe global audit export with correlation/redaction | 09 | COVERED | Append-only evidence preserved. |
| CONTEXT | D-01–D-10 | Reconciliation workspace/lifecycle decisions | 01,02 | COVERED | Decision gate reports 10/10; D-07 includes permission-gated payment/refund/enrolment corrective navigation and correlated operational history without case-resolution side effects. |
| CONTEXT | D-11–D-14 | Operational dashboard decisions | 03,04 | COVERED | Decision gate reports 4/4. |
| CONTEXT | D-15–D-18 | CSV export journey decisions | 05,07–09,11,12 | COVERED | Decision gate reports 4/4. |
| CONTEXT | D-19–D-24 | Reporting/trust rules | 01,03–05,07–12 | COVERED | Decision gate reports 6/6. |

Deferred ideas in `08-CONTEXT.md` are intentionally excluded. No source item is missing.
