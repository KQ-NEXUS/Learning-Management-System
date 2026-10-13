# Deferred items — found during 13-13 execution

Logged per the executor's scope-boundary rule: issues discovered while running
the phase-gate `npm test` that are **not** caused by plan 13-13's own changes
(which touch only `tests/brevo-live.smoke.test.ts`,
`tests/communications-invariants.test.ts`,
`tests/communications-e2e.integration.test.ts`, and additions to
`tests/boundary.test.ts` — no production code). None of these were fixed by
this plan; they are recorded here for a follow-up pass.

## 1. Two stale mapper-registration assertions (Plan 08 / Plan 10 debt)

**`tests/event-intent-mappers.test.ts` — "maps a type with no registered
mapper to an empty array"** asserts `table["payment.failed"]` is `[]`. Plan
08 (`event-mappers/enrolment-payment.ts`) registered a real
`payment.failed` mapper; this pre-existing test was never updated to pick a
different still-unmapped `DomainEventType` for its example.

**`tests/event-mappers-support.test.ts` — "registers exactly one mapper for
every event type in this group"** and two `ticket.created` cases under the
same file assert `mapperTable["ticket.created"]` has length 1. Plan 11 added
`createStaffMappers()`'s own `ticket.created` staff alert alongside Plan 10's
learner-facing `createSupportMappers()` one — `mapperTable["ticket.created"]`
correctly fans out to 2 mappers today (proven directly in
`tests/communications-e2e.integration.test.ts`'s criterion 1, which asserts
both the learner email and the staff-only notification exist). Plan 11's own
`13-11-SUMMARY.md` (Deviation 2) records that it caught and fixed the
identical mistake in a *new* test it wrote in that same plan, but did not
go back and fix this pre-existing Plan 10 file.

**Reproduction (isolated from every 13-13 file, confirming this is not an
env-pollution artifact of the new test files):**
```
npx vitest run tests/event-intent-mappers.test.ts tests/event-mappers-support.test.ts
```
4 failing tests, all pre-existing stale assertions.

**Suggested fix (not applied by 13-13 — out of its file scope):** update the
`payment.failed` example to a genuinely still-unmapped `DomainEventType`
(e.g. `attendance.changed`), and update the three `ticket.created` length
assertions in `tests/event-mappers-support.test.ts` to `2`, matching
`event-mappers-staff.test.ts`'s already-correct expectation.

## 2. MinIO object storage not running locally (infra, not code)

`tests/certificate-download.integration.test.ts`,
`tests/certificate-unicode-file.integration.test.ts`, and
`tests/submission-service.integration.test.ts` (11 tests total) fail with
`ECONNREFUSED 127.0.0.1:9002` / `fetch failed`. These tests need the
`minio` service from `docker-compose.yml`, which was not started for this
run — only the Postgres dev container and each test file's own
Testcontainers Postgres were running. Not a Phase 13 concern; unrelated to
communications/notifications.

**Fix:** `docker compose up -d minio` before running the full suite.

## 3. Two apparent resource-contention timeouts

`tests/schema-cohort.test.ts` (`afterAll` hook timeout at 300s) and
`tests/certificate-revocation.test.ts` (2 tests, 5s default timeout) failed
during the full ~36-minute `npm test` run. Both passed when the surrounding
suite was not under the same combined CPU/Docker load in earlier, smaller
runs during this same session (see 13-13-SUMMARY.md's phase-gate section).
Likely flaky under full-suite load on this machine, not a logic defect.
Re-run in isolation to confirm before investigating further.
