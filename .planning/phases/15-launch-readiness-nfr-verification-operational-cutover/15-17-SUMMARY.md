---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 17
subsystem: e2e-journey
tags: [nfr-03, nfr-12, nfr-13, nfr-14, playwright, d-08, d-14, reliability]
status: complete

requires:
  - phase: 15-12
    provides: grade and completion uniqueness (the journey grades and completes one learner per run)
  - phase: 15-15
    provides: Playwright harness, email capture seam, guarded task runner, leg 1
provides:
  - "e2e/journey.spec.ts test 'full journey': discover, register, verify, enrol, pay (staff UI), learn, attend (staff UI), submit, grade (staff UI), complete, certificate download, public verification"
  - "e2e/support/journey-fixtures.ts: guarded globalSetup that makes one open priced cohort, session, assignment and certificate-ready course"
  - "e2e/support/staff-actions.ts, session.ts, diagnostics.ts, reliability-report.ts"
  - "evidence/journey-reliability-local.json (20 of 20, integrity clean) and evidence/journey-browsers-local.json (4 of 4)"
affects: [15-20, 15-28, 15-30, 15-31]

actuals:
  tokens: 13600
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Fixtures through Prisma, idempotent, behind assertSafeDatabaseUrl; dates pushed forward on every setup"
    - "Wait for learner-visible state (a poll that re-runs the drain task and re-reads the dashboard), never a sleep"
    - "Separate browser context per staff role so the learner session is untouched"
    - "Failure diagnostics: a stalled step attaches the non-idle database sessions and their lock waits"

key-files:
  created:
    - e2e/support/journey-fixtures.ts
    - e2e/support/staff-actions.ts
    - e2e/support/session.ts
    - e2e/support/diagnostics.ts
    - e2e/support/reliability-report.ts
    - tests/reliability-report.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/journey-reliability-local.json
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/journey-browsers-local.json
  modified:
    - e2e/journey.spec.ts
    - e2e/playwright.config.ts
    - e2e/support/server-env.ts
    - scripts/ops/run-task.ts

key-decisions:
  - "The journey pays through the manual payment confirmation path (ledger P-01): no payment code was touched"
  - "The assessment is an ASSIGNMENT with a small .txt upload to local MinIO, so staff grading and the certificate PDF are really exercised"
  - "Course completion rule v2 (passing assessments required) plus a 50 percent attendance threshold, so the attend and grade steps genuinely gate the certificate"
  - "WebKit gets the session cookie re-added without the Secure flag (support/session.ts), because Playwright WebKit never sends a Secure cookie to http://localhost"
---

# Phase 15 Plan 17: Full unassisted journey, reliability and browser matrix Summary

One Playwright test now takes a brand-new learner from the public catalogue to a downloaded, publicly verified certificate with no manual step: staff steps go through the staff screens, background work runs through the guarded task runner, and the run passed 20 of 20 on Chromium (19 of 20 in an earlier batch), left all seven integrity checks clean, and passed once each on Firefox, WebKit, branded Chrome and branded Edge.

## What was built

