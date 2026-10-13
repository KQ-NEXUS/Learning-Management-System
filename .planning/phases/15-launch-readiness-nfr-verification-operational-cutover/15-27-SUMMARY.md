---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 27
subsystem: private-file-delivery-testing
tags: [nfr-06, private-files, presigned-urls, denial-parity, object-keys, export-expiry, minio]
status: complete

provides:
  - "Attendance exceptions CSV route denies with an empty 404 (was 403) and sends Cache-Control private, no-store, closing ledger P-07"
  - "Denial-parity proof for all 8 private delivery routes on a real Postgres and a real MinIO: no session, another person's file, no permission, wrong scope and an unknown id get the same status and the same body, byte for byte"
  - "Header and lifetime proof: every success carries private, no-store; presigned URLs expire after 60 s (FILE, IMAGE, certificates, submissions, ticket attachments), the export lifetime (default 60, clamped 30 to 120), 14,400 s for VIDEO (ledger P-08)"
  - "Export expiry proof: past expiresAt refused, sweep marks Expired and deletes the object, history shows Expired with no download, re-run creates a new job"
  - "Object store hardening proof: unsigned GET 403, signature for another key 403, expired signature 403, bucket policy not public"
  - "Key unpredictability proof: every minting key builder ends in a random UUID v4; source scan fails if a builder is added unclassified"
  - "Revocation proof: after a cancelled enrolment or a revoked certificate, ten concurrent requests (30 for the enrolment case) all get the denial and none is handed a URL"
  - "Deterministic evidence file evidence/private-files-local.json"

requirements-completed: []

actuals:
  tokens: 16300
  tasks: 3
  commits: 0

key-files:
  created:
    - tests/authz-private-files.integration.test.ts
    - tests/storage-keys.test.ts
    - tests/exceptions-csv-route.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/private-files-local.json
  modified:
    - src/app/staff/cohorts/[id]/exceptions/csv/route.ts
    - tests/support/authz-registry.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/authz-matrix-local.json
---

# Phase 15 Plan 27: Private file delivery proof (headers, TTLs, expiry, keys) Summary

NFR-06 is proven for every private download route on a real database and a real object store; one inconsistency (the attendance exceptions CSV answering 403) was fixed, and one finding about export object keys needs an owner decision (below).

## Result

**No private-file exposure was found.** No public storage URL, no unsigned object access, no permanent report link. Two things for the owner are called out under "Findings".

### What was fixed

- `src/app/staff/cohorts/[id]/exceptions/csv/route.ts`: a refusal (no session, no `attendance.view`, wrong cohort scope) now returns an empty 404 like every other private download, instead of a 403 with a message. The header on a success and a refusal is now `private, no-store` (it was `no-store`), matching the other routes and the plan truth. Tests were written first and failed (5 of 8) before the change.
- `tests/support/authz-registry.ts`: the route's registry entry now lists `[404]` (it said `[403]`, "pinned by plan 15-27"). This is the plan 15-25 matrix reading the new answer; the bypass matrix still passes (794 tests) and `evidence/authz-matrix-local.json` changed in exactly three lines (`HTTP 403` to `HTTP 404` for the CSV route's three refusal personas).

### What is proven (route by route)

All 8 routes are in `evidence/private-files-local.json` with `denialParity: true` and `noStore: true`:

