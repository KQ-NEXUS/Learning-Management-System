---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 30
subsystem: staging-run-nfr-02
tags: [nfr-01, nfr-02, nfr-03, nfr-08, k6, playwright-probe, staging, netlify, neon, cors]
status: complete

requires:
  - "15-29 (staging branch, preview, seeded load, rotated passwords), 15-14 (k6 scripts, seed-load), 15-18 (probe), 15-17 (journey)"
provides:
  - "scripts/ops/staging-checks.ts: guarded read-only staging probes (verification-token count, connection sampling), 13 unit tests"
  - "PILOT=1 mode in the k6 pilot-load script (one tenth of the agreed load)"
  - "e2e/playwright.staging.config.ts and the tests \"staging journey\" and \"staging quiet resend\""
  - "evidence/staging-pilot.json: k6 pilot, probe, quiet-resend, connection samples, journey result (passed on the eighth attempt, seven failed attempts kept as history)"
  - "e2e/support/upload-diagnostic.ts: a gated reader of the storage service's answer to the journey's upload, off unless STAGING_UPLOAD_DIAG=1"
  - "evidence/staging-load.json: the signed k6 run at 150 learners and 10 staff, with connection samples, slowest requests and the owner's decision"
  - "evidence/staging-probe.json: browser time-to-usable for 12 of 13 views under the full load, with cold samples; the lesson view is a recorded gap"
affects: ["15-31"]

key-files:
  created:
    - scripts/ops/staging-checks.ts
    - tests/staging-checks.test.ts
    - e2e/playwright.staging.config.ts
    - e2e/support/staging-setup.ts
    - e2e/support/upload-diagnostic.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/staging-pilot.json
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/staging-load.json
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/staging-probe.json
  modified:
    - e2e/journey.spec.ts
    - e2e/support/journey-fixtures.ts
    - perf/pilot-load.js
    - perf/lib/config.js

decisions:
  - "The pilot's k6 p75 values are taken from k6's own threshold output; the summary export does not carry p75"
  - "The staging journey reuses the local journey's steps through one shared function, so both prove the same steps"
  - "The upload failure on the preview was never worked around in the test: the browser's direct upload is the real path. It had two causes, both in settings the owner controls: the bucket's CORS rule, then an empty S3_ACCESS_KEY_ID on the preview"
  - "The full run's probe used two browser processes side by side (learner views, staff views) so that every sample fell inside the 10-minute hold; one serial pass was estimated at about 12.5 minutes on the preview"
  - "The lesson view's missing browser measurement under load is left as a gap in the evidence (12 views listed, the plan's check fails) instead of being filled with the no-load measurement"
  - "The full run was done once and not repeated; the lesson gap goes to plan 15-31"
  - "Each time the staging journey failed at the upload (after the CORS change, after the checksum fix in the owner's commit 9be7af3, after the owner's first Netlify change) the run stopped, the trace was read and the fault was reported; nothing was worked around in the test and no product code was changed inside this plan"
  - "The empty-body checksum in the upload link (fixed in 9be7af3) was a real defect but not the cause of the refused upload; the cause was an empty S3_ACCESS_KEY_ID on the preview, read from the storage service's own answer"
  - "The storage service's answer was read with a gated diagnostic in the test files (off by default); a run with it on is never counted as a pass"
  - "journeyPassed was set to true only after a real, un-routed browser upload passed with the diagnostic off (eighth attempt, learner 144)"
  - "The plan is marked complete with open items carried to plan 15-31: the lesson view's browser number under load (Task 3's automated check still exits 1) and the unassisted manual journey by a person (D-08)"

requirements-completed: []

actuals:
  tokens: 35700
  tasks: 3
  commits: 0

metrics:
  duration: "about 75 min for Task 1, about 45 min for Task 3, about 15 min for the first close-out session, about 15 min for the second, about 10 min for the upload diagnostic, about 15 min for the third and about 20 min for the fourth; about 3 h 15 min in all"
  completed: 2026-10-11
---

# Phase 15 Plan 30: Staging run for NFR-02 Summary

**One staging run at 150 learners and 10 staff with no failed request and every k6 threshold passed, 12 of 13 views measured in the browser under that load and all within 2,500 ms, `after()` proven on Netlify, and the staging journey passed end to end on the deploy preview at the eighth attempt, once the storage keys reached the preview.**

**Status: complete, with open items that plan 15-31 must close. Read these before treating any requirement as signed (`requirements-completed` is empty on purpose):**

| | Open item | Goes to |
| --- | --- | --- |
| a | **The lesson view has no browser measurement under load.** Task 3's automated check still exits 1 (12 views listed, not 13). Not re-measured; no load was run after the full run. | Plan 15-31: a recorded waiver, or one more loaded measurement with a new owner approval |
| b | **The unassisted manual journey (D-08) has not been done by a person.** The test passing is not a substitute. | A person who has not used the product, on the preview |
| c | **Owner checks not reported back:** Netlify Team usage after the full run, the Neon compute allowance (68.0 compute-unit hours used by 11 October, 07:11 UTC), the UptimeRobot log for 07:26 to 07:39 UTC. | Owner |
| d | **Two slow spells in the full run have no established cause** (07:28:22 to 07:28:32 and 07:37:51 to 07:37:53 UTC). | Plan 15-31, Netlify function log |
| e | **The signed load numbers were measured on `9a68b7a`; the preview now serves `9be7af3`.** The storage fix does not touch page rendering, so no difference is expected. That is reasoning, not a measurement. | Plan 15-31 to accept or re-measure |
| f | **Whether the Production context in Netlify has the storage keys is not verified.** The fault that blocked the preview all morning could be on the live site too. | Owner, launch checklist |
| g | **Suggested hardening, not done (product code):** `makeClient` in `src/server/services/storage-service.ts` should throw a named error when `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is missing or empty, instead of signing with an empty key. | Owner of storage-service |
| h | **CI is red on `9be7af3`** ("Integration tests" shards 2 and 4, "Unit and component tests"). As read by the orchestrator from the CI logs, not by this executor: the workflow starts no MinIO, so storage tests cannot connect; the unit job's `--exclude` does not keep integration files out; and the known `ticket-phase-invariants` nav test fails. The same failures existed on `9a68b7a`. | Owner of the CI workflow |

**Latest (fourth close-out session, 2026-10-11, 09:26 to 09:33 UTC): the staging journey passed.** The owner reported that the earlier Netlify change "did not save before"; `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` were then saved for the preview, the cache cleared and the site redeployed ("Published"). GitHub shows a new "Deploy Preview ready!" at 09:24:07 UTC, still on commit `9be7af3`. The eighth attempt (headed Chromium, learner 144, diagnostic off, a real un-routed upload) passed all eleven steps in 2.3 minutes: **the upload link now carries a 32-character access key id and the storage service answered the browser's PUT with 200;** grading, completion, the certificate download and the public verification passed. No retry was needed, nothing was worked around and no product code was changed. Task 1's check now exits 0. See "Fourth close-out session" below.

**The sections from here to "Fourth close-out session" are the record of the earlier sessions, kept as written at the time. Where they say "in-progress", "still fails" or "cause not established", read them as history: the cause was an empty `S3_ACCESS_KEY_ID` on the preview and it is fixed there.**

**Earlier (third close-out session, 2026-10-11, 09:01 to 09:08 UTC): the owner's Netlify change has not reached the preview; the upload still fails for the same reason.** The owner reported setting `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` for the Deploy Previews context and retrying the deploy, and GitHub shows a new "Deploy Preview ready!" at 09:00:47 UTC. The staging journey (sixth attempt, headed Chromium, learner 146, diagnostic off, a real un-routed upload) failed at the upload again: **the link the preview issued at 09:04:57 UTC is still signed with an access key id of length 0.** One diagnostic run (seventh attempt, learner 145) read the storage answer: **400 `InvalidArgument`, "Credential access key has length 0, should be 32"**, the same as before the change. Nothing was worked around and no product code was changed. See "Third close-out session" below.

**Earlier (second close-out session, 08:34 to 08:39 UTC): the checksum fix did not make the upload work.** The preview serves the owner's commit `9be7af3`, and the upload link it issues no longer carries a checksum parameter, so the fix is deployed and does what it was meant to do. The fourth attempt (learner 148) still failed at the same step. The cause was not established in that session; it was read in the "Upload diagnostic" session that followed (an empty access key id).

**Status as it stood at 09:08 UTC (superseded by the top of this file): in-progress. The plan is not complete, for three reasons: (1) the staging journey still fails at the assignment upload, after the bucket's CORS setting was corrected, after the checksum fix was deployed and after the owner's change to the Netlify variables, so Task 1's check exits 1; (2) the lesson view has no browser measurement under load, so Task 3's check exits 1; (3) the unassisted manual journey (D-08) has not been done by a person.**

**What does hold: the full staging run (Task 3) was done once on 2026-10-11, 07:26 to 07:39 UTC, at 150 learners and 10 staff: 10,599 requests, none failed, every k6 threshold passed (highest page p75 1,313 ms against 2,500 ms). The browser probe measured 12 of the 13 core views under that load and all 12 passed (highest warm p75 928 ms). In Task 1 the load pilot, the browser probe and the quiet-resend check passed. The local "full journey" passed after the refactor.**

**New finding from the close-out session (07:48 to 07:56 UTC), more important than the journey result itself: uploads to the hosted storage bucket fail for a reason that is not CORS.** The CORS setting is now right (the preflight answers 204 for the preview's address), yet the browser's upload is still refused. The probable cause named then was the product's upload link (it carried the checksum of an empty file). **That was tested in the second close-out session and did not hold up:** with the checksum gone from the link, the upload is still refused. See "Close-out session" and "Second close-out session" below.

Nothing is committed (owner rule). No connection string, host name, key, token or password is in this file or in the evidence file.

## Status by task

| Task | Result |
| --- | --- |
| 1. Pilot at one tenth, probe, staging journey, quiet resend | **Done.** k6 pilot passed, probe passed, quiet resend passed. **Journey passed on the eighth attempt (09:27 to 09:30 UTC, learner 144, a real un-routed upload).** The seven before it failed: once on the test's own first assertion, then six times at "submit": once on the bucket's CORS setting and five times because the upload link was signed with an empty access key id (the preview's functions had no `S3_ACCESS_KEY_ID`). Verify command exits 0. |
| 2. Owner decision on the full run | **Given: proceed** ("Run the full test"). Recorded verbatim below. |
| 3. Full run | **Run once.** k6: all 15 thresholds passed, 0 failures. Probe: 12 of 13 views measured under load, all 12 within 2,500 ms. **Lesson view not measured in the browser under load (harness fault).** Verify command exits 1 because 12 views are listed, not 13. Human check not done. |

## Owner confirmation recorded (2026-10-11, verbatim)

> "They are test keys"

> "Every thing is for test remember the client will set by them selfs most likely"

So Paystack and Stripe on the preview are test keys and the other hosted values (the storage bucket included) are test-only. This clears the open item in 15-STAGING.md that blocked checkout, upload, certificate and export steps on the preview.

## Owner decision on the full run (Task 2, 2026-10-11, verbatim)

The orchestrator asked the owner through a question dialog and passed the answer to the executor.

Question:

> "The last big test simulates 150 learners and 10 staff on the test website for 12 minutes. It uses some of your free Netlify allowance. Should I run it?"

Owner's answer:

> "Run the full test"

The option was described as: "150 learners and 10 staff. Gives the full signed numbers. Uses the most allowance; if the free allowance runs out, Netlify pauses the site until next month."

This is the plan's "proceed". The owner was told that the full run is about 28 times the pilot and that Netlify usage could not be read from this machine. **The owner did not report Netlify or Neon usage numbers before approving,** so the usage check the plan asks for (ledger A5, A6) was not done with numbers.

For the upload CORS failure the owner chose: "I'll fix it in Cloudflare".

## What was measured in Task 1 (all on 2026-10-11, UTC)

Target: preview `https://deploy-preview-16--kqnexuslms.netlify.app`, built from commit `9a68b7a` (the head of pull request 16, read from GitHub), and Neon branch `staging-phase 15`. Before any database command the Neon API confirmed that the pooled URL, the direct URL and both allow-listed hosts belong to that branch and that it is not the default branch. The `production` and `prod_test2` branches were not touched.

