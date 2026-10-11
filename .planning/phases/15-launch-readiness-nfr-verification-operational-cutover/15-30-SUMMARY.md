---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 30
subsystem: staging-run-nfr-02
tags: [nfr-01, nfr-02, nfr-03, nfr-08, k6, playwright-probe, staging, netlify, neon, cors]
status: in-progress

requires:
  - "15-29 (staging branch, preview, seeded load, rotated passwords), 15-14 (k6 scripts, seed-load), 15-18 (probe), 15-17 (journey)"
provides:
  - "scripts/ops/staging-checks.ts: guarded read-only staging probes (verification-token count, connection sampling), 13 unit tests"
  - "PILOT=1 mode in the k6 pilot-load script (one tenth of the agreed load)"
  - "e2e/playwright.staging.config.ts and the tests \"staging journey\" and \"staging quiet resend\""
  - "evidence/staging-pilot.json: k6 pilot, probe, quiet-resend, connection samples, journey result"
  - "evidence/staging-load.json: the signed k6 run at 150 learners and 10 staff, with connection samples, slowest requests and the owner's decision"
  - "evidence/staging-probe.json: browser time-to-usable for 12 of 13 views under the full load, with cold samples; the lesson view is a recorded gap"
affects: ["15-31"]

key-files:
  created:
    - scripts/ops/staging-checks.ts
    - tests/staging-checks.test.ts
    - e2e/playwright.staging.config.ts
    - e2e/support/staging-setup.ts
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
  - "The upload failure on the preview was not worked around in the test: the browser's direct upload is the real path, and the fix is a storage CORS setting the owner controls"
  - "The full run's probe used two browser processes side by side (learner views, staff views) so that every sample fell inside the 10-minute hold; one serial pass was estimated at about 12.5 minutes on the preview"
  - "The lesson view's missing browser measurement under load is left as a gap in the evidence (12 views listed, the plan's check fails) instead of being filled with the no-load measurement"
  - "The full run was done once and not repeated; the lesson gap goes to plan 15-31"
  - "After the CORS change the staging journey still fails at the upload; the plan stays in-progress and the upload fault is reported, not worked around in the test and not fixed in product code inside this plan"

requirements-completed: []

actuals:
  tokens: 30100
  tasks: 0
  commits: 0

metrics:
  duration: "about 75 min for Task 1, about 45 min for Task 3 and about 15 min for the close-out session; the staging journey and the human check are still open"
  completed: null
---

# Phase 15 Plan 30: Staging run for NFR-02 (NOT complete: the staging journey still fails at the upload)

**Status: in-progress. The plan is not complete, for three reasons: (1) the staging journey still fails at the assignment upload, after the bucket's CORS setting was corrected, so Task 1's check exits 1; (2) the lesson view has no browser measurement under load, so Task 3's check exits 1; (3) the unassisted manual journey (D-08) has not been done by a person.**

**What does hold: the full staging run (Task 3) was done once on 2026-10-11, 07:26 to 07:39 UTC, at 150 learners and 10 staff: 10,599 requests, none failed, every k6 threshold passed (highest page p75 1,313 ms against 2,500 ms). The browser probe measured 12 of the 13 core views under that load and all 12 passed (highest warm p75 928 ms). In Task 1 the load pilot, the browser probe and the quiet-resend check passed. The local "full journey" passed after the refactor.**

**New finding from the close-out session (07:48 to 07:56 UTC), more important than the journey result itself: uploads to the hosted storage bucket fail for a reason that is not CORS.** The CORS setting is now right (the preflight answers 204 for the preview's address), yet the browser's upload is still refused. The probable cause is in the product's upload link (it carries the checksum of an empty file), which would affect uploads from the production address in the same way. It is not confirmed, and it is not fixed here. See "Close-out session" below.

Nothing is committed (owner rule). No connection string, host name, key, token or password is in this file or in the evidence file.

## Status by task

| Task | Result |
| --- | --- |
| 1. Pilot at one tenth, probe, staging journey, quiet resend | Run. k6 pilot passed, probe passed, quiet resend passed. **Journey failed at "submit" three times out of three: once on the test's own first assertion, once on the bucket's CORS setting (since corrected), and once, after the correction, on the upload itself (probable product fault in the upload link).** Verify command exits 1 because `journeyPassed` is false. |
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

## Data left on the staging branch by this run

- The journey course, cohort, session and assignment.
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

## Cleanup

Close-out session: the MinIO container `journey-minio` was removed; Playwright stopped the local server (3010) and the capture server (4010) itself and neither port is listening; the browsers are closed. `learning-management-system-postgres-1` is still running. The local run added one learner with an order, enrolment, submission, grade and certificate to the local `licence_test` database.

Task 3: the k6 container removed itself (checked with `docker ps`), the connection sampler and the watcher ended by themselves, the browsers are closed. Raw results of the full run are in the git-ignored `perf/results/` (`k6-staging-full*`, `probe-staging-*`, `connections-staging-full.json`, `neon-staging-full-*.json`); the per-request file is about 50 MB. The full run added nothing to the staging database (k6 and the probe only read pages).

Task 1: the k6 container removed itself; no local server was started; the browsers are closed. The project's own `learning-management-system-postgres-1` container was running before and was not touched. Raw results (k6 log and points, probe file, connection samples, traces) are in the git-ignored `perf/results/` and `test-results/`.

## Open items for the owner

1. Task 2 is decided: "Run the full test".
2. The bucket's CORS setting is done and checked (preflight 204 for the preview's address). Thank you; nothing more to do there.
3. **Uploads to hosted storage are refused (new, launch blocker).** Decide who fixes the upload link in `src/server/services/storage-service.ts` and when the preview is rebuilt. First step: read the storage service's real answer to the upload (browser network tab on the preview, or try one upload on the production site).
4. **Check the Neon compute allowance now** (68.0 compute-unit hours used by 11 October, 07:11 UTC).
5. **Read Netlify Team usage now, after the full run;** it cannot be read from here, and it was not read before the run.
6. Read the UptimeRobot log for 07:26 to 07:39 UTC on 2026-10-11.

## Still open in this plan

1. **Staging journey (Task 1): still failing at the upload.** Needs the upload fix deployed to the preview, then one run with `STAGING_JOURNEY_LEARNER=148`. Upload, grade, completion, certificate download and public verification have never been reached on the preview. Task 1's check stays at exit 1 until it passes.
2. **Lesson view, browser number under load** (Task 3): gap, item for plan 15-31 (waiver, or one more loaded measurement with a new owner approval). Not re-measured, and no load was run, in the close-out session. **Task 3's automated check still exits 1 because of it.**
3. **Unassisted manual journey (D-08)** on the preview by a person who has not used the product: not done. That person will meet the same upload failure until item 1 is fixed.
4. The two slow spells (07:28:22 to 07:28:32 and 07:37:51 to 07:37:53) have no established cause; plan 15-31 can look at the Netlify function log for those seconds.

Closed in the close-out session: the local "full journey" was re-run after the refactor and passed.
