---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 18
subsystem: perf-probe
tags: [nfr-02, playwright, time-to-usable, percentiles, d-03]
status: complete

requires:
  - phase: 15-01
    provides: patched build baseline
  - phase: 15-09
    provides: core view set
  - phase: 15-10
    provides: Lagos-time staff slice 1 (staff overview and cohort detail pages)
  - phase: 15-14
    provides: seeded load accounts and perf/results/tokens.json
  - phase: 15-15
    provides: Playwright config, guarded server env, local capture server
  - phase: 15-32
    provides: Lagos-time staff slice 2
  - phase: 15-33
    provides: Lagos-time learner slice (dashboard)
provides:
  - "e2e/perf-probe.spec.ts: one test per core view (13), Chromium only, Regular 4G emulation, PROBE_SAMPLES (default 30), PROBE_OUT, warm p75 gate of 2500 ms"
  - "e2e/support/percentiles.ts: percentiles(samples, ps), nearest rank on a sorted copy"
  - "data-primary-content on the 13 core view pages"
  - "evidence/probe-local-noload.json: no-load local baseline, 13 views, 30 samples each"
affects: [15-28, 15-30]

actuals:
  tokens: 21000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "In-page timing: an init script polls requestAnimationFrame and stores performance.now() the first time [data-primary-content] has a box and is not hidden; the spec reads that value, so no CDP round trip is added to the time"
    - "Cold = first sample of a view in a fresh browser context (empty cache); warm = the rest; percentiles are over warm samples only"
    - "The result file is rewritten after every view and before the assertion, so a failing view still leaves its numbers"

key-files:
  created:
    - e2e/perf-probe.spec.ts
    - e2e/support/percentiles.ts
    - tests/percentiles.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/probe-local-noload.json
  modified:
    - "src/app/(learner)/dashboard/page.tsx"
    - "src/app/(learner)/learn/page.tsx"
    - "src/app/(learner)/learn/[enrolmentId]/page.tsx"
    - "src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/page.tsx"
    - "src/app/(learner)/learn/[enrolmentId]/results/page.tsx"
    - "src/app/(learner)/learn/[enrolmentId]/sessions/page.tsx"
    - "src/app/(learner)/support/page.tsx"
    - src/app/staff/page.tsx
    - src/app/staff/cohorts/page.tsx
    - "src/app/staff/cohorts/[id]/page.tsx"
    - "src/app/staff/cohorts/[id]/grading/[assessmentId]/page.tsx"
    - src/app/staff/support/page.tsx
    - src/app/staff/payments/page.tsx

key-decisions:
  - "The attribute goes on the page's own root wrapper, which also contains the page header as a child; it is never on PageHeader, LearnerPageHeader, a shell or any file under src/components"
  - "A view's samples are all the same request, so the view order (not the sample order) is shuffled per run, seeded by PROBE_SEED and recorded with the order actually run"
  - "PROBE_SAMPLES counts every sample including the cold one, so the default 30 gives 1 cold and 29 warm; set PROBE_SAMPLES=31 if the signed run needs 30 warm samples"

patterns-established:
  - "Probe view names match the k6 page tags in perf/lib/config.js, so a k6 threshold and a probe row line up one to one"

requirements-completed: []

coverage:
  - id: D1
    description: "percentiles() uses nearest rank on a sorted copy, exact at the boundaries, one sample returns itself, empty throws"
    requirement: NFR-02
    verification:
      - kind: unit
        ref: "tests/percentiles.test.ts (7 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The probe times usable primary content per view in throttled Chromium and fails a view whose warm p75 exceeds 2500 ms"
    requirement: NFR-02
    verification:
      - kind: other
        ref: "npx playwright test --config e2e/playwright.config.ts e2e/perf-probe.spec.ts --project=chromium (13 passed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Thirteen core views carry data-primary-content on the page's own wrapper; no shell or header carries it; the design contract still passes"
    requirement: NFR-02
    verification:
      - kind: unit
        ref: "tests/unit/design-contract.test.ts (107 tests)"
        status: pass
      - kind: other
        ref: "grep -l data-primary-content over the 13 pages returns 13; src/components returns 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "A no-load local baseline exists for the 13 views, 30 samples each"
    requirement: NFR-02
    verification:
      - kind: other
        ref: "evidence/probe-local-noload.json (the Task 2 node check passed)"
        status: pass
    human_judgment: false