| Route | Refusal | TTL | Expiry |
|---|---|---|---|
| `/api/certificates/[id]/download` | empty 404 | 60 s | store enforces (1 s URL refused after 2.5 s) |
| `/api/lesson-resources/[id]/download` | empty 404 | FILE 60, IMAGE 60, VIDEO 14,400 | store enforces |
| `/api/lesson-resources/[id]/captions` | empty 404 | n/a, served by the app | n/a |
| `/api/submissions/[submissionId]/download` | empty 404 (learner who made it is refused too, it is the grader's route) | 60 s | store enforces |
| `/api/ticket-attachments/[attachmentId]/download` | empty 404 | 60 s | store enforces |
| `/api/staff/reports/exports/[jobId]/download` | one fixed "Download unavailable" page, identical for every cause (see Findings 2) | default 60, clamped 30 to 120 | app checks `expiresAt`, sweep expires |
| `/api/staff/licence/diagnostic` | empty 404 for learner and staff without `licence.view`; 401 for a visitor | n/a | n/a |
| `/staff/cohorts/[id]/exceptions/csv` | empty 404 (now) | n/a | n/a |

Cases per route: no session, another learner, staff with no role, staff scoped to another cohort, the real owner of a record on a route that is not theirs (submission, CSV), an unknown id asked by a permitted caller, an unknown id asked by a stranger. Refusals are compared as `{status, body, Location, Content-Type}` and must be equal, and the location must be absent. Extra cases: an unfinished upload looks like any other refusal to non-permitted callers (a permitted caller learns only 409), a resource in a course the learner is not enrolled in is refused exactly like an unknown id, and a failed, expired and past-expiry export are refused like an unknown job.

Each 302 target was fetched for real from MinIO and returned the stored object with an attachment disposition (the certificate returned the exact stored PDF bytes starting `%PDF`).

### Export expiry (no permanent report links)

A SUCCEEDED export whose `expiresAt` had passed was refused by the route before any sweep. `exportWorkerService.expireBatch` then set it to EXPIRED, cleared `storageKey` and removed the object from MinIO; `exportReadService.list` reported `EXPIRED`, `canDownload: false` (and the history page source carries the "Expired" label and "Rerun export" action); `exportService.rerunExpiredExport` created a different QUEUED job and left the old one EXPIRED.

### Revocation under concurrency (edge probe)

While the enrolment was ACTIVE the learner got a 60 s URL; after the enrolment was set to CANCELLED, 30 concurrent requests (10 FILE downloads, 10 VIDEO downloads, 10 caption reads) all returned the same empty 404 as an unknown id, none with a URL. The URL issued before removal still fetched (it is a bearer link until its 60 s lifetime ends, as designed). The same was done for a revoked certificate (10 concurrent requests, all denied). The per-request authorisation check means there is no window after the commit.

## Verification (run by the executor, no commits)

| Command | Result |
|---|---|
| `npx vitest run tests/exceptions-csv-route.test.ts` | 8 passed (5 failed before the route change) |
| `npx vitest run tests/storage-keys.test.ts` | 33 passed |
| `npx vitest run tests/authz-private-files.integration.test.ts --no-file-parallelism --testTimeout=60000` | 37 passed, about 30 s (Testcontainers Postgres plus a local MinIO started for the run and removed after) |
| evidence check from Task 3 (`node -e ...private-files-local.json`) | exit 0 (`unsignedGetStatus` 403, 8 routes, all `denialParity` and `noStore` true) |
| `npx vitest run tests/exceptions-csv-route.test.ts tests/storage-keys.test.ts tests/authz-inventory.test.ts` | 59 passed (inventory test unaffected by the registry edit) |
| `npx vitest run tests/authz-bypass-payments.integration.test.ts tests/authz-bypass.integration.test.ts --no-file-parallelism` | 794 passed (the 15-25 matrix with the CSV route now expecting 404) |
| `npx eslint` on the new files, the route and the registry | clean |
| `npx tsc --noEmit` | clean |

The acceptance grep (`status: 403` in the CSV route after dropping comment lines) returns 0.

## Findings for the owner

1. **Export object keys are not random UUIDs (decision needed).** `buildExportStorageKey` returns `exports/<export job id>/<dataset version>.csv`. The job id is a database-generated cuid, not a UUID v4; the plan truth asked for a UUID segment in every prefix including exports. I did not change it: the key is deliberately deterministic so a background retry finds the same object, existing tests pin the shape (`tests/export-storage.test.ts`, `tests/export-worker.integration.test.ts`), and fixing it means changing the worker so the key is minted once and stored on the job. What limits the exposure today: the bucket is private (an unsigned GET returns 403, proven), a signed URL is only issued after the requester's grants are rechecked, and only the requester can reach it. The test asserts the export key for what it is and records `randomSegment: "job-id"` in the evidence, so this is visible and not waived silently. If the owner wants the never-waive rule (D-07, "predictable object path") applied strictly, the fix is a small follow-up: mint `exports/<jobId>/<randomUUID>.csv` once, persist it in `ExportJob.storageKey` at claim time, and have the worker reuse it on retry.
2. **The export route's refusal body is a fixed HTML page, not an empty body** (`Download unavailable ... Return to Export History`). It is byte-identical for an unknown id, another person's job, no permission, an expired job and a failed job, names no job id, and has `private, no-store`, so it cannot confirm a file exists; it is the only refusal that is not empty because a person follows this link in a browser. The test asserts identity and absence of ids rather than an empty body for this one route. Say if you want it changed to an empty 404.
3. **VIDEO URLs live 4 hours (14,400 s).** Ledger P-08: the owner accepts this on the launch checklist, or lowers it. It is asserted in the test, so lowering it later will fail the test until the number in the test and `DOWNLOAD_TTL_SECONDS` are changed together.
4. **Production R2 checks stay with the owner (ledger OQ7, launch checklist, plan 15-31):** confirm the production bucket has public access off, no public bucket domain or r2.dev URL enabled, and that object versioning or backup is in place. The local MinIO proof does not cover the hosted bucket's settings.

## Deviations from Plan

**1. [Rule 3 - Blocking] The plan's "iterate ROUTE_REGISTRY entries whose domain is private-file" cannot be literal.** The 15-25 registry has no `private-file` domain (domains are `certificates`, `catalogue`, `grading`, `support`, `reports`, `licence`, `attendance`). The test instead defines the eight routes explicitly, looks each up in `ROUTE_REGISTRY` (and takes the file path from it), asserts each is registered with the expected refusal statuses, and fails if any GET route in the registry shaped like a download (`/download`, `/captions`, `/csv`, licence diagnostic) is not covered. The registry itself was not restructured.

**2. [Rule 3 - Blocking] Files outside the plan list.** `tests/support/authz-registry.ts` (the CSV entry now `[404]`, forced by the route change; plan 15-25 had pre-announced it) and `evidence/authz-matrix-local.json` (regenerated by the matrix run, three lines changed). Both are consequences of the route change.

**3. [Rule 2 - Missing critical functionality] CSV `Cache-Control` raised to `private, no-store`** (the plan truth says successful private downloads carry `private, no-store`; the route sent `no-store` only).

**4. Lesson-resource, caption and certificate fixtures are built locally in the test, not through the real issuance pipeline.** The certificate PDF is a stored stub (`%PDF-1.4 ...`) so the test proves delivery, not rendering (rendering is covered by `tests/certificate-download.integration.test.ts`). The learner's lesson access uses a real published course version, a real self-paced cohort and an ACTIVE enrolment, so the `canOpenLesson` check is the production one, not a stub.

**5. Local MinIO.** `docker-compose.yml` was not used (it reads `.env`, which this plan must not read). A throwaway `minio/minio` container with the `.env.example` placeholder credentials was started on port 9000 for the run and removed afterwards; the test creates the bucket if missing and refuses a non-local endpoint. The bucket has no anonymous policy, which is what `mc anonymous set none` in the compose init job produces.

Auth gates: none. Checkpoints: none.

## Known Stubs

None. (The certificate PDF and lesson file bytes in the test are fixtures, not application stubs.)

## Threat Flags

None. No new endpoint, auth path or schema was introduced; the only application change tightens an existing route's refusal.

## Threat model dispositions

- T-15-27-01 (existence oracle): mitigated and tested on all 8 routes, including the fixed CSV route.
- T-15-27-02 (long-lived or cached URLs): mitigated and tested; the one long lifetime (VIDEO, 4 h) is explicit and awaiting owner acceptance.
- T-15-27-03 (guessable keys or public bucket): mitigated for eight key builders and the local bucket; exports see Finding 1; production R2 is an owner check.
- T-15-27-04 (download after access removal): mitigated and tested with concurrent bursts.

## Self-Check: PASSED

Created files exist: `tests/authz-private-files.integration.test.ts`, `tests/storage-keys.test.ts`, `tests/exceptions-csv-route.test.ts`, `evidence/private-files-local.json`. All verify commands above were run in this session and exited 0. No commits were made (`actuals.commits: 0`, per the owner's no-commit rule). Port 9000 container removed; the pre-existing `learning-management-system-postgres-1` container was left running.