### k6 pilot (05:08:34 to 05:12:41)

15 learners (30 s ramp, 3 min hold, 15 s ramp down) and 1 staff, think time 5 to 15 s, documents only, k6 2.3.0 in Docker on the laptop.

- **342 requests, 0 failed (0.00 percent), 1,026 of 1,026 checks passed, all 13 p75 thresholds passed, k6 exit 0.**
- 13 MB received (about 38 KB per page; k6 does not ask for compression).
- All requests: median 587 ms, p90 2.17 s, p95 3.18 s, slowest 7.86 s.

| Page | k6 p75 (ms) | Requests | Slowest (ms) |
| --- | --- | --- | --- |
| dashboard | 1,030 | 44 | 7,865 |
| learn | 1,230 | 44 | 7,677 |
| course-home | 1,490 | 44 | 6,723 |
| lesson | 928 | 85 | 5,788 |
| results | 701 | 37 | 2,449 |
| sessions | 735 | 35 | 4,427 |
| support | 692 | 31 | 1,889 |
| staff-overview | 2,300 | 4 | 6,654 |
| staff-cohorts | 1,550 | 4 | 3,944 |
| staff-cohort | 1,080 | 4 | 1,562 |
| staff-grading | 1,710 | 4 | 2,680 |
| staff-support | 2,120 | 3 | 3,182 |
| staff-payments | 1,980 | 3 | 2,177 |

Reading these honestly:

- The staff pages have 3 or 4 requests each (one staff virtual user), so their p75 is one or two requests and is only indicative. `staff-overview` at 2,300 ms is one slow first request (6.65 s) among four.
- The slow requests (4 to 8 s) cluster in two places: the first seconds of the run (05:08:40) and a 25-second spell from 05:10:11 to 05:10:34, in the middle of the hold. The first group fits functions starting cold. The cause of the second was not established (new function instances starting is the likely one; there is no server log from the preview on this machine). The full run will show whether such spells stay a small share at 160 users; this is the tail plan 15-28 asked the staging run to watch.

### Database connections during the pilot (ledger P-10)