duration: not timed (two production builds of about 7 minutes each and an 8-minute probe run)
completed: 2026-10-09
---

# Phase 15 Plan 18: Time-to-usable probe and page hooks Summary

**A Chromium probe that times each of the 13 core views from navigation start to the page's own `[data-primary-content]` wrapper being visible, under Regular 4G emulation, with nearest-rank p50/p75/p95, a separate cold sample and a 2500 ms warm p75 gate, plus the no-load local baseline.**

## What was built

- **Task 1 (tracer).** `tests/percentiles.test.ts` was written first and failed (module missing), then `e2e/support/percentiles.ts` made its 7 tests pass. `data-primary-content` went onto the dashboard's root wrapper (one changed line against the copy saved at the start). `e2e/perf-probe.spec.ts` was written with a table of all thirteen views from the start (the plan began with the dashboard only); the tracer was run on the dashboard with `PROBE_SAMPLES=10`: cold 2822 ms, warm p50 550, p75 614, p95 749. The tracer gate passed, so the other twelve hooks were added.
- **Task 2.** The attribute was added to the other twelve pages and the full probe was run with `PROBE_SAMPLES=30` against a fresh local production build with no background load.

### Page hooks

| View | File | Placed on |
| --- | --- | --- |
| dashboard | `(learner)/dashboard/page.tsx` | root `div` (attribute only) |
| learn | `(learner)/learn/page.tsx` | root `div` (attribute only) |
| course-home | `(learner)/learn/[enrolmentId]/page.tsx` | root `div` of the main return (attribute only; the access-denied branch is not a core view) |
| lesson | `(lesson)/.../lessons/[lessonId]/page.tsx` | **new plain wrapper `div`** around the `LessonContent` element |
| results | `(learner)/learn/[enrolmentId]/results/page.tsx` | root `div` (attribute only) |
| sessions | `(learner)/learn/[enrolmentId]/sessions/page.tsx` | root `div` (attribute only) |
| support | `(learner)/support/page.tsx` | root `div` (attribute only) |
| staff-overview | `staff/page.tsx` | root `div` (attribute only) |
| staff-cohorts | `staff/cohorts/page.tsx` | **new plain wrapper `div`** around `CohortsTable` (happy path) |
| staff-cohort | `staff/cohorts/[id]/page.tsx` | **new plain wrapper `div`** around `DetailLayout` (its JSX re-indented by two spaces; `git diff -w` is two added lines) |
| staff-grading | `staff/cohorts/[id]/grading/[assessmentId]/page.tsx` | root `div` (attribute only) |
| staff-support | `staff/support/page.tsx` | **new plain wrapper `div`** around `SupportWorkspace` (happy path) |
| staff-payments | `staff/payments/page.tsx` | the outer fragment `<>` became a plain `div` carrying the attribute |

Five pages had no wrapper of their own (they return a shell, a table or a layout component directly, or put their children straight into `LessonFrame`), so the plan's fallback applied: a plain `div` carrying only the attribute. The wrapper sits in a block parent (`StaffShell` `main`) or replaces a single flex child (`LessonFrame`), so layout is unchanged; the design-contract test passes. Error, denied and sign-in-ended branches are deliberately left without the attribute: they are not the view being timed.