- **Task 1 (tracer).** `journey-fixtures.ts` is the Playwright `globalSetup`. It calls `assertSafeDatabaseUrl` first, makes sure the local MinIO bucket exists, then creates (only when missing) the "Journey Verification Course": two reading lessons, one assignment lesson, a published obligation version 1, an open cohort `JOURNEY-VERIFY-2026` (Naira price NGN 10,000, 50 percent attendance threshold, 100,000 seats, open for a year), one session that ended an hour ago, and a seeded default certificate template. The course issues certificates automatically and requires a passing assessment. `staff-actions.ts` holds `openStaffSession`, `confirmManualPayment` (amount is base plus the platform fee, computed with the product's own `calculatePlatformFeeMinor`), `markAttendance` and `gradeAndRelease`. The "full journey" test runs those steps in nine named `test.step`s. After grading it re-runs `drain-domain-events` and re-reads the dashboard until "Download certificate" shows, then asserts a 302 to a presigned link (`X-Amz-Expires`), a `200 application/pdf` body starting `%PDF-`, and the public `/verify/<ref>` page saying "This certificate is valid."
- **Task 2.** `reliability-report.ts` turns the Playwright JSON report into `{ project, runs, passed, failed, passRate, failures: [{ attempt, step, error }], ranAt }`, merges the integrity checks, and keeps any earlier superseded batch under `priorBatches`. Its parsing is unit tested (`tests/reliability-report.test.ts`, 4 tests).
- **Task 3.** The same test run on firefox, webkit, chrome and edge, versions taken from `browser.version()`.

## Results

| Check | Result |
| --- | --- |
| Full journey, chromium, 20 repeats (final batch) | 20 of 20, pass rate 1.0, 0 failures |
| Earlier 20-repeat batch (before diagnostics were added) | 19 of 20, pass rate 0.95 (kept in the evidence under `priorBatches`) |
| `integrity-checks.ts --fail-on-violation` after the 20 runs | exit 0, all seven checks passed |
| Integrity again after the browser runs and a final chromium pass | exit 0 |
| Browser matrix (one run each) | chrome 154.0.8037.98, edge 154.0.4258.62, firefox 155.0, webkit 26.6: 4 passed |
| Final chromium run of the whole file (leg 1 and full journey) | 2 passed |
| `npx vitest run tests/reliability-report.test.ts tests/run-task.test.ts` | 2 files, 15 tests passed |
| `npx tsc --noEmit` | clean |
| `npx eslint e2e scripts/ops/run-task.ts tests/reliability-report.test.ts` | clean |

Every run used the local Docker database (`licence_test`, guard passed before each command), the production build made against it, EMAIL_TRANSPORT through the loopback capture server, and a throwaway MinIO container. No server and no container is left running (MinIO removed; ports 3010 and 4010 not listening).

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] `run-task.ts` crashed on exit on Windows**
- **Found during:** Task 1
- **Issue:** `drain-domain-events` did its work ("drained 8 events ... sent 2") and then died with exit code 3221226505 (libuv "handle is closing" assertion), so the journey failed a healthy run.
- **Fix:** On success the runner closes the Prisma client, then exits one timer later (150 ms) instead of calling `process.exit` at once. The database guard still runs before any task or database module loads; the failure path never imports the database client.
- **Files modified:** scripts/ops/run-task.ts (`tests/run-task.test.ts` still passes)

**2. [Rule 3 - Blocking] The dashboard answers behind a loading shell**
- **Found during:** Task 1
- **Issue:** `page.goto("/dashboard")` returned while the page still showed only "Loading", so a count of "Download certificate" links was 0 for minutes even though the certificate existed.
- **Fix:** The poll waits for the "Your current course" region before counting. No sleep was added.

**3. [Rule 3 - Blocking] Playwright WebKit does not send the Secure session cookie to http://localhost**
- **Found during:** Task 3
- **Issue:** On WebKit the order step bounced to `/signin`. Cookie inspection showed `lms.session` stored but never sent on real requests; the earlier plan 15-15 conclusion that WebKit "kept the cookie" only held because the sign-in redirect is rendered inside the same server response. Removing the Secure flag from the same value made every later request authenticated.
- **Fix:** `e2e/support/session.ts` re-adds the same session value without the Secure flag, for WebKit only, after every sign-in (learner and staff). The application and its cookie options are untouched; the WebKit evidence entry carries a note saying so. No step is skipped for any engine. Real Safari and iPhone over https stay on the manual pass.
- **Files modified:** e2e/support/session.ts, e2e/support/staff-actions.ts, e2e/journey.spec.ts

**4. [Rule 2 - Missing critical] Failures had no recorded cause**
- **Found during:** Task 2 (first 20-run batch)
- **Issue:** One run (attempt 4) stalled for the whole 360 s test timeout inside "Mark complete" on the first reading lesson; the server logged only "destination stream closed early" when the browser gave up. The cause could not be read afterwards.
- **Fix:** Step actions and navigations now fail after 60 s (`actionTimeout`, `navigationTimeout`), and a failing "full journey" attaches `database-activity` (non-idle database sessions, wait events and blockers, query text cut to 80 characters). In the 20-run batch that followed, the browser runs and the final chromium pass it did not recur, so its cause is not proven (see Open item).
- **Files modified:** e2e/support/diagnostics.ts, e2e/journey.spec.ts, e2e/playwright.config.ts

