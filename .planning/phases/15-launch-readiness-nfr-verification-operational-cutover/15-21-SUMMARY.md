---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 21
subsystem: privacy
tags: [nfr-11, nfr-13, d-12, privacy-export, export-pipeline, privacy-manage, audit, licence]
status: complete

requires:
  - phase: 15-16
    provides: privacy.manage permission, User.anonymisedAt, the shared refusal rules
  - phase: 15-04
    provides: audit-coverage guard (REQUIRED_AUDIT_ACTIONS) and request correlation ids
  - phase: 15-01
    provides: 15-DECISIONS.md privacy decision (option-a, privacy.manage, export is continuity)
provides:
  - "Export dataset learner-subject in EXPORT_DATASET_REGISTRY (permission privacy.manage, Global, filter { userId } only, standalone)"
  - "privacy-export-service.ts: LEARNER_EXPORT_SECTIONS, learnerSubjectProducer, createPrivacyExportService, privacyExportService.requestLearnerExport({ userId, reason }) and getLearnerExportStatus({ userId })"
  - "Audit action privacy.learner_export_requested, required by tests/audit-coverage.test.ts"
  - "Licence registry entry plus the fourth reviewed continuity override (privacy.manage in privacy-export-service.ts, reason 'LIC-08 permitted data access')"
  - "tests/privacy-export.integration.test.ts (24 cases against real Postgres)"
affects: [15-22 staff privacy screens, 15-31 launch checklist]

requirements-completed: []

actuals:
  tokens: 21000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "A new export dataset is a registry entry plus a trusted producer registered in the exportService singleton; no new job system"
    - "ExportDefinition.standalone: the dataset's own permission is the only grant needed (no reports.export, no users.view) at request, retry, list and download time"
    - "Pipeline idempotency key derived from learner + the actor's latest job for them: simultaneous first clicks converge on one job, a later request gets a new one"
    - "export-service imports the producer from privacy-export-service; the reverse direction is a lazy dynamic import, so there is no runtime cycle"

key-files:
  created:
    - src/server/services/privacy-export-service.ts
    - tests/privacy-export.integration.test.ts
  modified:
    - src/server/services/report-registry.ts
    - src/server/services/export-service.ts
    - src/server/services/export-read-service.ts
    - src/app/staff/reports/actions.ts
    - src/server/licence/registry.ts
    - tests/audit-coverage.test.ts
    - tests/report-registry.test.ts
    - tests/licence-enforcement-boundary.test.ts

key-decisions:
  - "Owner decision applied exactly (15-DECISIONS.md, option-a): the export is gated by privacy.manage at Global scope and is licence continuity (ledger P-02, P-03)"
  - "privacy.manage alone is enough for this dataset: a standalone flag in the dataset definition drops the generic reports.export and users.view requirements, at request time, in the export history list and on the download route, which still rechecks the permission"
  - "The staff-facing generic report export action refuses learner-subject, so the only way to request it is the privacy service (target check, reason check, audit row)"
  - "Excluded as staff-only or internal: INTERNAL and INTERNAL_NOTE ticket messages, staff names and emails (staff replies read 'Support team'), draft grades, grader ids, storage keys, provider payloads, and free-text staff reasons the learner never saw (enrolment reason, payment reason, refund reason, attendance note)"

duration: about 2 h wall clock (most of it Docker and Testcontainers waits)
completed: 2026-10-09
---

# Phase 15 Plan 21: Learner Data Export (D-12, NFR-11, NFR-13) Summary

**Staff holding the Global-only `privacy.manage` permission can prepare one learner's data as a single long-format CSV through the existing ExportJob pipeline (Queued, Processing, Succeeded, Failed with retry, Expired); the file holds that learner's records only, no secret and no staff-only note, and the request still works in licence restricted mode.**

## Accomplishments