Per-file checks against the copies saved before editing (`diff -w --strip-trailing-cr`): the dashboard, learn, course home, results, sessions, support, staff overview and grading pages show exactly one changed line; the others show only the wrapper lines above. Plan 15-10's `LagosTime` rendering in `staff/page.tsx` and `staff/cohorts/[id]/page.tsx` and plan 15-33's dashboard date rendering are untouched. CRLF files (`staff/page.tsx`, `staff/cohorts/[id]/page.tsx`, `staff/payments/page.tsx`) are still entirely CRLF (checked by byte count).

## Local no-load baseline (relative evidence only)

Local production build, Docker Postgres `licence_test` on port 5434, one worker, headed Chromium, Regular 4G emulation, 30 samples per view (1 cold, 29 warm), no background load, seed 587508659. Times in milliseconds.

| Run order | View | Cold | Warm p50 | Warm p75 | Warm p95 | LCP p75 (supporting data) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | staff-overview | 1699 | 458 | 481 | 582 | 204 |
| 2 | dashboard | 935 | 677 | 1739 | 2405 | 192 |
| 3 | learn | 1472 | 1213 | 1690 | 2435 | 212 |
| 4 | staff-cohort | 3372 | 1489 | 1762 | 2426 | 1712 |
| 5 | course-home | 1098 | 584 | 842 | 1316 | 492 |
| 6 | results | 683 | 925 | 1258 | 1930 | 260 |
| 7 | staff-cohorts | 1021 | 421 | 532 | 795 | 556 |
| 8 | lesson | 1174 | 701 | 1403 | 2337 | 1744 |
| 9 | staff-payments | 1293 | 807 | 940 | 1106 | 928 |
| 10 | staff-grading | 977 | 537 | 766 | 1198 | 668 |
| 11 | staff-support | 1441 | 252 | 330 | 520 | 404 |
| 12 | support | 818 | 135 | 248 | 348 | 316 |
| 13 | sessions | 902 | 438 | 579 | 1173 | 644 |

All 13 warm p75 values are under 2500 ms (highest: staff-cohort 1762, dashboard 1739, learn 1690). **No view exceeds the threshold already without load, so there is no item to hand to plan 15-28 from this run.** Two things to know when reading the numbers against loaded runs: (1) the p95 of dashboard, learn, staff-cohort and lesson is already 2.3 to 2.4 s with no load, so they are the first views to watch; (2) the numbers are noisy between runs on this laptop (the dashboard warm p75 was 614 ms in the 10-sample tracer and 1739 ms in the 30-sample run), so compare loaded runs against this file as a rough guide, not a precise reference. Cold times (empty cache, first request) were 0.7 to 3.4 s; staff-cohort is the slowest cold start at 3372 ms.

## Verification run

| Command | Result |
| --- | --- |
| `npx vitest run tests/percentiles.test.ts` (first run, before the helper existed) | failed as expected (RED) |
| `npx vitest run tests/percentiles.test.ts` | 1 file, 7 tests passed |
| `npx tsx scripts/ops/assert-local-db.ts` (before every database-touching run) | exit 0, `database target is local (localhost)` |
| `PROBE_SAMPLES=10 npx playwright test --config e2e/playwright.config.ts e2e/perf-probe.spec.ts --project=chromium --grep "dashboard" --headed` | 1 passed |
| `PROBE_SAMPLES=30 PROBE_OUT=<evidence path> npx playwright test --config e2e/playwright.config.ts e2e/perf-probe.spec.ts --project=chromium --headed` | 13 passed (8.0 min) |
| `npx vitest run tests/unit/design-contract.test.ts --testTimeout=60000` | 1 file, 107 tests passed |
| Task 2 `node -e` baseline check (13 views, each at least 30 samples) | passed |
| `grep -l data-primary-content` over the 13 pages | 13 files; 0 files under `src/components` |
| `npx tsc --noEmit` and `npx eslint` on the three new files | clean (no output) |
| `npm run build` against the local database (twice: after the dashboard hook, after all 13) | compiled and type-checked, exit 0 |

The plan's own Task 1 verify line was run in parts rather than as one chained command: the vitest and assert-local-db steps as written, and the Playwright step with `PROBE_SAMPLES=10` and a scratch `PROBE_OUT` (the plan says to run the tracer with 10 samples).