Sampled every 15 s with `staging-checks connections` (17 samples): **peak 16 rows in `pg_stat_activity`, 9 client backends, 1 active.** Idle afterwards: 15 rows, 8 client backends (4 held by Neon's pooler, 3 Neon internal sessions, 1 the sampler). So the pooler held at most 5 Postgres connections for 16 virtual users. The server allows 901 connections. The pooled URL carries no `connection_limit` or `pool_timeout` setting; no pool timeout was seen at this load. The full run is where P-10 is really measured.

### Browser probe (5 samples per view, Regular 4G, no background load)

**13 of 13 views passed; the highest warm p75 was 2,109 ms (staff-cohort), every other view was at most 1,075 ms.** With 4 warm samples per view these are a smoke check, not the signed number.

| View | warm p75 (ms) | cold (ms) | View | warm p75 (ms) | cold (ms) |
| --- | --- | --- | --- | --- | --- |
| staff-cohort | 2,109 | 6,542 | learn | 735 | 1,407 |
| staff-payments | 1,075 | 1,835 | staff-grading | 684 | 2,203 |
| staff-cohorts | 1,025 | 2,261 | staff-support | 633 | 2,146 |
| dashboard | 861 | 3,307 | course-home | 589 | 2,169 |
| staff-overview | 818 | 1,818 | support | 565 | 2,276 |
| results | 753 | 1,416 | sessions | 505 | 1,892 |
| lesson | 747 | 1,962 | | | |

### Quiet resend: `after()` works on Netlify (ledger A15)

A fresh account was registered through the preview in a visible browser. `staging-checks tokens` reported **1** verification token. 68 seconds later (the resend has a 60-second cooldown per address, so the plan's order "sign in straight away" would always show no new token) the account signed in with the right password: the neutral message appeared and the page stayed on `/signin`. Ten seconds after the response the count was **2**. `before 1, after 2`: the work scheduled with `next/server` `after()` ran on Netlify.

### Staging journey: failed at the upload

Run in a visible Chromium against the preview, with a seeded load learner signing in through the form and a load staff account doing the staff steps.

| Step | Result |
| --- | --- |
| Sign in through the form | passed |
| Enrol: choose the cohort, reach the order page | passed |
| Pay: staff confirm the manual payment; `run-task drain-domain-events --target staging` | passed |
| Learn: open the course, complete both reading lessons | passed |
| Attend: staff mark the learner present | passed |
| **Submit: upload the assignment** | **failed** |
| Grade, complete, certificate download, public verification | not reached |

**Cause (found from the browser trace, then confirmed with three preflight requests):** the browser uploads the file straight to object storage with a presigned link. The bucket answers the CORS preflight for the preview's address with 403 and no `Access-Control-Allow-Origin`, so the browser blocks the upload. The same preflight answers 204 for the production site's address (`https://kqnexuslms.netlify.app`) and for `http://localhost:3000`. It is a storage setting, not a code defect, and uploads from the production address are allowed.

**Fix (owner):** in the storage provider's console, add `https://deploy-preview-16--kqnexuslms.netlify.app` to the bucket's CORS allowed origins (method PUT, header `content-type`). Then the journey is run once more with another load learner (`STAGING_JOURNEY_LEARNER=149`; a learner can take the journey course once, and learner 150 is now part-way through it).

An earlier attempt failed after 29 seconds on the test's own first assertion (it looked for the heading "Your dashboard"; a learner who already has a course is greeted by name). The test was corrected. No enrolment had been made.

**Correction (close-out session):** the cause above was only the first of two obstacles, and the sentence "uploads from the production address are allowed" was not established: only the preflight for that address was checked, never an upload. See the next section.

## Close-out session: CORS corrected, upload still refused (07:48 to 07:56 UTC)

The owner reported the bucket's CORS change as done ("Done", 2026-10-11).

### Preflight check (07:48:30 UTC): passed

The same request as before (OPTIONS to the bucket, `Access-Control-Request-Method: PUT`, `Access-Control-Request-Headers: content-type`), sent for three origins:

| Origin | Status | `Access-Control-Allow-Origin` | Allowed method, header |
| --- | --- | --- | --- |
| `https://deploy-preview-16--kqnexuslms.netlify.app` | **204** (was 403) | the preview's origin | PUT, content-type |
| `https://kqnexuslms.netlify.app` | 204 | that origin | PUT, content-type |
| `http://localhost:3000` | 204 | that origin | PUT, content-type |

Before the journey the Neon API again confirmed that the pooled URL, the direct URL and both allow-listed hosts belong to branch `br-icy-river-axqpwts7`, which is not the default branch; `/api/health` answered 200; the head of `LAUNCH` on GitHub was still `9a68b7a`.

### Staging journey, third attempt (07:49:11 to 07:50:58 UTC): failed at the upload

Visible (headed) Chromium, `STAGING_JOURNEY_LEARNER=149`, same command and configuration as before, 1.4 minutes.

| Step | Result |
| --- | --- |
| Sign in through the form (Load Learner 149) | passed |
| Enrol: choose the cohort, reach the order page | passed |
| Pay: staff confirm the manual payment; `run-task drain-domain-events --target staging` | passed |
| Learn: open the course, complete both reading lessons | passed |
| Attend: staff mark the learner present | passed |
| **Submit: upload the assignment** | **failed**: the page showed "Your file couldn't be uploaded. Nothing was submitted." |
| Grade and release | not reached |
| Complete, certificate issued | not reached |
| Certificate download | not reached |
| Public verification | not reached |

### What the trace shows

- The browser's error changed. At 05:29 it read "Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header". Now it reads only "No 'Access-Control-Allow-Origin' header is present on the requested resource": the preflight passed and it is the answer to the PUT itself that carries no CORS header.
- The storage service's error answers carry no CORS headers for any origin: a PUT with no signature (which storage refuses, so nothing is written) answered 400 with no `Access-Control-Allow-Origin` for the preview, the production and the localhost origins alike. So a refused upload always looks like a CORS block in the browser, whatever the real reason.
- The presigned link carries `x-amz-checksum-crc32=AAAAAA==`, which is the CRC32 of an **empty** body, together with `x-amz-sdk-checksum-algorithm=CRC32`. The link from the 05:29 attempt carried the same. The file the learner uploads is not empty.
- `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are at 3.1125.0; recent versions add this checksum by default. `makeClient` in `src/server/services/storage-service.ts` does not turn it off (`requestChecksumCalculation: "WHEN_REQUIRED"`), and the link is made without the file's content.

**Probable cause, not confirmed:** the storage service compares the uploaded file with the empty-body checksum in the link and refuses the PUT. Local MinIO does not refuse such a link, which is why the local journey passes and why this was not seen before the preview.

**Why it is not confirmed:** the storage service's real answer to the PUT was not read. The browser hides it, and replaying the browser's request once outside the browser was not permitted in this session. Whoever fixes this should first read that answer (browser network tab on the preview, or one upload from the production site).

**What this means:**

- It is a fault in the product's upload link, not in the test and not in the CORS setting. The same client signs every presigned upload (lesson uploads, certificate template assets), so those are expected to fail on hosted storage too, **from the production address as well**. Nothing in Phase 15 has shown a browser upload succeeding on hosted storage.
- It was not fixed here: the fix changes `src/server/services/storage-service.ts`, is outside this plan's files, and reaches the preview only through a push and a rebuild, which need the owner. The test was not changed to get round it.
- It is recorded in `deferred-items.md` as a launch blocker until an upload succeeds on hosted storage.
- The next staging journey needs another learner: `STAGING_JOURNEY_LEARNER=148` (learners 149 and 150 are part-way through the journey course).

### Local "full journey" after the refactor (07:53:25 to 07:54:41 UTC): passed

`e2e/journey.spec.ts` "full journey", Chromium, headed, once: **1 passed, 34.3 s** (register, verify by emailed link, sign in, enrol, pay, learn, attend, upload, grade, complete, certificate download, public verification). Local Docker Postgres database `licence_test` (30 of 30 migrations; `assert-local-db` answered "database target is local" before the run), a throwaway local MinIO container, the existing production build (no file under `src` or `prisma` is newer than it), the local email capture server. Neon was not used. This closes deviation 7's open point: the shared function the two journeys use works end to end where storage accepts the upload.

## Second close-out session: checksum fix deployed, upload still refused (08:34 to 08:39 UTC)

Between the sessions the orchestrator changed `makeClient` in `src/server/services/storage-service.ts` (it now sets `requestChecksumCalculation` and `responseChecksumValidation` to `"WHEN_REQUIRED"`) and added `tests/storage-presign-checksum.test.ts`. The owner committed and pushed it as `9be7af3` "fix(storage): stop signing an empty-body checksum into upload links". None of that is this executor's work or commit.

### Which build the preview served

| Check (08:34:59 UTC) | Result |
| --- | --- |
| Head of pull request 16 on GitHub | `9be7af331a431e9c75b34e912ee4c19744d59f00`, the same as the local `LAUNCH` head |
| Netlify checks for that commit | `netlify/kqnexuslms/deploy-preview` pass ("Deploy Preview ready!"), "Header rules" pass, "Redirect rules" pass |
| `/api/health` on the preview | 200 |
| Upload link issued by the preview at 08:37:31 UTC (read from the browser trace) | **no checksum parameter** |

The deployed commit was not read from Netlify itself (no CLI, no token). The last row is the direct sign: only the new build issues a link without the checksum. The link's query parameter names were `X-Amz-Algorithm`, `X-Amz-Content-Sha256` (value `UNSIGNED-PAYLOAD`), `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires` (900), `X-Amz-Signature`, `X-Amz-SignedHeaders` (`host`) and `x-id`. The link itself was not printed or written anywhere by this session.

Not part of this plan, but seen in the same check: on `9be7af3` the GitHub checks "Integration tests (shard 2 of 4)" and "(shard 4 of 4)" had failed and "Unit and component tests" was still running. The cause was not read.

Before the journey the Neon API again confirmed that the pooled URL, the direct URL and both allow-listed hosts belong to branch `br-icy-river-axqpwts7`, which is not the default branch.

### Staging journey, fourth attempt (08:35:58 to 08:37:56 UTC): failed at the upload

Visible (headed) Chromium, `STAGING_JOURNEY_LEARNER=148`, same command and configuration as before with one addition (`--trace on`, so that the link's parameters could be read had the run passed), 1.3 minutes.

| Step | Result |
| --- | --- |
| Sign in through the form (Load Learner 148) | passed |
| Enrol: choose the cohort, reach the order page | passed |
| Pay: staff confirm the manual payment; `run-task drain-domain-events --target staging` | passed |
| Learn: open the course, complete both reading lessons | passed |
| Attend: staff mark the learner present | passed |
| **Submit: upload the assignment** | **failed**: the receipt "Submitted — receipt" never appeared (the test waited 20 s) |
| Grade and release | not reached |
| Complete, certificate issued | not reached |
| Certificate download | not reached |
| Public verification | not reached |

### What the trace shows

- One `PUT` from the page to the storage service at 08:37:31.599 UTC, request header `content-type: text/plain`. The browser recorded `net::ERR_FAILED` with no status and no response headers.
- Browser console: "Access to fetch ... has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource." The same wording as the third attempt: the preflight passed and the answer to the PUT itself has no CORS header.
- The link is a plain presigned `PutObject` (SigV4, only the `host` header signed, unsigned payload, bucket name in the host name). There is no checksum parameter of any kind.
- A preflight sent after the run (08:38:44 UTC) to the same object address, for the preview's origin, answered **204** with the preview's origin, method PUT and header content-type. So the CORS setting is still right.

### What this means

- **The fix in `9be7af3` is deployed and does what it says, and it did not make the upload work.** The "probable cause" of the first close-out session is therefore wrong or incomplete. That session's sentences about the checksum stay in this file as history; read them with this correction.
- **The cause is not established.** The storage service's answer to the PUT (its status and error code) has still not been read by anyone: the browser hides it because the answer has no CORS header, and this session did not replay the request outside the browser (not permitted in the earlier session, and not attempted here).
- Candidates that fit what was seen, **none of them tested**: the storage credentials set on the preview being refused (a wrong secret, or an API token without write permission on this bucket); a bucket or endpoint value on the preview that does not match the bucket whose CORS setting was corrected. A storage service that refuses a request for any of these reasons answers without CORS headers (shown in the first close-out session with an unsigned PUT), so all of them look identical in the browser.
- **How to find out:** open the preview in a browser with the developer tools' Network tab, try one upload, and read the status code of the refused PUT (the tab normally shows the status even when the page may not read the answer); or make one server-side storage call with the preview's credentials and read the error. Nothing server-side that writes to storage has been reached on the preview either (the certificate step comes after the upload).
- Whether uploads from the production address fail is **not known**. The earlier statement that they would fail "in the same way" rested on the checksum explanation.
- The checksum fix is still worth keeping: a link that carries the checksum of an empty file is wrong for any non-empty upload on a storage service that checks it.
- The next staging journey needs another learner: `STAGING_JOURNEY_LEARNER=147` (learners 148, 149 and 150 are part-way through the journey course).

Per the instruction for this session, the run stopped here: no retry, no change to the test, no change to product code, no load.

## Upload diagnostic: the storage service's answer was read (08:46 to 08:49 UTC)

**Cause found: the upload link is signed with an EMPTY access key id.** The storage service answers the PUT with **400 `InvalidArgument`, "Credential access key has length 0, should be 32"**. The preview's server has no value in `S3_ACCESS_KEY_ID`.

### How it was read

The owner, through the orchestrator, authorised reading the answer from Playwright's Node side. A small diagnostic was added to the test files, off by default (`STAGING_UPLOAD_DIAG=1` turns it on): `e2e/support/upload-diagnostic.ts`, called once from the "staging journey" test in `e2e/journey.spec.ts`. With the switch on, the journey's own PUT to the storage host is sent from Node (`route.fetch()`, where CORS does not apply) and handed back to the page unchanged. It records the status, header names, whether `Access-Control-Allow-Origin` is present, the content type, and only `<Code>` and `<Message>` of an error body, masked. It never records the link, its values, the host or the key path. Without the switch the journey is unchanged. No file under `src/` was touched.

Before the run: pull request 16 head and local `LAUNCH` head both `9be7af3`; `/api/health` 200; the Neon API confirmed the pooled URL, the direct URL and both allow-listed hosts are on `br-icy-river-axqpwts7`, not the default branch.

### Staging journey, fifth attempt (08:46:34 to 08:49:23 UTC, learner 147, headed Chromium, diagnostic on): failed at the upload

The six steps before the upload passed again (sign in, enrol, pay, open the course, both reading lessons, attendance). One run, no retry, no load.

| Fact about the PUT (08:48:54 UTC) | Value |
| --- | --- |
| Status | **400** |
| Error code | **`InvalidArgument`** |
| Error message | **"Credential access key has length 0, should be 32"** |
| Answer content type, size | `application/xml`, 148 bytes |
| Answer header names | `cf-ray`, `connection`, `content-length`, `content-type`, `date`, `server` |
| `Access-Control-Allow-Origin` on the answer | absent (which is why the browser hid all of the above) |
| Request header names the browser sent | `accept`, `accept-language`, `content-type` (`text/plain`), `origin`, `referer`, `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `user-agent` |
| Request body | 42 bytes |
| Link query parameter names | `X-Amz-Algorithm`, `X-Amz-Content-Sha256`, `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires`, `X-Amz-Signature`, `X-Amz-SignedHeaders` (`host`), `x-id`; no checksum parameter |

### What it means

- The access key id part of `X-Amz-Credential` in the link is empty. `makeClient` in `src/server/services/storage-service.ts` reads `process.env.S3_ACCESS_KEY_ID ?? ""`, so a missing or empty variable signs links with an empty key instead of failing. The storage service refuses at that first check, before it looks at the signature, the bucket or the token's permissions.
- **It is a configuration fault on the deploy preview, not the CORS setting and not the checksum.** The bucket name and the endpoint are set on the preview (the link has the right host shape, and `S3_BUCKET` missing would have thrown). `S3_ACCESS_KEY_ID` is not reaching the preview's functions: it is missing, empty, saved under another name, or not scoped to Deploy Previews or to Functions in Netlify.
- **Not known:** whether `S3_SECRET_ACCESS_KEY` is right on the preview, and whether the token may write to the bucket. The storage service stops at the empty key, so neither was tested. Whether the production context has the same gap is not known either; a variable set only for Production would explain a preview-only fault.
- The CORS setting is fine and needs no change: the browser's request carries only `content-type` beyond the standard headers, which the rule allows.
- A weakness in repository code, **not changed here**: the `?? ""` fallbacks for the access key and the secret in `makeClient` hide a missing variable. Suggested fix for the owner of storage-service: throw a clear error ("S3_ACCESS_KEY_ID is not configured.") when either is missing or empty, as `S3_BUCKET` already does, so the learner's request for an upload link fails on the server with a named cause.
- This run does not prove an upload works. `journeyPassed` stays false.

### What the owner must change

1. In Netlify, Site configuration, Environment variables: open `S3_ACCESS_KEY_ID`. It must hold the storage API token's Access Key ID (32 characters), have the scope **Functions** (and Builds), and have a value for the **Deploy Previews** context (or "same value for all deploy contexts"). Check `S3_SECRET_ACCESS_KEY` the same way, and that both come from the same token, which has object read and write on the bucket named in `S3_BUCKET`.
2. Check the Production context has both values too.
3. Trigger a new deploy of the preview (environment variable changes only reach a new deploy).
4. Then one staging journey with `STAGING_JOURNEY_LEARNER=146`, diagnostic off (learners 147 to 150 are part-way through the journey course).

## Third close-out session: owner's Netlify change made, key still empty (09:01 to 09:08 UTC)

The owner reported ("Done", 2026-10-11) that `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` were set for the Deploy Previews context in Netlify and that the deploy was retried.

### Checks before the run

| Check | Result |
| --- | --- |
| Head of pull request 16 on GitHub, and local `LAUNCH` head | `9be7af3` |
| Netlify status on that commit (GitHub) | `netlify/kqnexuslms/deploy-preview` success, "Deploy Preview ready!", **reported at 09:00:47 UTC** (the one before it at 08:33:07 UTC). So a new deploy did finish after the owner's change. |
| `/api/health` on the preview | 200 |
| Neon API host check | pooled URL, direct URL and both allow-listed hosts on `br-icy-river-axqpwts7`, not the default branch |

Which variables the new deploy carried cannot be read from this machine (no Netlify CLI, no token).

### Staging journey, sixth attempt (09:03:25 to 09:05:22 UTC, learner 146, headed Chromium, diagnostic OFF): failed at the upload

A real, un-routed browser upload. Same command and configuration as before, with `--trace on`. 1.4 minutes.

| Step | Result |
| --- | --- |
| Sign in through the form (Load Learner 146) | passed |
| Enrol: choose the cohort, reach the order page | passed |
| Pay: staff confirm the manual payment; `run-task drain-domain-events --target staging` | passed |
| Learn: open the course, complete both reading lessons | passed |
| Attend: staff mark the learner present | passed |
| **Submit: upload the assignment** | **failed**: the receipt "Submitted — receipt" never appeared (the test waited 20 s) |
| Grade and release | not reached |
| Complete, certificate issued | not reached |
| Certificate download | not reached |
| Public verification | not reached |

From the trace (the link was not printed or written; only the length of one part of it was read):

- One `PUT` to the storage service at 09:04:57.543 UTC; the browser recorded `net::ERR_FAILED` and the console showed the CORS wording of the earlier attempts.
- **The access key id part of `X-Amz-Credential` in the link has length 0.** The rest of the credential scope is present (`.../auto/s3/aws4_request`), and the parameter names are the same eight as before, with no checksum.

So the link was signed by a server that still has no `S3_ACCESS_KEY_ID`.

### Staging journey, seventh attempt (09:06:13 to 09:08:00 UTC, learner 145, headed Chromium, `STAGING_UPLOAD_DIAG=1`): failed at the upload

The one diagnostic run the instruction for this session allowed. The six steps before the upload passed. 1.4 minutes.

| Fact about the PUT (09:07:34 UTC) | Value |
| --- | --- |
| Status | **400** |
| Error code | **`InvalidArgument`** |
| Error message | **"Credential access key has length 0, should be 32"** |
| Answer content type, size | `application/xml`, 148 bytes |
| Answer header names | `cf-ray`, `connection`, `content-length`, `content-type`, `date`, `server` |
| `Access-Control-Allow-Origin` on the answer | absent |
| Request | `content-type: text/plain`, 42 bytes, signed headers `host` |

This is the same answer as the fifth attempt, field for field.

### What it means

- **The cause is unchanged: `S3_ACCESS_KEY_ID` does not reach the functions of the deploy preview.** The owner's change and the new deploy did not alter what the server signs with.
- Why the change did not take effect is **not known** from here. Things that fit, none of them checked (they are all inside Netlify): the variable was saved under a slightly different name (the code reads exactly `S3_ACCESS_KEY_ID`); its scopes do not include Functions; the value was entered for another context, or the Deploy Previews value was left empty; the retried deploy reused the settings of the old deploy instead of reading the new ones.
- **Still not tested:** whether `S3_SECRET_ACCESS_KEY` is right, whether the token may write to the bucket, and whether the Production context has the keys. The storage service stops at the empty key, so none of these has ever been reached.
- Upload, grade, completion, certificate download and public verification have still never been reached on the preview.
- `journeyPassed` stays false. Per the instruction for this session the run stopped here: no further retry, no change to the test, no change to product code, no load.

### What the owner must change

1. In Netlify, open the site `kqnexuslms`, then Site configuration, Environment variables. Find the storage key variable and check three things:
   - **Name:** exactly `S3_ACCESS_KEY_ID` (capital letters, underscores, no space at the end). The same for `S3_SECRET_ACCESS_KEY`.
   - **Scopes:** "All scopes", or a list that includes **Functions**. A variable scoped only to Builds is not visible to the running site.
   - **Values:** either "Same value for all deploy contexts", or a value in the **Deploy Previews** row. The Access Key ID is 32 characters long; paste it with no spaces or quotes.
2. Do the same check for `S3_SECRET_ACCESS_KEY`, and make sure both come from the same storage API token, one that can read and write objects in the bucket named in `S3_BUCKET`.
3. Start a **new build**, not a retry of the old one: Deploys, open the latest Deploy Preview for pull request 16, "Retry deploy", **"Clear cache and deploy site"**. Or push any commit to `LAUNCH`.
4. Tell the orchestrator. The next run is one staging journey with `STAGING_JOURNEY_LEARNER=144`, diagnostic off (learners 145 to 150 are part-way through the journey course).

A quicker way for the owner to see the result without a full journey: after the new deploy, open the preview, sign in as a learner with an assignment, try one upload with the browser's Network tab open, and look at the status of the request to the storage host. 200 means the key is there.

## Fourth close-out session: keys saved, new deploy, journey passed (09:26 to 09:33 UTC)

The owner reported (2026-10-11) that the earlier Netlify change "did not save before", and that `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are now saved for the preview, the cache was cleared and the site redeployed ("Published").

### Checks before the run (09:26 UTC)

| Check | Result |
| --- | --- |
| Head of pull request 16 on GitHub, and local `LAUNCH` head | `9be7af3` |
| Netlify status on that commit (GitHub) | `netlify/kqnexuslms/deploy-preview` success, "Deploy Preview ready!", **reported at 09:24:07 UTC** (the ones before it at 09:00:47 and 08:33:07 UTC). Header rules and Redirect rules pass. |
| `/api/health` on the preview | 200 |
| Neon API host check | pooled URL, direct URL and both allow-listed hosts on `br-icy-river-axqpwts7` (`staging-phase 15`), not the default branch |
| Other GitHub checks on `9be7af3` (not part of this plan) | "Integration tests" shards 2 and 4 and "Unit and component tests" fail; shards 1 and 3, "Lint and type check" and "Dependency audit" pass. See open item h. |

Which variables the new deploy carries cannot be read from this machine (no Netlify CLI, no token); the run below is the evidence.

### Staging journey, eighth attempt (09:27:26 to 09:30:31 UTC, learner 144, headed Chromium, diagnostic OFF): passed

A real, un-routed browser upload: `STAGING_UPLOAD_DIAG` was not set, so the journey's PUT went from the page straight to the storage service. Same command and configuration as the sixth attempt (`--trace on`). Playwright: **1 passed**, the test 2.3 minutes, the whole command 2.8 minutes, exit 0, no retry.

| Step | Result | Time |
| --- | --- | --- |
| Sign in through the form (Load Learner 144) | passed | 8 s |
| Enrol: choose the cohort, reach the order page | passed | 3 s |
| Pay: staff confirm the manual payment; `run-task drain-domain-events --target staging` | passed | 42 s |
| Learn: open the course | passed | 6 s |
| Learn: complete both reading lessons | passed | 4 s |
| Attend: staff mark the learner present | passed | 4 s |
| **Submit: upload the assignment** | **passed**: the receipt "Submitted — receipt" appeared | 7 s |
| Grade and release | passed | 6 s |
| Complete: background work drained until the certificate is on the dashboard | passed | 45 s |
| Certificate download through a short-lived link | passed | 6 s |
| Public verification ("This certificate is valid.") | passed | 3 s |

From the trace (no link was printed or written; only names, statuses and the length of one part were read):

| Fact | Value |
| --- | --- |
| Upload: `PUT` to the storage service at 09:29:19.470 UTC | **status 200**, request `content-type: text/plain`, `Access-Control-Allow-Origin` present on the answer |
| Access key id part of `X-Amz-Credential` in the upload link | **length 32** (it was 0 in the sixth attempt); scope `.../auto/s3/aws4_request` |
| Upload link parameter names | the same eight as before, no checksum parameter |
| Certificate download route at 09:30:16.570 UTC | 302 to a presigned link |
| Presigned `GET` at 09:30:20.115 UTC | 200; the test asserted `application/pdf` and the `%PDF-` file header; access key id length 32 |

One oddity, not looked into: the trace's entry for the upload carries status 200 and also the failure text `net::ERR_ABORTED`. The step is counted as passed on the page's own evidence: the receipt appears only after the server has verified the stored file, and grading and completion depend on that submission.

### What it means

- **The storage keys now reach the preview's functions, belong together and may read and write the bucket.** That closes the three things the third session listed as "still not tested" for the preview: the secret matches the key (a wrong one would have answered `SignatureDoesNotMatch`), and the token can write (the upload) and read (the server's check of the stored file, the certificate download).
- **Upload, grade, completion, certificate download and public verification have now each been reached and passed on the preview, once.**
- Which request wrote the certificate PDF to storage was not traced. The task runner on this machine had no `S3_*` variables in its environment (names checked, values not read), so the write is taken to have been made by the preview's own functions. That is an inference.
- The cause of the fault is confirmed by the fix: nothing changed between the seventh attempt (09:06 UTC, failed) and the eighth (09:27 UTC, passed) except the owner's Netlify settings and a new deploy of the same commit. No code change was needed.
- **Not shown by this run:** anything about the Production context (open item f), and it is one run by a test, not a person's unassisted journey (open item b).
- The diagnostic was not needed and was not run in this session. It stays in `e2e/support/upload-diagnostic.ts`, off by default.

No load was run and nothing was re-measured in this session.

## Task 3: the full run (07:26 to 07:39 UTC)

One run, not repeated. Same target as the pilot: the preview at commit `9a68b7a` (still the head of `LAUNCH` on GitHub right after the run) and Neon branch `staging-phase 15`. Before the run the Neon API again confirmed that the pooled URL, the direct URL and both allow-listed hosts belong to that branch and that it is not the default branch. The session tokens from the seed were still valid (six of the 160 accounts checked, all 200), so nothing was re-seeded. A previous executor for this task stopped on a network error before starting anything: no full-run file existed in `perf/results/` or in the evidence folder, so this run started fresh and is the only one.

### Order of events

| Time (UTC) | Event |
| --- | --- |
| 07:11:56 | Last request from this machine (token and health check) |
| 07:23:02 to 07:25:10 | Cold pass: 5 probe samples per view, after 10 min 55 s without a request from this machine |
| 07:26:06 | Connection sampling starts (every 15 s, 61 samples, to 07:41:03) |
| 07:26:11 | First k6 request; learners ramp to 150 over 2 minutes, 10 staff from the start |
| 07:28:09 to 07:35:41 | Browser probe, 30 samples per view, inside the hold (07:28:11 to 07:38:11) |
| 07:39:09 | Last k6 request; k6 exit 0 |

A watcher read k6's output every 15 seconds, ready to stop the run on a failure rate over 20 percent for a minute or on 429 answers. It never fired: every reading showed 0 failures, no 429, no 5xx, and the laptop's internet link was up at every reading. The run was not cut short and is valid.

### k6 at 150 learners and 10 staff

- **10,599 requests, 0 failed (0.00 percent). All 10,599 answered 200. 31,797 of 31,797 checks passed. All 13 page thresholds, the failure threshold and the checks threshold passed. k6 exit 0.**
- 160 virtual users at peak, about 900 requests a minute during the hold, 399 MB received, 1,281 journeys completed.
- All requests: median 566 ms, p75 716 ms, p90 1,031 ms, **p95 1,446 ms**, p99 2,572 ms, slowest 7,739 ms. 120 requests (1.1 percent) took longer than 2.5 s; none took longer than 10 s.

| Page | Requests | p75 (ms) | Against 2,500 ms | p95 (ms) | Slowest (ms) | Over 2.5 s |
| --- | --- | --- | --- | --- | --- | --- |
| dashboard | 1,265 | 751 | pass | 1,710 | 7,447 | 23 |
| learn | 1,265 | 640 | pass | 1,209 | 5,813 | 12 |
| course-home | 1,265 | 792 | pass | 1,533 | 7,739 | 19 |
| lesson | 2,496 | 658 | pass | 1,357 | 7,143 | 28 |
| results | 1,220 | 606 | pass | 1,303 | 6,936 | 10 |
| sessions | 1,204 | 708 | pass | 1,374 | 5,641 | 12 |
| support | 1,184 | 710 | pass | 1,360 | 6,498 | 7 |
| staff-overview | 118 | 881 | pass | 1,736 | 3,666 | 2 |
| staff-cohorts | 118 | 752 | pass | 1,518 | 3,886 | 1 |
| staff-cohort | 118 | 967 | pass | 1,774 | 4,148 | 1 |
| staff-grading | 118 | 747 | pass | 1,201 | 3,248 | 1 |
| staff-support | 116 | 716 | pass | 1,410 | 2,353 | 0 |
| staff-payments | 112 | 1,313 | pass | 2,263 | 6,926 | 4 |

p75 values are k6's own; p95 values are nearest-rank over the per-request output. The staff pages now have 112 to 118 requests each, so their percentiles mean something (the pilot had 3 or 4).

**Where the slow requests were (ledger A16).** The five slowest requests per page are in `evidence/staging-load.json`. They cluster in two short spells:

- **07:28:22 to 07:28:32,** the first seconds of the hold, when the load had just reached 160 users and the two probe browsers had just opened: 56 of the 120 slow requests fall in that minute, with single requests of 5.6 to 7.7 s on most pages. In that minute the p75 over all pages was 1,148 ms and the p95 2,690 ms.
- **07:37:51 to 07:37:53,** two seconds late in the hold: a handful of requests of 5 to 6 s on dashboard, learn, course-home, results and sessions.

Outside those spells the per-minute p95 was between 865 and 1,880 ms. The cause was not established: the preview's server log cannot be read from this machine. New function instances starting is the likely cause of the first spell (it matches the pilot's pattern); the second has no explanation here. No request came near a function time limit: the slowest took 7.7 s and nothing failed or timed out.

### Database connections (ledger P-10)

61 samples every 15 s from before the load to after it. **Peak 46 rows in `pg_stat_activity`, 39 client backends, 2 active.** The count rose with the ramp (9, then 20, 25, 35) and stayed between 35 and 39 for the hold. Taking off Neon's 3 internal sessions and the sampler, the pooler held about 35 Postgres connections at most for 160 virtual users and two probe browsers. The server allows 901. No pool timeout was seen and no request failed. The count stayed at 35 or 36 for the two minutes sampled after the load ended, so the pooler keeps its connections open for a while. A 15-second sample can miss a shorter peak.

### Browser probe under the full load

30 samples per view (1 in a fresh browser context, 29 warm), Chromium, Regular 4G, taken between 07:28:09 and 07:35:41, all inside the hold.

**12 of 13 views measured, 12 of 12 within 2,500 ms. Highest warm p75: 928 ms (staff-payments). Highest warm p95: 1,030 ms (staff-grading).**

| View | Warm p75 (ms) | At most 2,500 ms | Warm p95 (ms) | Fresh context under load (ms) | Cold pass, first sample (ms) |
| --- | --- | --- | --- | --- | --- |
| dashboard | 756 | yes | 813 | 1,438 | 2,392 |
| learn | 749 | yes | 827 | 1,389 | 1,742 |
| course-home | 780 | yes | 951 | 6,854 | 2,191 |
| **lesson** | **not measured under load** | **not signed** | not measured | not measured | 1,560 |
| results | 477 | yes | 837 | 1,455 | 1,319 |
| sessions | 497 | yes | 647 | 1,265 | 1,570 |
| support | 539 | yes | 570 | 1,115 | 1,430 |
| staff-overview | 782 | yes | 865 | 1,286 | 1,607 |
| staff-cohorts | 577 | yes | 977 | 6,710 | 1,226 |
| staff-cohort | 835 | yes | 1,002 | 1,464 | 1,633 |
| staff-grading | 765 | yes | 1,030 | 1,633 | 1,367 |
| staff-support | 548 | yes | 864 | 1,533 | 2,401 |
| staff-payments | 928 | yes | 1,001 | 1,805 | 1,608 |

The two "fresh context under load" values near 6.8 s (course-home and staff-cohorts) are the first page load of each browser process, just after 07:28:09: the same seconds as k6's first slow spell. A first visit at the moment the load arrives can take about 7 s; the 29 warm samples that followed were normal.

**The lesson view: a gap, caused by this run's own harness.** The probe ran as two browser processes (see deviation 12). Both use the same Playwright artifacts folder. The staff process finished at 07:35:36 and cleaned that folder while the learner process was on its last view, lesson. The lesson test then ended with a file-not-found error from Playwright's trace recorder, before it wrote its samples. The page did not fail; the samples were lost. What exists for the lesson view instead, none of it the signed browser number:

- k6 under the full load: 2,496 requests, p75 658 ms, p95 1,357 ms, 0 failed (the most requested page in the run).
- The cold pass: 1,560 ms first sample, then 470 to 742 ms.
- 30 samples with **no load**, taken at 07:41 to 07:42 after the run, with the unchanged one-process method: warm p75 680 ms, p95 839 ms, first sample 2,050 ms. Stored under `supplementary.lessonNoLoad` in the probe evidence, marked as not under load.

The run was not repeated to fill this in (one run; more load needs a new owner approval). **Item for plan 15-31:** either record a waiver for the lesson view's browser number, resting on the three figures above, or re-measure that one view under load with a new owner approval.

### Cold samples

Taken at 07:23:02 after 10 min 55 s with no request from this machine; 5 samples per view (the first in a fresh browser context). First samples ran from 1,226 ms to 2,401 ms; the first view of the pass (dashboard) took 2,392 ms.

**These are probably not true cold starts.** The uptime monitor requests `/api/health` every 5 minutes, so the preview is never idle for 10 minutes, and the Neon endpoint's last-active time was one minute old when checked at 07:11. Read them as a first visit in a fresh browser after a quiet spell. The slowest first visits seen today were under load (about 6.8 s, above) and in the pilot (6.5 s for the first view).

### Uptime monitor (NFR-01)

The UptimeRobot record could not be read from this machine (no login or API key). From this machine: `/api/health` answered 200 before the run (07:11) and after it (07:41), and all 10,599 requests in between answered 200. The owner reads the monitor's log for 07:26 to 07:39 UTC.

### Usage of the full run

| Item | Estimate before | Actual |
| --- | --- | --- |
| Requests from k6 | about 9,600 | 10,599 |
| Data from k6 | about 370 MB | 399 MB |
| Function time | about 3 hours in total | about 2 hours in total (10,599 requests at 695 ms on average) |
| Browser page loads | 390, plus 65 cold | 390 under load (30 of them lost for lesson), 65 cold, 30 for lesson with no load |
| Neon compute, staging branch | at most 0.43 compute-unit hours | not readable yet |

- **Netlify usage could not be read** (no Netlify CLI and no token). The owner reads Team usage in the Netlify dashboard. Nothing during or after the run suggested the site was paused or rate limited.
- **Neon:** the API's counters were identical before (07:11) and after (07:41) the run; they are updated with a delay, so this run's compute cannot be read yet. For scale: the staging branch's counter went from 689 compute seconds at 05:06 to 2,730 at 07:11 (the pilot, the journey attempts and two hours of being kept awake). The project counter stood at 244,631 compute seconds (68.0 compute-unit hours since 1 October) at both reads.

## Usage of the pilot, and the estimate made for the full run

| Item | Pilot | Full run (estimate) |
| --- | --- | --- |
| Requests to the preview from k6 | 342 | about 9,600 (the local full run made 9,603) |
| Data from k6 | 13 MB | about 370 MB |
| Function time | about 6 minutes in total (342 requests at 1.07 s on average) | about 3 hours in total |
| Browser probe | 65 page loads with their assets | 390 page loads, plus 65 cold samples |
| Neon compute, staging branch | not readable yet (see below) | at most 0.43 compute-unit hours (13 minutes at the 2-unit ceiling) |

- **The full run is about 28 times the pilot, not 10 times:** ten times the users for about three times as long (12.5 minutes against 3.75).
- **Netlify usage could not be read from this machine** (no Netlify CLI and no token). The owner reads Team usage in the Netlify dashboard and compares it with the figures above.
- **Neon:** the API's counters did not move between 05:06 and 05:34 (they are updated with a delay), so the pilot's compute cannot be read yet. The staging endpoint scales between 0.25 and 2 compute units, so the whole 28 minutes cost between 0.12 and 0.93 compute-unit hours.
- **A Neon finding that matters more than the load test:** the project (production and staging together) had used **240,544 compute seconds, which is 66.8 compute-unit hours, between 1 and 11 October**, with 244.7 hours of active time. That is a database that never sleeps (about 6.5 compute-unit hours a day, about 200 a month), as 15-STAGING.md warned. The owner should compare this with the Free plan's monthly allowance in the Neon console now; if the allowance is 100 compute-unit hours, it is reached around 16 October, and what Neon does then (suspend the compute) would affect production. This is not caused by the pilot.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The k6 script had no pilot mode**
- The plan runs "k6 pilot-load with PILOT=1"; `perf/pilot-load.js` only had SMOKE and the full load. Added `PILOT=1` (15 learners, 1 staff, 30 s ramp, 3 min hold, 15 s ramp down, the full run's think time) in `perf/pilot-load.js` and `perf/lib/config.js`. Both files are outside the plan's file list. The full-load numbers are unchanged.

**2. [Rule 3 - Blocking] The Playwright configuration cannot run against the preview**
- `e2e/playwright.config.ts` starts a local server and refuses any database that is not local as soon as it loads. Added `e2e/playwright.staging.config.ts` (starts no server, accepts only a Netlify deploy-preview address, longer waits for cold starts) and `e2e/support/staging-setup.ts` (makes the journey course on staging only with `STAGING_JOURNEY=1`, forces the email stub for tasks). Both are outside the plan's file list. The local configuration is untouched.

**3. [Rule 3 - Blocking] The journey course did not exist on staging**
- `e2e/support/journey-fixtures.ts` (outside the plan's file list) now takes a target: with `staging` it runs the guard for staging, skips the local MinIO bucket and writes its ids to `test-results/journey-fixtures-staging.json`. Default behaviour is unchanged. Running it added the "Journey Verification Course", its cohort, session and assignment to the staging branch.

**4. [Rule 3 - Blocking] Staff sign-in on staging**
- The local journey signs in as the seeded finance and instructor accounts with the development password, which plan 15-29 removed. The staging journey uses one load staff account (Administrator role) for the staff steps.

**5. [Rule 1 - Bug, in the new test] First assertion of the staging journey** (described above); corrected.

### Other deviations

**6. Quiet resend waits 65 seconds before the sign-in.** The plan says register, then sign in; the resend's 60-second cooldown would refuse a new token that soon, whatever `after()` does. The count is still read 10 seconds after the sign-in response, as the plan says.

**7. `e2e/journey.spec.ts` was refactored, not only extended.** The steps after sign-in moved into one shared function used by "full journey" and "staging journey". `tsc --noEmit` and ESLint are clean. The local "full journey" was re-run once in the close-out session and passed (see "Close-out session").

**8. `staging-checks connections` records three counts** (all rows, client backends, active client backends) instead of the single `count(*)` the plan names, and needs `--out PATH`. The plain `count(*)` is the `total` field.

**9. The probe ran after the k6 pilot, not during it,** so its numbers carry no background load.

**10. Evidence has more fields than the plan lists** (`target`, `journey`, `connections`, `usage`); the plan's fields are present with the plan's names.

**11. Not measured in Task 1:** the Netlify synchronous function timeout (ledger A16) and the uptime monitor's record; both belong to the full run.

### Deviations in Task 3

**12. The probe ran as two browser processes side by side, not one.** The cold pass took 2.1 minutes for 65 samples, which put one serial pass of 390 samples at about 12.5 minutes, longer than the 10-minute hold, so the last views would have been measured with no load. The 7 learner views and the 6 staff views ran in two headed Chromium processes with the same seed; everything else in the probe's method is unchanged. All 360 recorded samples fell inside the hold. **This deviation caused the lesson gap** (shared artifacts folder, described above). In the event each process needed 7.5 minutes for its half, so one process would have needed about 14 minutes.

**13. The probe wrote to `perf/results/` and the evidence files were composed afterwards,** not written straight to the evidence paths. `staging-load.json` is k6's summary export with the added fields; `staging-probe.json` merges the two probe files and the cold pass.

**14. k6 ran with two extra command-line options:** `--summary-trend-stats` (so the export carries p75 and p99) and `--out json` (per-request output for the slowest requests and the watcher). The script and the load are unchanged.

**15. "5 cold samples per view" is one pass with `PROBE_SAMPLES=5`:** one fresh-context sample and four that follow it, per view. Only the first is cold in the browser sense, and see the limitation above about the monitor.

**16. Evidence has more fields than the plan lists** (owner decision, per-minute table, usage, gaps, supplementary lesson measurement). The plan's fields (`metrics`, `connections`, `slowest`, `views` with `cold`) are present with the plan's names.

**17. The usage check before approval was not done with numbers** (see the owner decision above).

**18. A lesson-only probe with no load (30 page loads) was run after the load ended,** as supplementary data. It is not in the plan and is not counted as the signed number.

No file outside the plan's list was changed in Task 3. Scratch scripts for the run (watcher, analysis, evidence composer) are in the session's temporary folder, not in the repository.

### Deviations in the close-out session

**19. `deferred-items.md` (outside the plan's file list) got one new row** for the upload fault.

**20. Three diagnostic requests beyond the preflight were sent to the bucket:** a PUT with no signature for each of the three origins, to see whether error answers carry CORS headers. Storage refused all three (400), so nothing was written.

**21. One diagnostic was not run:** replaying the browser's own upload request outside the browser, to read the storage service's answer. It was not permitted in this session, so the cause stays "probable".

**22. The local journey ran headed** and against the existing production build of 10 October instead of a fresh build; no source file is newer than that build.

**23. The broken-windows ledger (`.planning/WINDOWS.md`) was not updated:** this session was limited to four named state commands. The open items are in this file and in `deferred-items.md`.

No repository file other than this summary, `evidence/staging-pilot.json` and `deferred-items.md` was changed in the close-out session.

### Deviations in the second close-out session

**24. `15-STAGING.md` and `deferred-items.md` (both outside the plan's file list) were edited:** the Preview section now names the commit served (`9be7af3`) against the commit the load run measured (`9a68b7a`) and notes the open upload fault; the upload row in `deferred-items.md` carries the fix and its result.

**25. The journey ran with `--trace on`** (the configuration keeps a trace only on failure), so that the upload link's parameter names could be read on a passing run. The run failed, so a trace would have been kept anyway. The trace is in the git-ignored `test-results/` folder and contains the upload link, which expired 15 minutes after it was issued.

**26. One diagnostic request beyond the journey was sent to the bucket:** a CORS preflight (OPTIONS, no credentials, writes nothing) to the address of the failed upload. It answered 204.

**27. The upload request was not replayed outside the browser,** so the storage service's real answer is still unread.

**28. No state command was run** (`state.record-metric`, `state.add-decision`, `state.record-session`, `roadmap.update-plan-progress`): they were allowed only if the plan were marked complete, and it is not. `.planning/WINDOWS.md` was not updated, as in deviation 23.

**29. `actuals.tokens` in the front matter was not recomputed;** this session changed four planning files and no code.

No repository file other than this summary, `evidence/staging-pilot.json`, `deferred-items.md` and `15-STAGING.md` was changed in the second close-out session. Nothing was committed.

### Deviations in the upload diagnostic session

**30. A diagnostic was added to the test files:** `e2e/support/upload-diagnostic.ts` (new, outside the plan's file list) and one call in `e2e/journey.spec.ts`. Off unless `STAGING_UPLOAD_DIAG=1`. Authorised by the owner through the orchestrator.

### Deviations in the third close-out session

**31. `15-STAGING.md` and `deferred-items.md` (outside the plan's file list) were edited again** with the outcome of the two runs.

**32. The sixth attempt ran with `--trace on`,** as the fourth did. The trace is in the git-ignored `test-results/` folder; the seventh attempt's trace has since replaced it there. It held the upload link, which expired 15 minutes after it was issued.

**33. One fact was read from the link in the trace: the length of the access key id** (0). No value from the link was printed or written.

**34. No state command was run** and `.planning/WINDOWS.md` was not updated: the plan is not complete. `actuals.tokens` was not recomputed.

**35. The plan was not finalised,** so the older decisions in the front matter were kept as history; the one that said "cause not established" now carries a note that it is superseded.

No repository file other than this summary, `evidence/staging-pilot.json`, `deferred-items.md` and `15-STAGING.md` was changed in the third close-out session. Nothing was committed.

### Deviations in the fourth close-out session

**36. `15-STAGING.md` and `deferred-items.md` (outside the plan's file list) were edited again** with the passing run. In `15-STAGING.md` the old "open owner item" about test keys also got a note that the owner's confirmation cleared it.

**37. The eighth attempt ran with `--trace on`,** as the fourth and sixth did. The trace is in the git-ignored `test-results/` folder and holds the upload link and the certificate link, both expired 15 minutes after they were issued. A copy extracted to the session's temporary folder was deleted.

**38. Facts read from the links in the trace:** the length of the access key id (32), the parameter names and the statuses. No value from a link was printed or written.

**39. The plan is marked complete although Task 3's automated check exits 1 and the Task 3 human check is not done.** This follows the orchestrator's instruction for this session: complete once the journey passes, with the gaps listed at the top as open items for plan 15-31. `requirements-completed` stays empty.

**40. State commands:** see "State updates" under "Verification run" for which were run. `state.advance-plan`, `state.update-progress` and `requirements.mark-complete` were not run (not permitted in this session). `.planning/WINDOWS.md` was not updated, as in deviation 23; the unrun human check and the failing Task 3 check are recorded here instead.

**41. `actuals.tokens` is an approximation:** the earlier figure (30,100) plus a quarter of the characters added since (the diagnostic file, the one call in the journey test, and the growth of `evidence/staging-pilot.json`). Most of this plan's files were already in the owner's commits, so the realized diff could not be measured in one piece. `actuals.tasks: 3` counts Task 1 (done), Task 2 (decided) and Task 3 (run, with the lesson gap and without the human check).

**42. `requirements-completed` is empty** by instruction: NFR-02 has the lesson gap, D-08 has no manual journey, and NFR-01 and NFR-08 are signed in plan 15-31.

No repository file other than this summary, `evidence/staging-pilot.json`, `deferred-items.md`, `15-STAGING.md` and the planning state files named under "State updates" was changed in the fourth close-out session. No file under `src/` or `e2e/` was touched. Nothing was committed.

## Data left on the staging branch by this run

- The journey course, cohort, session and assignment.
- Load Learner 144 (fourth close-out session): a paid order, an active enrolment on the journey cohort that is now complete, two lessons complete, attendance marked, one submission with a stored file, a released grade of 80, a completion record and an issued certificate with its PDF in the storage bucket. The staging counts in `15-STAGING.md` (Grade 2, CompletionRecord 3, Certificate 3) are therefore each one higher now.
- Load Learners 145 and 146 (third close-out session) and 147 (upload diagnostic session): each a paid order and an active enrolment on the journey cohort, two lessons complete, attendance marked, no submission. Possibly an upload record each that was started and never completed.
- Load Learner 148 (second close-out session): a paid order and an active enrolment on the journey cohort, two lessons complete, attendance marked, no submission. Possibly an upload record that was started and never completed.
- Load Learner 149 (close-out session): a paid order and an active enrolment on the journey cohort, two lessons complete, attendance marked, no submission. Possibly an upload record that was started and never completed.
- Load Learner 150: a paid order and an active enrolment on the journey cohort, two lessons complete, attendance marked. This learner's dashboard now shows two courses, which is a small change for one of the 150 virtual users in the full run.
- One unverified account `quiet-resend-...@journey.test` with two verification tokens.
- Three extra sessions for two load accounts (signing in does not end the sessions k6 uses).

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema change. `staging-checks.ts` only reads, behind the guard, and prints neither the address it is given nor any host.

## Verification run

| Command | Result |
| --- | --- |
| `npx vitest run tests/staging-checks.test.ts` | 1 file, 13 tests passed |
| Plan's node check on `evidence/staging-pilot.json` | **exit 1** ("staging pilot failing"): `journeyPassed` is false; `quietResend` 1 to 2 and k6 failure rate 0 are fine |
| `npx tsc --noEmit` | clean |
| ESLint on the six new or edited TypeScript files | clean |
| Secret scan while writing the evidence (connection string, Neon host, API key, storage host, signed-link and session patterns, the load password and tokens) | no match |
| k6 full run | exit 0, all 15 thresholds passed |
| Plan's Task 3 node check on `staging-load.json` and `staging-probe.json` | **exit 1** ("staging evidence incomplete"): the probe evidence lists 12 views, not 13 (lesson). `metrics`, `connections`, `slowest` and `cold` on every listed view are present |
| Secret scan of the two new evidence files (the load password, all 160 session tokens, connection string, Neon host, API key, storage host, signed-link and cookie patterns, record ids in paths) | no match |
| Task 3 human check (unassisted manual journey, D-08) | **not done** |

Close-out session (2026-10-11, 07:48 to 07:56 UTC):

| Command | Result |
| --- | --- |
| CORS preflight to the bucket for the preview origin | 204, `Access-Control-Allow-Origin` is the preview origin, method PUT, header content-type |
| Staging journey, headed Chromium, learner 149 | **1 failed** at "submit: the learner uploads the assignment" (1.4 min) |
| Local "full journey", headed Chromium, local database and MinIO | 1 passed (34.3 s) |
| `npx vitest run tests/staging-checks.test.ts` | 1 file, 13 tests passed |
| Plan's Task 1 node check on `evidence/staging-pilot.json` | **exit 1** ("staging pilot failing"): `journeyPassed` is still false |
| Plan's Task 3 node check on `staging-load.json` and `staging-probe.json` | **exit 1** ("staging evidence incomplete"): still 12 views, lesson missing. Nothing was re-measured and no load was run in this session. |
| Secret scan of `evidence/staging-pilot.json` after the edit (Neon host, storage host, signed-link parts, connection string) | no match |

Second close-out session (2026-10-11, 08:34 to 08:39 UTC):

| Command | Result |
| --- | --- |
| `gh pr view 16 --json headRefOid` | `9be7af3...`, branch `LAUNCH` |
| `gh pr checks 16` | Netlify deploy-preview, Header rules and Redirect rules pass; Integration tests shards 2 and 4 failed (not read) |
| `/api/health` on the preview | 200 |
| Neon API host check | pooled URL, direct URL and both allow-listed hosts on `br-icy-river-axqpwts7`, not the default branch |
| Staging journey, headed Chromium, learner 148 | **1 failed** at "submit: the learner uploads the assignment" (1.3 min) |
| Upload link in the trace | no checksum parameter (fix deployed) |
| CORS preflight to the failed upload's address, preview origin | 204, PUT, content-type |
| `npx vitest run tests/staging-checks.test.ts` | 1 file, 13 tests passed |
| Plan's Task 1 node check on `evidence/staging-pilot.json` | **exit 1** ("staging pilot failing"): `journeyPassed` is still false |
| Plan's Task 3 node check on `staging-load.json` and `staging-probe.json` | **exit 1** ("staging evidence incomplete"): still 12 views, lesson missing. No load was run and nothing was re-measured in this session. |
| Secret scan of `evidence/staging-pilot.json`, `deferred-items.md`, `15-STAGING.md` and this file after the edits (Neon host, storage host, signed-link values, connection string) | no match |

Upload diagnostic session (2026-10-11, 08:46 to 08:49 UTC):

| Command | Result |
| --- | --- |
| `gh pr view 16`, `/api/health`, Neon API host check | head `9be7af3`; 200; all hosts on `br-icy-river-axqpwts7`, not the default branch |
| `npx tsc --noEmit` after adding the diagnostic | clean |
| Staging journey, headed Chromium, learner 147, `STAGING_UPLOAD_DIAG=1` | **1 failed** at "submit: the learner uploads the assignment" (1.8 min); PUT answered 400 `InvalidArgument` |
| ESLint on `e2e/support/upload-diagnostic.ts` and `e2e/journey.spec.ts` | clean |
| `evidence/staging-pilot.json` parses; 5 attempts; `journeyPassed` | false |
| Secret scan of the diagnostic's output file, the two e2e files, `deferred-items.md`, `evidence/staging-pilot.json` and this file (storage host, Neon host, connection string, signed-link values, 32-character hex strings) | no secret; the only 32-character hex matches are the commit hash `9be7af3...` and k6's own check ids, both there before |

Third close-out session (2026-10-11, 09:01 to 09:08 UTC):

| Command | Result |
| --- | --- |
| `gh pr view 16`, `gh pr checks 16`, commit statuses | head `9be7af3`; Netlify deploy-preview pass, new "Deploy Preview ready!" at 09:00:47 UTC. Not part of this plan: "Integration tests" shards 2 and 4 and "Unit and component tests" show as failed on that commit (not read). |
| `/api/health`; Neon API host check | 200; all hosts on `br-icy-river-axqpwts7`, not the default branch |
| Staging journey, headed Chromium, learner 146, diagnostic off | **1 failed** at "submit: the learner uploads the assignment" (1.4 min); access key id in the link has length 0 |
| Staging journey, headed Chromium, learner 145, `STAGING_UPLOAD_DIAG=1` | **1 failed** at the same step (1.4 min); PUT answered 400 `InvalidArgument`, "Credential access key has length 0, should be 32" |
| `npx vitest run tests/staging-checks.test.ts` | 1 file, 13 tests passed |
| Plan's Task 1 node check on `evidence/staging-pilot.json` | **exit 1** ("staging pilot failing"): `journeyPassed` is still false |
| Plan's Task 3 node check on `staging-load.json` and `staging-probe.json` | **exit 1** ("staging evidence incomplete"): still 12 views, lesson missing. No load was run and nothing was re-measured. |
| `evidence/staging-pilot.json` parses; 7 attempts; `journeyPassed` | false |
| Secret scan of this file, `15-STAGING.md`, `deferred-items.md`, `evidence/staging-pilot.json`, the two e2e files and the diagnostic's output (the staging host names, the Neon key and project id as literals; connection string, Neon host, storage host and signed-link patterns) | no match |

Fourth close-out session (2026-10-11, 09:26 to 09:33 UTC):

| Command | Result |
| --- | --- |
| `gh pr view 16`, `gh pr checks 16`, commit statuses | head `9be7af3`; Netlify deploy-preview pass, new "Deploy Preview ready!" at 09:24:07 UTC. Not part of this plan: "Integration tests" shards 2 and 4 and "Unit and component tests" fail on that commit. |
| `/api/health`; Neon API host check | 200; all hosts on `br-icy-river-axqpwts7`, not the default branch |
| Staging journey, headed Chromium, learner 144, diagnostic off | **1 passed** (2.3 min); upload PUT 200, access key id in the link has length 32; certificate download 302 then 200 |
| `npx vitest run tests/staging-checks.test.ts` | 1 file, 13 tests passed |
| Plan's Task 1 node check on `evidence/staging-pilot.json` | **exit 0**: `journeyPassed` true, `quietResend` 1 to 2, k6 failure rate 0 |
| `evidence/staging-pilot.json` parses; 8 attempts; `journeyPassed` | true |
| Plan's Task 3 node check on `staging-load.json` and `staging-probe.json` | **exit 1** ("staging evidence incomplete"): still 12 views, lesson missing. No load was run and nothing was re-measured. Open item a. |
| Task 3 human check (unassisted manual journey, D-08) | **not done.** Open item b. |
| Secret scan after the edits | no match (details under "State updates" below) |

### State updates

Run because the plan is marked complete, and only these four:

| Command | Result |
| --- | --- |
| `state.record-metric` (phase 15, plan 30, 195 min, 3 tasks, 12 files) | recorded |
| `state.add-decision`, three decisions | all three recorded. The third failed once with a Windows file error (`EPERM` on renaming the temporary state file) and was recorded on a second try; no temporary file was left behind. |
| `state.record-session` | recorded: stopped at "Completed 15-30-PLAN.md ...", resume file none |
| `roadmap.update-plan-progress 15` | Phase 15 now 32 of 33 plans, still "In Progress"; the 15-30 line in `ROADMAP.md` is ticked |

Side effects seen in `STATE.md`, compared with a copy taken before: `completed_plans` went from 257 to 258 (of 259) and `state_head` moved to `9be7af3`. The count was left as it is: it matches this plan being marked complete, with only 15-31 left. If the orchestrator would rather not count 15-30 until its open items close, set it back to 257 and untick the line in `ROADMAP.md`.

Not run: `state.advance-plan`, `state.update-progress`, `state.begin-phase`, `requirements.mark-complete`, `gsd_run query commit`.

Secret scan of this file, `15-STAGING.md`, `deferred-items.md`, `evidence/staging-pilot.json`, `STATE.md` and `ROADMAP.md` after the edits (the staging host names, the Neon key and project id and the load password as literals; connection string, Neon host, storage host and signed-link patterns): no match.

## Cleanup

Fourth close-out session: no container and no server was started; Playwright closed its browsers; `learning-management-system-postgres-1` is still running and was not touched. The extracted copy of the eighth attempt's trace in the session's temporary folder was deleted; Playwright's own `trace.zip` remains in the git-ignored `test-results/`. `perf/results/upload-diag-staging.json` still holds the seventh attempt's record (the diagnostic did not run in this session).

Third close-out session: no container and no server was started; Playwright closed its browsers; `learning-management-system-postgres-1` is still running and was not touched. The extracted copy of the sixth attempt's trace in the session's temporary folder was deleted. The diagnostic's record of the seventh attempt is in the git-ignored `perf/results/upload-diag-staging.json`.

Upload diagnostic session: no container and no server was started; Playwright closed its browsers; `learning-management-system-postgres-1` was not touched. The diagnostic's record is in the git-ignored `perf/results/upload-diag-staging.json` (names, status, code and message only). Playwright's `trace.zip` for the failed run remains in the git-ignored `test-results/`. The diagnostic stays in `e2e/`, off by default.

Second close-out session: no container and no server was started; Playwright closed its browsers. `learning-management-system-postgres-1` was not touched. The extracted copy of the trace in the session's temporary folder was deleted; Playwright's own `trace.zip` remains in the git-ignored `test-results/`.

Close-out session: the MinIO container `journey-minio` was removed; Playwright stopped the local server (3010) and the capture server (4010) itself and neither port is listening; the browsers are closed. `learning-management-system-postgres-1` is still running. The local run added one learner with an order, enrolment, submission, grade and certificate to the local `licence_test` database.

Task 3: the k6 container removed itself (checked with `docker ps`), the connection sampler and the watcher ended by themselves, the browsers are closed. Raw results of the full run are in the git-ignored `perf/results/` (`k6-staging-full*`, `probe-staging-*`, `connections-staging-full.json`, `neon-staging-full-*.json`); the per-request file is about 50 MB. The full run added nothing to the staging database (k6 and the probe only read pages).

Task 1: the k6 container removed itself; no local server was started; the browsers are closed. The project's own `learning-management-system-postgres-1` container was running before and was not touched. Raw results (k6 log and points, probe file, connection samples, traces) are in the git-ignored `perf/results/` and `test-results/`.

## Open items for the owner

1. Task 2 is decided: "Run the full test".
2. The bucket's CORS setting is done and checked (preflight 204 for the preview's address). Thank you; nothing more to do there.
3. **Uploads on the preview work now.** Your saved storage keys and the new deploy fixed it: the upload answered 200 at 09:29 UTC and the whole journey passed. Nothing more to do for the preview.
4. **Check that the Production context in Netlify has `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` too** (scope Functions), and try one upload on the live site after its next deploy. This has not been verified from here.
5. **Check the Neon compute allowance now** (68.0 compute-unit hours used by 11 October, 07:11 UTC).
6. **Read Netlify Team usage now, after the full run;** it cannot be read from here, and it was not read before the run.
7. Read the UptimeRobot log for 07:26 to 07:39 UTC on 2026-10-11.
8. Ask a person who has not used the product to do the unassisted manual journey on the preview (`e2e/MANUAL-CHECKS.md`, "Unassisted manual journey (D-08)") and fill in its results table.

## Open items carried out of this plan

The same items as the table at the top of this file, with their detail.

1. **(a) Lesson view, browser number under load** (Task 3): gap, item for plan 15-31 (a recorded waiver resting on the three figures in "Task 3", or one more loaded measurement with a new owner approval). Not re-measured, and no load was run, in any close-out session. **Task 3's automated check still exits 1 because of it.**
2. **(b) Unassisted manual journey (D-08)** on the preview by a person who has not used the product: not done. The upload no longer stands in that person's way.
3. **(c) Owner checks not yet reported back:** Netlify Team usage after the full run, the Neon compute allowance, and the UptimeRobot log for 07:26 to 07:39 UTC (items 5 to 7 in the list above).
4. **(d) The two slow spells** (07:28:22 to 07:28:32 and 07:37:51 to 07:37:53 UTC) have no established cause; plan 15-31 can look at the Netlify function log for those seconds.
5. **(e) The signed load numbers were measured on `9a68b7a`; the preview now serves `9be7af3`.** The storage fix changes only how the S3 client signs requests and does not touch page rendering, so no difference is expected. That is reasoning, not a measurement. The preview has also been redeployed three times since the run (08:33, 09:00 and 09:24 UTC), the last with a cleared cache and new environment variables.
6. **(f) Whether the Production context in Netlify has the storage keys is not verified.** If it does not, uploads and certificate files fail on the live site in the way they failed on the preview.
7. **(g) Suggested hardening, not done here (product code):** `makeClient` in `src/server/services/storage-service.ts` should throw a named error when `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is missing or empty, instead of signing with an empty key. This fault would then have shown on the server as one clear message instead of taking five journey attempts to find.
8. **(h) CI failures on `9be7af3`:** "Integration tests" shards 2 and 4 and "Unit and component tests" fail (seen by this executor in `gh pr checks 16`). The causes below were read from the CI logs by the orchestrator, not by this executor: the workflow starts no MinIO, so the storage tests cannot connect; the unit job's `--exclude` does not keep integration files out; and the known `ticket-phase-invariants` nav test fails (already in `deferred-items.md`, row 15-21). The same failures existed on `9a68b7a`, so they do not come from the storage fix.

Closed: the staging journey (fourth close-out session, eighth attempt); the local "full journey" after the refactor (first close-out session); the bucket's CORS setting; the storage keys on the deploy preview.

## Self-Check: PASSED

- All eight files named under `key-files.created` (the three evidence files among them) exist on disk (checked at the end of the fourth close-out session).
- No commit was made by this plan's executor (owner rule), so there is no commit hash to check; `actuals.commits` is 0. The working tree holds the uncommitted changes.
- Task 1's check exits 0. Task 3's check exits 1 and the human check is not done: both are open items a and b above, not hidden by this "passed".
