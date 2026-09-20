# 08-09 — Audit CSV export

Status: implemented and locally verified, uncommitted for review.

## Delivered

- The metadata-only audit export definition now offers actor/action/target/outcome/time/correlation and changed-field context. Context contains field names only; arbitrary before/after values, credential-shaped keys, raw payloads, stacks, and storage keys are excluded.
- The request service fixes the dataset to `audit`, uses the export service's frozen transaction and global `audit.view` plus `audit.export` authorization, and requires global `users.view` and an operational reason for actor name/email columns.
- The audit page exposes `Export audit CSV` only with current global grants. Its dialog uses current actor/action/date filters, defaults to safe columns, preserves sensitive choices/reason on failure, and links queued requests to Export History.
- Request audit records now include normalized filters and a correlation ID. Existing audit evidence is read, not changed.

## Verification

- `tests/audit-export-service.test.ts`: 3 passed.
- `tests/audit-append-only.integration.test.ts`: 1 passed against disposable PostgreSQL, including dual grant denial, redacted snapshot, and byte-identical source event.
- `tests/components/audit-table.test.tsx`: 14 passed, 1 pre-existing skipped.
- TypeScript and owned-file ESLint: passed.
- `git diff --check`: passed, with only a line-ending normalization warning.

No commits were created.