- **Dataset.** `learner-subject` is in `EXPORT_DATASET_REGISTRY`: permission `privacy.manage`, scope policy GLOBAL, strict filter `{ userId }` (one learner, no bulk mode). Columns: section, recordType, recordId, field, recordedAt as safe columns and `value` as the sensitive column, so a reason is always required and stored as the job's `sensitiveReason`.
- **Producer.** `learnerSubjectProducer` runs inside the pipeline's request transaction and re-checks the target itself (staff flag, any role assignment, anonymised, unknown id all give `LearnerExportNotFoundError`), then reads 12 sections with explicit `select`s: profile, consent, enrolments, orders, payment-attempts, refunds, attendance, submissions, grades (RELEASED only), certificates, support (learner-visible messages), email-preferences.
- **Service.** `requestLearnerExport({ userId, reason })` trims the reason (10 to 2000 characters), refuses staff, unknown and anonymised targets with the same not-found error, returns the actor's existing Queued or Processing job for that learner instead of creating another, otherwise calls `exportService.requestExport` and writes one `privacy.learner_export_requested` audit row (actor, target, reason, outcome, correlationId, GLOBAL scope, job id). `getLearnerExportStatus({ userId })` returns the S3 states (none, queued, processing, succeeded with expiry and download path, failed with `canRetry`, expired) and treats a succeeded job past its expiry as expired.
- **Licence.** `privacy-export-service.ts` is registered as `withPermission`. It has one permission call site carrying `{ licence: "continuity", reason: "LIC-08 permitted data access" }`, so request and status read keep working in restricted mode while anonymise (write) stays blocked. The fourth reviewed exception was added to the pinned list in `tests/licence-enforcement-boundary.test.ts` and to `CONTINUITY_TAG_SNAPSHOT`.
- **Pipeline changes (small, shared).** `export-service.ts` registers the producer in the singleton, will not fall back to the report producer for `learner-subject`, refuses to rerun an expired learner export (it must be re-requested from the privacy record) and refuses to retry a failed learner export once the learner has been anonymised (the frozen rows still hold their old data). `export-read-service.ts` applies the `standalone` rule to the download and history access check.

## Task Commits

None. The owner commits explicitly; everything is left uncommitted and nothing is staged.

1. Task 1 (tracer): registry entry, profile-capable producer, service, singleton registration, licence registry entry, integration test. Tracer gate: the request, worker run and CSV read passed end to end before expansion (all 24 cases passed on the first full run).
2. Task 2: all sections, exclusions, refusals, states, idempotency, retry, audit and licence cases; audit-coverage and registry test updates.

