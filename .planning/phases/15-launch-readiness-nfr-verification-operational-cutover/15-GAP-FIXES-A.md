# Phase 15 gap fixes, batch A

Requested by the owner on 2026-10-11 ("fix all the gaps"). **Nothing here is committed**; every change is in the working tree. No hosted database or storage was contacted and no `.env` file was read by hand: tests ran on Testcontainers Postgres and a throwaway local MinIO, the build on a throwaway local Postgres.

| Item | Status |
| --- | --- |
| G-01 reconciliation case page, order without a correlation id | fixed, tested |
| G-02 storage key or secret missing | fixed, tested |
| G-03 export object key | fixed, tested; no migration was needed |
| G-06 staff grant end instant | fixed, tested |
| W-15 certificate download audit row | fixed, tested; one narrower case remains (below) |
| D-07 CI | changed and guarded by a test; not proven until CI runs on a pushed commit |
| B-06, B-11 runbooks | done |

Verification results are in the last section. Items still open for the owner are listed under "For the owner".

## G-01 Reconciliation case page failed for an order with no correlation id

- Cause: in `getCaseDetail` the audit-history query sent the order's correlation id as an untyped parameter inside `... IS NOT NULL`. When the value is null Postgres cannot work out its type and refuses the query (42P18).
- Change: `src/server/services/reconciliation-case-service.ts`, one line: `CAST(${row.orderCorrelationId} AS text) IS NOT NULL`.
- Test: `tests/reconciliation-case.integration.test.ts`, new case "opens a case whose order has no correlation id and matches its history by target only". The seeding helper can now make an order with no correlation id. The case was run before the fix and failed with 42P18, then passed. It also checks that an unrelated audit row that has no correlation id either is not pulled into the history ("no id" is never read as "the same id").
- Result: 5 of 5.
- Not done: the accessibility sweep's fixture still gives its case order a correlation id. That workaround is no longer needed and was left alone.

## G-02 Storage client signed with an empty key

- Change: `src/server/services/storage-service.ts`.
  - `makeClient` throws `S3_ACCESS_KEY_ID is not configured.` or `S3_SECRET_ACCESS_KEY is not configured.` when the value is missing, empty or only spaces (same wording as `S3_BUCKET is not configured.`). The error never contains a value.
  - The two clients (`s3`, `presignClient`) were module constants built at import. They are now functions that build the client on first use and keep it. A refused attempt is not kept, so the next call checks again. Importing the module with no storage variable still works, which the build and most tests rely on.
  - `requestChecksumCalculation` and `responseChecksumValidation` are unchanged (G-08).
- Tests: `tests/storage-credentials.test.ts` (new, 12 cases): import with nothing set; key missing, empty, blank; secret missing, empty, blank; a download link and a server-side call refuse the same way; the separate public-endpoint client refuses too; the secret is not in the error; a link is signed with the configured key id; the call works once the value is set.
- Two existing unit tests call storage functions with a mocked SDK and no key: `tests/certificate-storage-service.test.ts` and `tests/storage-upload-service.test.ts`. They failed with the new named error (8 cases), as intended, and now set placeholder values. `tests/export-storage.test.ts` sets the same placeholders.
- Result: `storage-credentials` 12 of 12, `storage-presign-checksum` 2 of 2 (unchanged file).
- Honest note on test-first: the tests were written before the code, but for this item and G-03 the code was written before the tests were first run, so I did not watch them fail. The eight failures in the two existing files are the red I did see.

## G-03 Export files were stored under a guessable path

- Checked first: `ExportJob.storageKey` already exists (nullable string). **No Prisma migration was added and the go-live list is unchanged.**
- Change:
  - `src/server/services/storage-service.ts`: `buildExportStorageKey(jobId)` returns `exports/<jobId>/<random UUID v4>`. It is no longer stable between calls. The accepted key pattern allows the new shape and the old one (`exports/<jobId>/<version>.csv`), so files made before the change stay downloadable and deletable until they expire; nothing else is accepted.
  - `src/server/services/export-worker-service.ts`: `claimQueued` mints the key and stores it with `COALESCE("storageKey", <new key>)` in the same statement that marks the job PROCESSING. A stale claim that is put back in the queue keeps the key it has, so the retry overwrites the same object. `processOne` uploads to the stored key and fails the job if there is none.