## Deviations from Plan

### Auto-fixed Issues

None needed fixing.

### Interpretation and additions (no rule triggered)

1. **View table started with all 13 views, not the dashboard only.** The spec was written once with the full table; only the dashboard had a hook when the tracer ran, and the tracer used `--grep "dashboard"`. The tracer gate (run before the other hooks were added) still came first.
2. **Randomised order is per view, not per sample.** All samples of one view are the same request, so shuffling them means nothing. The view order is shuffled per run (seeded; seed and the order actually run are in the JSON), and each view gets a fresh context. This is the closest honest reading of "randomised order" with one test per view and the required `--grep "dashboard"` selection.
3. **`PROBE_SAMPLES` counts the cold sample.** Default 30 gives 1 cold and 29 warm; the plan's "at least 30 samples per view" and the verify check (`samples >= 30`) are met. Use `PROBE_SAMPLES=31` for 30 warm samples in the signed run.
4. **Wrapper `div` on five pages** (see the table), as the plan's fallback allows, recorded here.
5. **`lesson` wrapper encloses only the lesson body**, because `LessonFrame` is a shell and the page puts its children straight in it. A lesson with an empty body would render a zero-height wrapper and the probe would time out waiting; the seeded load lessons have bodies, so this did not occur. Worth knowing if a later run uses an empty lesson.
6. **Headed Chromium** was used for both Playwright runs, as the owner wants to watch. Playwright's own flags keep occluded windows from being throttled, but keep the window uncovered if you rerun it for comparison.
7. **Local environment.** Docker Desktop was not running, so it was started. The throwaway role `licence_test` on the existing Docker Postgres (port 5434, database `licence_test`, which already held the migrations and the plan 15-14 load data) was given a fresh password, kept only in the session scratchpad. A throwaway MinIO container (`journey-minio`, loopback only) was started because the shared Playwright global setup needs object storage, then removed. The `.env` database was never read or contacted; the guard passed before each run.
8. **Server-side log noise.** The first tracer run printed `The destination stream closed early` for the lesson route: the dashboard's "Resume lesson" link is prefetched and the probe navigates to `about:blank` between samples, which aborts the prefetch. It is a client abort, not a server fault.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-15-18-01: session tokens are read from the gitignored `perf/results/tokens.json`, set only as a cookie value and never logged or written to the evidence file. T-15-18-02: the method is fixed in code (nearest rank, warm and cold separated, 2500 ms gate not settable, seed recorded). T-15-18-03: the attribute has no value.

## Neon go-live list

None. No migration, schema or configuration change.

## Owner notes

- Nothing was committed or staged. The new files (`e2e/perf-probe.spec.ts`, `e2e/support/percentiles.ts`, `tests/percentiles.test.ts`, the evidence file) and the 13 page edits are in the working tree, mixed with other plans' uncommitted edits in the same files (for example the Lagos-time changes in the dashboard, staff overview and cohort detail pages). Stage the page files by hunk if you want this plan's change on its own: it is only the `data-primary-content` lines listed above.
- The signed NFR-02 number is still plan 15-30's run on staging. The numbers here are a laptop with no load and are for comparison only.
- No server or container started by this run is still running (ports 3010, 4010 and 9000 checked). The `.next` build now matches the 13 hooks.

## Self-Check: PASSED

- Files exist: `e2e/perf-probe.spec.ts`, `e2e/support/percentiles.ts`, `tests/percentiles.test.ts`, `evidence/probe-local-noload.json`, all 13 page files with the attribute.
- Acceptance checks: spec contains `emulateNetworkConditions`, `waitUntil: "commit"` and `data-primary-content`; the dashboard diff is one line; 13 files carry the attribute; `src/components` has none; the evidence file lists 13 views with 30 samples each.
- No commits made, nothing staged (per the run override); `actuals.commits: 0`.