### Plan interpretation

- The plan lists `e2e/support/server-env.ts` for S3 values; it also needed the Paystack settlement code placeholder (`PAYSTACK_SUBACCOUNT_CODE`, never sent to a provider) so the Naira "Pay in NGN" button appears in the public catalogue. Payment itself is the manual path.
- The plan names `confirmManualPayment(page, orderReference)`; the helper takes the order id from the checkout URL and opens `/staff/payments/<orderId>` directly.
- The seed's own catalogue has no cohort with an open Naira rail plus a past session plus a gradeable assignment, so a dedicated fixture course is created instead of changing the seed. Nothing in `prisma/seed.ts` was touched.
- Assessment type: an assignment with a `.txt` file upload (uploads were available because local MinIO runs), not the quiz fallback.
- `reliability-report.ts` got a `--mode browsers` and a `--prior` option beyond the plan, to produce the second evidence file and to keep the earlier 19 of 20 batch visible.

## Open item

One run in the first 20-run batch (19 of 20) stalled on the lesson "Mark complete" server action until the test timeout. It is recorded as a failure with step "learn: complete both reading lessons". It did not recur in the 20-run batch that followed or in later runs, so the stall is **not explained**. The diagnostics added afterwards will show database lock waits if it returns. Plan 15-28 and 15-30 should keep an eye on the lesson-progress action latency under load.

## Known Stubs

None.

## Threat Flags

None beyond the register. T-15-17-01 holds (guard runs in `appServerEnv()`, in `globalSetup` before any Prisma client, and in every verify command). T-15-17-02 holds (no payment code changed). T-15-17-03: `test-results` and `playwright-report` are gitignored; the diagnostics attachment holds no bind values. T-15-17-04: retries stay 0 and every failure, including the earlier batch, is in the evidence with its step.

## Owner notes

- To run the journey: start the throwaway object store once, make the production build against the local database, then run Playwright.
  `docker run -d --name journey-minio -p 127.0.0.1:9000:9000 -e MINIO_ROOT_USER=journeyminio -e MINIO_ROOT_PASSWORD=journey-minio-secret minio/minio:latest server /data` (values are local test values; the bucket `lms-journey` is created by the global setup), then `npm run build`, then `npm run test:e2e -- --project=chromium --grep "full journey"`. Stop and remove the container afterwards.
- The reliability batch used `--repeat-each=20 --reporter=json` with `PLAYWRIGHT_JSON_OUTPUT_NAME` as an absolute path (a relative path is resolved from the `e2e` folder), then `npx tsx e2e/support/reliability-report.ts --in <json> --out <evidence> --integrity <integrity json> [--prior <earlier json>]`.
- Each run adds a learner, an order, an enrolment, a submission, a grade and a certificate to the local database. The journey cohort has 100,000 seats and stays open for a year; the dates move forward on every setup.
- The 20-run chromium batch ran before `session.ts` existed; that file does nothing on Chromium, and a final chromium pass after adding it succeeded.
- Real Safari and an iPhone still need the manual pass: Playwright WebKit is not Safari, and this harness works around its cookie behaviour on plain http.

## Neon go-live list

No migration was created by this plan. Nothing here touches the shared database.

## Self-Check: PASSED

- Files present: e2e/journey.spec.ts, e2e/support/journey-fixtures.ts, e2e/support/staff-actions.ts, e2e/support/session.ts, e2e/support/diagnostics.ts, e2e/support/reliability-report.ts, e2e/support/server-env.ts, e2e/playwright.config.ts, scripts/ops/run-task.ts, tests/reliability-report.test.ts, both evidence JSON files.
- `journey.spec.ts` has the test "full journey", which calls `runTask` and asserts the certificate download and the public verification result; `journey-fixtures.ts` calls `assertSafeDatabaseUrl` before creating any record.
- Task 2 verify command passes (runs 20, passRate 1, seven integrity checks passed); Task 3 evidence lists chrome, edge, firefox and webkit with version strings and `passed: true`.
- No commits were made and nothing is staged (per the run overrides, `commits: 0`).