- Does a key on a job that is not finished open anything? No. Every reader asks for `status = SUCCEEDED` as well as a key: `export-download-service.ts`, `export-read-service.ts`, `privacy-export-service.ts`, and the expiry sweep. A failed job still has its key cleared.
- Tests:
  - `tests/export-worker.integration.test.ts`: 5 new cases (key minted and stored at claim, before any upload; upload goes to the stored key; a stale claim retried twenty minutes later reuses the key and leaves one object; a job claimed before keys were stored gets one on retry; a failed job loses its key and the staff retry, a new job, gets its own). The failure injection no longer names the key, because a test cannot know it in advance. 10 of 10.
  - `tests/storage-keys.test.ts`: the export builder moved into the table of minting builders (ends in a UUID v4, different on every call, no extension); the "one deterministic builder" exception is gone. 34 of 34.
  - `tests/export-storage.test.ts`: random key; new and old shapes accepted; five malformed keys refused by upload, presign and delete. 4 of 4.
  - `tests/authz-private-files.integration.test.ts` records the builder in `evidence/private-files-local.json`, which now reads `exports/<id>/<uuid-v4>`, `endsInUuidV4: true` (regenerated by the run).

## G-06 A staff grant still held at its exact end instant

- The written rule, quoted:
  - `15-26-PLAN.md`, must-have truth: "a grant whose end instant equals the request time is treated as ended".
  - `15-26-PLAN.md`, behaviour: "A grant whose end equals the request instant is treated as ended."
  - `02-02-PLAN.md` (the continuity query): "the start window to either a null `startsAt` or one at or before `now`, the end window to either a null `endsAt` or one after `now`".
  - The documents say exclusive end, inclusive start. The text that says "inclusive" (`13-11-SUMMARY.md`, and the 15-26 line in `STATE.md`) describes what the code did, not a rule.
- What the code did: four places already ended a grant at its end instant (`continuity-service.ts`, `role-service.ts`, `ticket-staff-queue-service.ts`, the reconciliation list query). Two did not: `isGrantActive` and the email recipient SQL that copies it.
- Change:
  - `src/server/permissions/scope.ts`: `endsAt <= now` ends a grant. The window is `[startsAt, endsAt)`. The start check is untouched.
  - `src/server/services/staff-recipient-service.ts`: `a."endsAt" > at` (was `>=`), so the drain cannot alert a person whose grant has just ended.
- Tests:
  - `tests/scope.test.ts`: 6 new edge cases (one millisecond before, at, and after the end; one millisecond before and at the start; a window that starts and ends at the same instant is never in force). Two failed before the change. 25 of 25.
  - `tests/authz-revocation.integration.test.ts`: the end-instant case now expects "refused" at the exact instant; the start case still expects "ran" at the start instant. 15 of 15.
  - `tests/staff-recipient-service.test.ts`: the old boundary case could not reach the exact instant. The new one uses the fixed-clock resolver and checks the SQL and `isGrantActive` against each other at five instants. 4 of 4.
- Left alone: `.planning/STATE.md` still carries the 15-26 decision line "grant end instant is inclusive". I was told not to touch state; it is now out of date.

## W-15 A learner's own certificate download was logged as a denial

- Cause: the route asked for the staff permission first. That check records `authorization.denied` when it refuses, and it refuses every learner.
- Change: `src/app/api/certificates/[id]/download/route.ts` tries the owner path first (`getOwnCertificateForDownload`, which audits nothing) and asks for the staff permission only when the owner path returns nothing. Both checks are the same functions as before; only the order changed. Who is served is unchanged, and every refusal is still the same empty 404.
- Not weakened: a stranger, staff scoped to another cohort, staff with no permission and a visitor still go through the staff check and still leave their denial row. I did not use the non-auditing `can` probe, because that would have removed those rows as well.
- Remaining case: the owner of a REVOKED certificate is refused by the owner path, falls through to the staff check and leaves one denial row per attempt. The matrix case for it keeps its `staffProbeDenial` flag (its wording was updated). Removing that row too would mean a second ownership lookup that ignores status; it is small, and I left it for a decision.
- Tests:
  - `tests/certificate-download-route.test.ts`: owner flows no longer queue a staff refusal; new cases prove the staff check is not called for a served owner, is still called for the three kinds of caller the owner path refuses, that staff can still open a revoked certificate, and that an unexpected error is rethrown. Seven cases failed before the change. 17 of 17.
  - `tests/authz-private-files.integration.test.ts`: 3 new cases on real Postgres and real audit rows (the owner downloads three times and leaves no denial row; another learner, staff with no permission and staff scoped elsewhere each leave exactly one; global staff are served with none). 40 of 40.

