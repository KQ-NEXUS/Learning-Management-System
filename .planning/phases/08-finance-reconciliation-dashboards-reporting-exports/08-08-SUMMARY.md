# 08-08 — Export History and authorized downloads

Status: implemented and locally verified, uncommitted for review.

## Delivered

- Export History lists only jobs requested by the current actor whose dataset, export, scope, and sensitive identity grants still cover the frozen snapshot. The client projection omits storage keys and signed URLs. It shows frozen filters, columns, as-of, version, row count, lifecycle, expiry, and retry lineage.
- URL-backed dataset, status, requested date, reference, and page filters; stable newest-first pages; manual Refresh status; desktop table and mobile cards; empty, loading, error, pending count, failed, and expired states.
- Retry and rerun actions preserve the old job, reauthorize through the export service, and give queued feedback without discarding filters or choices.
- A promised-param Route Handler checks current ownership and grants, successful/unexpired state, then records authorization before minting a short-lived CSV URL. All unavailable cases return one private, no-store `404` recovery response; success is a private, no-store `302`.

## Verification

- `tests/export-download-route.test.ts` and `tests/components/ExportHistory.test.tsx`: 21 passed, including revoked grants, ownership, sensitive permission, exact expiry, no-store redirect, mobile parity, and pagination.
- TypeScript and owned-file ESLint: passed.
- `git diff --check`: passed (Git emitted only a line-ending normalization warning for an existing audit page).

The deployed storage redirect and 24-hour expiry walkthrough remains manual. No commits were created.