## Verification run (this session)

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` on all touched source and test files | clean |
| `npx vitest run tests/privacy-export.integration.test.ts --no-file-parallelism` | 24 passed |
| `npx vitest run tests/export-worker.integration.test.ts tests/export-service.integration.test.ts --no-file-parallelism` | 2 files, 15 passed |
| `npx vitest run tests/audit-coverage.test.ts tests/report-registry.test.ts --testTimeout=60000` | 2 files, 22 passed |
| `npx vitest run tests/licence-enforcement-boundary.test.ts --testTimeout=60000` | 41 passed (first run failed on the new override, see Deviations) |
| `npx vitest run tests/audit-export-service.test.ts tests/audit-export-action.test.ts tests/export-download-route.test.ts tests/export-access-data-permission.test.ts tests/reconciliation-export-action.test.ts` | 5 files passed |
| `npx vitest run tests/phase8-invariants.test.ts tests/report-client-boundary.test.ts tests/licence-action-refusal.test.ts tests/support-report.test.ts tests/privacy-no-hard-delete.test.ts tests/components/Reports.test.tsx` | 6 files passed |
| `npx vitest run tests/ticket-phase-invariants.test.ts` | 1 failed, unrelated and pre-existing (see Issues) |

What the integration test proves: the file has rows for every section for a richly seeded learner and nothing else; a second learner seeded with the same cohort, order shapes and tickets contributes no id, name, email, reference or message to the CSV text, and every row's record id belongs to the first learner; no password hash, session or verification token hash, storage key, provider secret, IP address, INTERNAL note body, staff name or staff email is in the text, and no CSV cell equals a seeded hash or the internal body; staff replies read "Support team" and the learner's own messages "Learner"; the DRAFT grade and its feedback are absent; staff free-text notes are absent. Refusals: staff, role-holder, unknown, anonymised and empty-id targets all give the same not-found error and create no job and no audit row; reasons of 0, 3, 9 characters (also padded with spaces) are refused and exactly 10 is accepted; the pipeline refuses a staff or anonymised target even when called directly, and refuses a request with no reason. States: Queued, Processing and open-job reuse return the same job id, a finished job allows a new one, two simultaneous first requests end with one job, and the status function reports none, queued, processing, succeeded (expiry 24 hours after completion and the download path), expired before and after the sweep, and failed (retryable). A failed job is retried through the existing `retryExport` and reaches SUCCEEDED; the failure text carries no storage error. Retry after anonymisation and rerun of an expired learner export are refused. Audit: one row per request with all required fields, the reason also on the pipeline's own `export.requested` row, no email or name in the audit text, and a repeat request writes its own row marked reused. Authorization: no privacy.manage (or only a narrower scope) is denied with an `authorization.denied` row and nothing queued; a stored role with reports.export and users.view but no privacy.manage is refused by the pipeline; the download access check passes with privacy.manage alone, fails without it, and fails for another person. Licence: once restricted, anonymise is refused with `LicenceRestrictedError` while the export request, status read and worker still succeed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The pipeline demanded reports.export and users.view**
- **Found during:** Task 1 design (reading `authorize` in export-service.ts and `canAccessExportJob`)
- **Issue:** Every non-audit dataset needs `reports.export` and, because `value` is a sensitive column, `users.view` at request and download time. The decision says `privacy.manage` alone gates the tool, so a privacy officer would have been unable to export without two unrelated grants.
- **Fix:** Added an optional `standalone: true` flag to `ExportDefinition`, set only on `learner-subject`. `authorize` (export-service.ts) and `canAccessExportJob` (export-read-service.ts) skip the generic export and identity requirements for standalone datasets and still require the dataset's own permission, GLOBAL scope and the stored-scope cover rules. A registry test pins that only `learner-subject` is standalone.
- **Files modified:** src/server/services/report-registry.ts, export-service.ts, export-read-service.ts, tests/report-registry.test.ts

**2. [Rule 2 - Missing critical] The generic export action could request the dataset**
- **Found during:** Task 1 (reading `requestReportExportAction`)
- **Issue:** The browser-facing action accepts any registered dataset, so a `privacy.manage` holder could have bypassed the reason rule, the target check and the audit row.
- **Fix:** `requestReportExportAction` refuses `learner-subject`; `permittedSensitiveColumnsAction` returns nothing for it; the producer re-checks the target itself; `rerunExpiredExport` and `retryExport` have the guards listed above.
- **Files modified:** src/app/staff/reports/actions.ts, src/server/services/export-service.ts

**3. [Rule 3 - Blocking] Licence boundary pins one override per file and permission, and requires continuity**
- **Found during:** Task 1 verification (`licence-enforcement-boundary.test.ts` failed: two found `privacy.manage` exceptions, one of them a `read` override)
- **Issue:** The first design had two permission call sites (request with a continuity override, status with a read override). The boundary test accepts exactly one reviewed continuity exception per file and permission.
- **Fix:** One call site with a small operation union (`request` or `status`) carrying the continuity override; added the pair to `CONTINUITY_TAG_SNAPSHOT` (src/server/licence/registry.ts) and to the hard-coded reviewed list in the boundary test (now four exceptions), plus two effective-effect assertions. The status read is therefore also continuity, which is what LIC-08 asks for.
- **Files modified:** src/server/services/privacy-export-service.ts, src/server/licence/registry.ts, tests/licence-enforcement-boundary.test.ts

**4. [Plan wording] Column order**
- The plan lists the columns as (section, recordType, recordId, field, value, recordedAt). The export pipeline writes columns in registry order (safe columns, then sensitive columns) and the registry test requires every sensitive column to carry the `users.view` flag, so the CSV header is Section, Record type, Record, Field, Recorded at, Value. All six fields are present; only `value` and `recordedAt` are swapped.

**5. [Plan wording] Phone cell**
- The shared CSV writer prefixes an apostrophe to any cell starting with `+`, `-`, `=` or `@`, so a phone number reads `'+2348012345678` in the file. This is the existing spreadsheet-formula protection, left alone; the test asserts it.