## D-07 CI

- (a) Object store. `.github/workflows/ci.yml`, integration job: two steps before the tests. "Start local object storage" runs the MinIO image pinned by the same sha256 digest as `e2e-nightly.yml`, published on `127.0.0.1:9000` only, with the placeholder key and secret the storage tests set for themselves and the `lms-private` bucket (a folder that exists under `/data` at start is a bucket). "Wait for object storage" polls the health address. No repository secret is read. I started the pinned image the same way locally: the bucket existed, a signed write and read worked, and an unsigned read answered 403.
- (b) Unit job selection. The command-line `--exclude` never applied: with `projects`, it does not reach a project's own file selection (`vitest list` showed all 85 integration files still selected). `vitest.config.mts` now adds `tests/**/*.integration.test.ts` to the node project's exclude when `VITEST_SKIP_INTEGRATION=1`, and the unit job sets it. Checked with `vitest list`: with the switch, 288 files and no integration file; the integration job's own command still selects all 85.
- (c) `tests/ticket-phase-invariants.test.ts`: the wiring was right and the test was out of date. The learner header links moved into `src/components/shell/learner-nav.ts`. The test now checks the Support link there and that the three learner layouts mount `LEARNER_NAV`. 9 of 9.
- Guard: `tests/ci-config.test.ts` has 5 new cases (the switch at both ends; the object store step; the values match what the storage tests set; two cases that prove the guard fails on a tampered copy). 20 of 20.
- Not proven: whether CI is green. That needs a commit and a push. Two things I saw and did not change, because they were not in the request:
  - the slow tests of checklist row I-06 have no explicit timeout, and the integration job passes no `--testTimeout`;
  - six database-backed files are not named `*.integration.test.ts` and so still run in the unit job, in parallel: `brevo-live.smoke`, `licence-diagnostic`, `reconciliation-case-service`, `schema-cohort`, `schema-payment-split`, `staff-recipient-service`.

## B-06 and B-11 Runbooks

- `docs/runbooks/deployment.md`, step 5 of "Before you deploy": says to run `npx prisma migrate status` against production first, then lists the twelve migrations in the checklist's order, with the same three warnings (restore point before the token hashing migration, the backlog migration before the email sender first runs, the two diagnostic SELECTs before the uniqueness migration).
- `docs/runbooks/restore.md`, Route A step 2: Neon may place the restore point slightly earlier than asked (30 seconds in the rehearsal); record the time the new branch reports.
- Guard: `tests/launch-checklist.test.ts` has one new case that fails when the runbook's list and the checklist's list differ in content or order, or when "status" does not come before the list.

## Documents updated

- `15-LAUNCH-CHECKLIST.md`: rows G-01, G-02, G-03, G-06, G-08, D-07, B-06, B-11, H-08 and W-15, the status line, and one stale phrase in B-04. Owner, Due and Signed cells are untouched.
- `deferred-items.md`: the rows found in 15-19 (reconciliation), 15-21 (ticket invariants), 15-26 (certificate denial row) and 15-30 (`makeClient`).
- `evidence/private-files-local.json`: regenerated by the test run (export key shape).

- `evidence/authz-scope-state-local.json`: regenerated by the test run. One entry differs from the committed file and it is not from this batch: the attendance exceptions CSV route answers a wrongly scoped staff member with 404 where the file said 403. Plan 15-27 changed that route to the empty 404 after the file was last written; the file was out of date.

## Verification

All on this machine, 2026-10-11. Integration files ran one at a time in batches of at most six, on Testcontainers Postgres, with a throwaway MinIO container on the loopback address for the storage files.

