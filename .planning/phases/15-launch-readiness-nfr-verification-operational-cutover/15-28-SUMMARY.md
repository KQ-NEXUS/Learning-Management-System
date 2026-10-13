---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 28
subsystem: local-rehearsal-performance-regression
tags: [nfr-02, nfr-03, nfr-08, nfr-09, nfr-10, nfr-12, nfr-13, nfr-14, pg-stat-statements, k6, playwright-probe, regression]
status: complete

provides:
  - "scripts/ops/statement-counts.ts: guarded pg_stat_statements measurement of one page render per URL (assertSafeDatabaseUrl first), with 19 unit tests"
  - "Statement budgets met on the production build: /staff 24 of 25 (was 31), lesson page 19 of 20 (was 39)"
  - "Full local pilot load (150 learners, 10 staff, 2 min ramp, 10 min hold): 9,603 requests, 0 failed, all 13 k6 p75 thresholds passed, with the Playwright probe measuring all 13 views at warm p75 of at most 1,365 ms (budget 2,500)"
  - "Final regression pass on the finished code: journey on Chromium, Firefox and WebKit, axe (85), responsive (36), keyboard (4), export worker (5) and domain event drain (15) integration tests, integrity checks 7 of 7 with zero violations"
  - "Finding: the default Prisma pool (9 connections) was the cause of the first load runs' timeouts; recorded for the staging run (ledger P-10)"

requirements-completed: []

actuals:
  tokens: 12400
  tasks: 3
  commits: 0

key-files:
  created:
    - scripts/ops/statement-counts.ts
    - tests/statement-counts.test.ts
    - tests/learner-results-path-reuse.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/statements-local.json
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/load-local.json
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/probe-local-load.json
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/regression-local.json
  modified:
    - src/server/services/staff-overview-service.ts
    - src/server/services/profile-service.ts
    - src/server/services/lesson-service.ts
    - src/server/services/lesson-resource-service.ts
    - src/server/services/learner-access.ts
    - src/server/services/learner-results-service.ts
    - src/server/services/enrolment-dashboard-service.ts
    - src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/page.tsx
    - src/app/(learner)/learn/[enrolmentId]/results/page.tsx
    - tests/lesson-resource-service.test.ts
    - tests/certificate-slot.test.ts
    - tests/enrolment-dashboard-service.test.ts
    - e2e/support/a11y.ts
---

# Phase 15 Plan 28: Local rehearsal (query counts, pilot load, regression) Summary

The finished code was rehearsed end to end on a laptop (production build, throwaway Docker Postgres with pg_stat_statements, never the shared Neon database): query counts are within budget after fixes, the pilot load runs with zero errors and every view inside the 2.5 s p75 budget, and one full regression pass is green. **All numbers here are local rehearsal results from one laptop that also ran the load generator, the database and the browser. They are relative evidence, not the signed NFR-02 number; the signed numbers come from plan 15-30 on staging.**

## Result

### Task 1: statement counts (tracer)