**Total deviations:** 3 auto-fixed, 2 wording notes, no architectural change and no schema change.

## Issues Encountered

- `tests/ticket-phase-invariants.test.ts` fails at line 104 (it expects the support link text inside `src/app/(learner)/layout.tsx`, which now renders `LearnerShell nav={LEARNER_NAV}`). That layout is unmodified in the working tree, so it predates this plan; logged in `deferred-items.md`.
- The first run of `licence-enforcement-boundary.test.ts` failed on the two-call-site design (Deviation 3) and passes now.
- Docker and Testcontainers started cleanly each time; no containers of mine were left behind (the Ryuk reaper container exited with the runs; only the local `learning-management-system-postgres-1` is running, as before).

## Threat Flags

None beyond the plan's register. T-15-21-01 to 05 are mitigated and tested as above. Residual notes: the audit row for a request is written in a second transaction right after the pipeline's own transaction (the pipeline already writes `export.requested` with the reason inside its transaction, so a request is never unaudited); the file exists for 24 hours after completion (the pipeline's existing lifetime) and each download link is 60 seconds.

## Neon go-live list

No new migration in this plan (no schema change). Plan 15-16's items still apply: migration `20261007120000_user_anonymisation`, and re-run the seed or add `privacy.manage` to the Administrator role so someone can use the export.

## Observations for the owner

- **Who can export:** only a role holding `privacy.manage` at Global scope. `reports.export` and `users.view` are neither needed nor sufficient. The downloader must be the person who requested the file and must still hold the permission when they download.
- **Not in the file (a choice to confirm):** staff free-text reasons and notes on enrolments, payments, refunds and attendance, plus ticket attachments and uploaded submission files. The file lists submission file names, sizes and receipt ids but not the files. If a learner's access request should include those, that is a decision for the launch checklist (plan 15-31).
- **Order amounts** are in minor units (kobo or cents) with the currency alongside, as in every other export.
- **Plan 15-22** should call `privacyExportService.requestLearnerExport` and `getLearnerExportStatus`, catch `LearnerExportNotFoundError` (show the standard 404) and `LearnerExportReasonError` (show its message), and use `exportService.retryExport(jobId)` for the "Retry export" button.

## Tracking

- `requirements.ready-ids` results are in the final report; REQUIREMENTS.md was only marked for IDs reported ready.
- State commands run as listed in the final report; nothing was hand-edited in STATE.md.

## Self-Check: PASSED

- Created files exist: src/server/services/privacy-export-service.ts, tests/privacy-export.integration.test.ts (checked on disk).
- Acceptance criteria: report-registry.ts contains the dataset id "learner-subject"; export-service.ts registers `learnerSubjectProducer` in the singleton; the existing export worker integration test still passes (and so does the export service integration test); the integration test asserts the second learner's email and name are absent from the CSV text; it asserts no CSV cell equals or contains a seeded INTERNAL message body or a seeded password hash; `audit-coverage.test.ts` lists `privacy.learner_export_requested`; `registry.ts` contains `privacy-export-service.ts`; all listed test commands exit 0 except the unrelated pre-existing failure logged in deferred-items.md.
- No commits were made and nothing is staged.