| What | Result |
| --- | --- |
| `tests/reconciliation-case.integration.test.ts` | 5 of 5 (the new case failed with 42P18 before the fix) |
| `tests/export-worker.integration.test.ts` | 10 of 10 |
| `tests/staff-recipient-service.test.ts`, `tests/authz-revocation.integration.test.ts` | 4 of 4 and 15 of 15 |
| `tests/authz-private-files.integration.test.ts`, `tests/submission-service.integration.test.ts` | 40 of 40 and 11 of 11 |
| `tests/certificate-download.integration.test.ts`, `tests/certificate-unicode-file.integration.test.ts` | 6 of 6 and 12 of 12 when run on their own. In the first run, four files in a row on a loaded machine (928 seconds), one case in each failed: the certificate row had no file yet because producing it took longer than the 6-second wait after issuing. Not caused by this batch, but it is a timing weakness CI could hit |
| `tests/authz-inventory.test.ts` | 18 of 18 |
| `tests/authz-bypass.integration.test.ts`, `tests/authz-bypass-payments.integration.test.ts` | 775 of 775 and 19 of 19 |
| `tests/authz-scope-state.integration.test.ts` | 413 passed, 100 skipped by design (the same numbers as plan 15-26). The first attempt did not start: Docker answered 500 when the container was created, while I was starting another container; it ran clean on its own |
| Six integration files that use storage or exports: `captions`, `captions-authoring`, `learner-results`, `privacy-export`, `ticket-access`, `ticket-attachment-sweep` | 64 of 64 |
| Six more: `learner-journey`, `certificate-concurrency`, `certificate-lifecycle-guards`, `privacy-read-service`, `ops-status-service` (integration) and `reconciliation-case-service` | 52 of 52 |
| Unit, changed files: `scope`, `storage-credentials`, `storage-keys`, `export-storage`, `storage-presign-checksum`, `certificate-download-route` | 94 of 94 |
| Unit, changed files and guards: `ci-config`, `ticket-phase-invariants`, `launch-checklist`, `runbooks`, `phase8-invariants`, `lesson-resource-routes` | 134 of 134 |
| Unit, modules that use storage (22 files in four batches) | 106, 94, 157 and 150 cases. The first batch had the 8 expected failures described under G-02; the two files passed in the second batch after the placeholder edits |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` on the 23 changed or new code files | 0 errors, 1 warning that was there before (`_id` unused, `tests/certificate-download-route.test.ts` line 17) |
| `npm run build` (Next.js 16.3.8) with `DATABASE_URL` pointing at a throwaway local Postgres | exit 0, compiled, 52 pages generated |

Not run: the whole suite in one go, the browser journey, and anything against a hosted service. The two containers I started (MinIO and the build database) are removed; `learning-management-system-postgres-1` was left running and was not used.

## For the owner

1. **Nothing is committed.** Review the working tree and say when to commit. D-07 can only be shown green by a CI run on a pushed commit.
2. **W-15, the remaining case.** The owner of a revoked certificate who tries to download it still leaves one "authorization.denied" line per attempt. Say if that line should go too (a small change) or stay (it is a refused request).
3. **G-06 is a behaviour change, small and deliberate:** a staff grant now stops at its end time instead of one millisecond after it, and the email recipient query follows the same rule. `.planning/STATE.md` still records the old decision ("grant end instant is inclusive", plan 15-26); I did not edit state files.
4. **G-03 on deploy:** export files made before the change keep their old paths and keep working until they expire (24 hours). No migration and no clean-up are needed.
5. **G-02 on deploy:** a deployment whose storage key or secret is missing now fails loudly on the first upload or download instead of handing out a link that cannot work. Rows C-02 and C-03 (the Production context in Netlify) are unchanged and still needed.
6. **CI, not asked for and not changed:** the slow tests of row I-06 have no explicit timeout in the integration job; six database-backed test files without `integration` in their name still run in the unit job; and the certificate file tests depend on a 6-second wait that a slow runner can miss.
7. Rows in this batch that still need a named person and a signature: G-01, G-02, G-03, G-06, G-08, D-07, B-06, B-11, H-08. I wrote no name, date or acceptance in any Owner, Due or Signed cell.