Measured with `scripts/ops/statement-counts.ts` (guard first, `pg_stat_statements_reset()`, one authenticated fetch, sum of calls excluding the tool's own queries) against a production build on `rehearsal-pg` (postgres:16-alpine, port 5441, seeded with `prisma db seed` and `seed-load --volume`).

| Page | Before (code of plans 15-01..15-27) | After | Budget |
|---|---|---|---|
| `/staff` | 31 | **24** | 25 |
| a lesson page | 39 | **19** | 20 |

Both breached the budget on first measurement, so the causes were fixed and re-measured (ledger P-09 learner-access loops applied, because the rehearsal showed the lesson route over budget). Fixes, all reduce repeated reads of the same rows within one render:

- `src/server/services/staff-overview-service.ts`: fewer statements for the `/staff` overview.
- `src/server/services/profile-service.ts`: reads that followed an update are no longer repeated.
- `src/server/services/learner-access.ts`, `lesson-service.ts`, `lesson-resource-service.ts` and the lesson page: the caller can hand in the path (course version tree) it already loaded, so `canOpenLesson` and the resource read skip the repeat lookup; a path that does not open the lesson falls back to the full check.
- `src/server/services/learner-results-service.ts`, `enrolment-dashboard-service.ts` and the results page: the tree used to be loaded up to four times per enrolment; it is loaded once and reused.

Tests: `tests/statement-counts.test.ts` (19, new), `tests/learner-results-path-reuse.test.ts` (new), and updated `lesson-resource-service`, `certificate-slot`, `enrolment-dashboard-service` tests.

### Task 2: full local pilot load with the browser probe

Environment: Intel i7-10610U (4 cores, 8 threads), 15.8 GB RAM with about 1.3 GB free at the start; k6 `grafana/k6:2.3.0` in Docker, one `next start` Node process, Postgres in Docker, Chromium probe with Regular 4G emulation (30 samples per view, the probe ran during the hold). Seven full runs were made (files kept, git-ignored, in `perf/results/load-local-run1..7.json` and `probe-local-load-run1..7.json`).

What the runs showed:

| Runs | Setup | k6 failure rate | Cause found |
|---|---|---|---|
| 1 to 4 | default Prisma pool, default Node keep-alive | 2.2 to 3.6 percent, p75 thresholds crossed on dashboard, learn, results, staff-cohort | single process queueing plus connection pool exhaustion |
| 5 | fresh server, default pool | 4.8 percent | server log: 498 `P2024 Timed out fetching a new connection from the connection pool (limit 9, timeout 10)` |
| 6 | `connection_limit=25&pool_timeout=30` | 2.0 percent | zero P2024; all failures were `dial: i/o timeout` (30 s TCP connect from the k6 container through Docker Desktop to the host), server log clean |
| 7 | as run 6 plus `next start --keepAliveTimeout 70000` | **0.00 percent (0 of 9,603)** | persistent connections stop the per-request connection churn through the Docker NAT |

Database load was never the problem: run 6 issued 219,615 statements in 13 minutes for 25 s of total execution time (mean 0.1 ms for the hot queries).

Run 7 (saved as the evidence): **9,603 requests, 0 failed, all 13 k6 `p(75)<2500` thresholds passed (k6 exited 0)**. Probe warm p75 per view (all 13 measured, budget 2,500 ms):

| View | warm p75 (ms) | View | warm p75 (ms) |
|---|---|---|---|
| course-home | 1,365 | staff-overview | 833 |
| dashboard | 952 | staff-payments | 823 |
| staff-cohort | 898 | staff-grading | 765 |
| learn | 857 | staff-cohorts | 586 |
| results | 633 | staff-support | 651 |
| lesson | 487 | support | 452 |
| sessions | 324 | | |

Honest caveats for the owner (and for the plan 15-30 run):

- k6 thresholds in this harness are p75 per page plus the failure rate, and those passed. The upper tail was still long on this laptop (k6 p95 between 3.3 s and 26.6 s per page, staff-cohort p95 26.6 s, learn 17.5 s, dashboard 19.0 s; medians 152 to 840 ms). A single Node process with 160 concurrent virtual users on a 4-core laptop that also hosts k6, Postgres and Chromium queues requests. The tail is not a staging result, but the staging run should look at it, not only the p75.
- Runs 5 and 6 were failing, runs 1 to 4 were failing; run 7 is the run saved as evidence, and the numbers are not cherry-picked from the same configuration: the two configuration changes (pool size, keep-alive) are the reason it differs and both are recorded in `load-local.json` under `rehearsal`.
- The Prisma default pool of 9 is a real finding for staging: ledger P-10 (pooled Neon URL, `connection_limit`) must be measured in plan 15-30 with the staging load. No thresholds were weakened.

### Task 3: final local regression pass

`evidence/regression-local.json` (9 result entries, 0 failures, 7 integrity checks passed, git HEAD 9599060 with the uncommitted work of the phase):

| Item | Result |
|---|---|
| Journey (leg 1 + full journey) Chromium | 2 of 2 (seed-only DB), and 2 of 2 again on the volume DB |
| Journey Firefox | 2 of 2 |
| Journey WebKit | 2 of 2 |
| axe sweep, Chromium (spike + 84 screens, two widths) | 85 of 85 |
| Responsive range, Chromium | 36 of 36 |
| Keyboard, Chromium | 4 of 4 |
| Export worker integration (`--no-file-parallelism`) | 5 of 5 |
| Domain event drain integration (`--no-file-parallelism`) | 15 of 15 |
| Integrity checks `--fail-on-violation` | 7 of 7, 0 violations (also 7 of 7 on the volume database) |

Also run this session on the edited code: `tsc --noEmit` clean; ESLint clean on every edited file; unit batches (statement-counts, results path reuse, lesson-resource, certificate-slot, dashboard, learner-access, lesson, results, profile, calendar, my-learning, lesson-list, resource routes, progress, module-lesson, staff-layout, three invariants files, lesson-preview, staff learner results, captions route) all pass; learner-results, learner-journey and staff-scoped-lists integration tests pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Statement budgets breached on first measurement**
- **Found during:** Task 1. `/staff` 31 and lesson 39 against 25 and 20.
- **Fix:** the query reductions listed above (ledger P-09), tests updated, re-measured at 24 and 19.
- **Files:** the nine source files and three test files in the frontmatter.

**2. [Rule 3 - Blocking] `e2e/support/a11y.ts` restored operations rows one at a time**
- **Found during:** Task 3. Against the volume database the "operations all clear" neutraliser changed thousands of rows (1,371 payment attempts alone) and its row-by-row restore outlasted the 240 s and 600 s test timeouts, leaving rows changed.
- **Fix:** the undo in `changeRows` now restores in parallel chunks of 20. This file is outside the plan's `files_modified` list.
- **Also:** the sweeps are designed for a seed-only database (plan 15-19 says so), so the final a11y, responsive, keyboard and chromium journey runs used a second database `regression` in the same `rehearsal-pg` container (`prisma db seed` only). The volume database is disposable and was removed with the container.

**3. [Rule 3 - Blocking] Rehearsal settings needed to run the load honestly**
- `DATABASE_URL` for the local server carried `connection_limit=25&pool_timeout=30`, and the server was started with the documented `next start --keepAliveTimeout 70000` (Next.js CLI docs). These are local rehearsal settings, not code changes. They are written into `load-local.json` and need no change to the application. Whether the staging pool needs the same is plan 15-30 (P-10).

**4. [Evidence shape] `probe-local-load.json` carries an added `warm` object per view**
- The plan's verify command reads `v.warm.p75`; the probe writes `p50/p75/p95` at the top of each view. Each view got `warm: {samples, p50, p75, p95}` copied from those values; no number was changed and `e2e/perf-probe.spec.ts` was not touched.

**5. Evidence from plans 15-19 and 15-20 was regenerated**
- The regression runs rewrote `evidence/a11y-axe-local.json`, `responsive-local.json` and `keyboard-local.json` with the results of the final clean runs on the final code (the earlier files were overwritten while a volume-database run was in progress; the clean runs replaced them in full).

### Failures seen and what they were

- Journey on Chromium, first attempt right after a cold server start: both tests failed within the 5 s expectation (register confirmation heading, sign-in redirect). Immediate re-run 2 of 2, and two later Chromium runs 2 of 2. This matches the known first-hit slowness recorded in plan 15-19 ("first sign-in after a server start needs more than 5 s"); not a code defect, but it is a cold-start flake the staging run should expect.
- Responsive and a11y on the volume database timed out on the operations screen (deviation 2). A later full responsive run had two failures (register "limited" state, staff-operations) while Docker briefly could not reach the database (`Can't reach database server at localhost:5441`, Postgres logged a 195 s checkpoint write: the laptop's disk stalled). Both screens passed when re-run alone (11 of 11) and the full responsive run was then repeated clean, 36 of 36.
- `tests/submission-service.integration.test.ts` (5 tests) and `tests/certificate-download.integration.test.ts` (3 tests) fail on this machine because they need the docker-compose MinIO on port 9000 with the `.env.example` credentials and the `lms-private` bucket; the container running here (`journey-minio`) uses the journey credentials. Environmental, not caused by this plan; they were not part of this plan's regression list. Owner to-do below.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema; the statement tool refuses any non-local database before connecting (T-15-28-01), its query text is truncated and comes from seeded data (T-15-28-03), and every number is labelled local and relative (T-15-28-02).

## Owner to-dos and notes for plan 15-30

1. Sign the NFR-02 number on staging (plan 15-30). Nothing here replaces it.
2. Measure the Prisma pool on staging (P-10): the default pool of 9 timed out under 160 concurrent users on one process; compare the pooled Neon URL with `connection_limit` settings and watch for `P2024` in the logs.
3. Look at the latency tail on staging, not only p75 (local p95 was long on a single process).
4. Run `submission-service` and `certificate-download` integration tests once with the docker-compose MinIO up (`docker compose up -d` default credentials) to complete the full-suite record.
5. Known defect left as is: `/staff/reconciliation/[caseId]` 42P18. It was not touched.

## Cleanup

`rehearsal-pg`, `journey-minio` and the k6 container were removed; the app servers on 3010 and 4010 were stopped; the docker-compose Postgres of the project (`learning-management-system-postgres-1`) was not touched. Nothing was committed (`actuals.commits: 0`).

## Self-Check: PASSED

- Plan verify, Task 1: `npx vitest run tests/statement-counts.test.ts` 19 passed; statements-local.json 24 and 19 within 25 and 20.
- Plan verify, Task 2: node check on `load-local.json` (failed rate 0, `http_reqs` present) and `probe-local-load.json` (13 views, max warm p75 1,365) printed PASS.
- Plan verify, Task 3: node check on `regression-local.json` (9 results, 0 failed, 7 integrity passed) printed PASS; `docker ps -a --filter name=rehearsal-pg` lists nothing.
- `tsc --noEmit` clean; ESLint clean on edited files.
