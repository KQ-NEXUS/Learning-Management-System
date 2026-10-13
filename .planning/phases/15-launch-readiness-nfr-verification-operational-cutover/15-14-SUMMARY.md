---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 14
subsystem: load-harness
tags: [nfr-02, nfr-03, k6, load-testing, seeding, webhook-idempotency, scripts]
status: complete

requires:
  - phase: 15-07
    provides: assertSafeDatabaseUrl guard, assert-local-db CLI
provides:
  - scripts/load/seed-load.ts (load accounts, sessions, enrolments, optional volume, pending order)
  - scripts/load/webhook-replay-report.ts (database read-back for the concurrent webhook replay)
  - perf/pilot-load.js + perf/lib/config.js (k6 two-scenario pilot load, per-page p75 thresholds)
  - perf/webhook-replay.js, perf/signin-burst.js, perf/stubs/paystack-verify-stub.cjs
  - perf/README.md (how test:perf, k6 and the Playwright probe fit together)
affects: [15-18, 15-28, 15-30, 15-31]

actuals:
  tokens: 16500
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Guard-before-import: seed-load and the replay report call assertSafeDatabaseUrl, then import @prisma/client dynamically"
    - "Seeder exports seedLoad(db, options) so the integration test drives it with the Testcontainers client; the CLI only runs when started directly"
    - "k6 from the pinned grafana/k6:2.3.0 image, never npm; BASE_URL has no default"
    - "Local rehearsal of a payment webhook uses a NODE_OPTIONS preload that stubs only the Verify Transaction fetch; no application code changes"

key-files:
  created:
    - scripts/load/seed-load.ts
    - scripts/load/webhook-replay-report.ts
    - perf/lib/config.js
    - perf/pilot-load.js
    - perf/webhook-replay.js
    - perf/signin-burst.js
    - perf/stubs/paystack-verify-stub.cjs
    - perf/README.md
    - tests/seed-load.integration.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/k6-local-smoke.json
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/k6-webhook-replay-local.json
  modified:
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/deferred-items.md

key-decisions:
  - "Staff load accounts all hold the Administrator role globally: it is the one default role that can open every view the staff scenario visits (overview, cohorts, cohort, grading, support, payments)"
  - "The seeded pilot cohorts hold 25 or 40 seats, so seed-load raises each used cohort's capacity to at least its live seat count and recomputes seatsTaken from the rows (the same rule prisma/seed.ts uses); the seat CHECK and the capacity integrity check stay satisfied"
  - "The webhook route re-verifies every charge.success against api.paystack.co, so the local replay preloads a fetch stub (perf/stubs) gated on PAYSTACK_VERIFY_STUB_FILE instead of calling a live provider or changing app code"
  - "A pending Paystack order's payment attempt must be PROCESSING (PENDING to SUCCEEDED is an illegal transition and settles as an exception), exactly as after a real initiation"
  - "The k6 checks threshold is rate>0.999 and every page also checks for a render error (data-dgst), because a Next.js error after streaming starts still answers HTTP 200"

patterns-established:
  - "k6 page tag per core view: http_req_duration{page:<name>} p(75)<2500, built by buildThresholds in perf/lib/config.js"

requirements-completed: []

coverage:
  - id: D1
    description: "seed-load creates learners and staff with active enrolments, Administrator staff assignments and one hashed session each; raw tokens resolve to the right actor"
    requirement: NFR-02
    verification:
      - kind: integration
        ref: "tests/seed-load.integration.test.ts#creates learners, staff, active enrolments and sessions whose raw tokens resolve to the right actor"
        status: pass
    human_judgment: false
  - id: D2
    description: "seed-load is idempotent, hashes one random password once, never uses the default seed password"
    requirement: NFR-02
    verification:
      - kind: integration
        ref: "tests/seed-load.integration.test.ts#is idempotent"
        status: pass
    human_judgment: false
  - id: D3
    description: "seed-load refuses a non-local DATABASE_URL (and unset, and staging without the opt-in) before opening a connection, printing no password"
    requirement: NFR-02
    verification:
      - kind: integration
        ref: "tests/seed-load.integration.test.ts#seed-load safety"
        status: pass
    human_judgment: false
  - id: D4
    description: "--volume adds orders and tickets in the 5,000 : 2,000 proportion with payment attempts and initial messages"
    requirement: NFR-02
    verification:
      - kind: integration
        ref: "tests/seed-load.integration.test.ts#adds orders and tickets in the 5,000 : 2,000 proportion"
        status: pass
    human_judgment: false
  - id: D5
    description: "k6 pilot load authenticates from seeded sessions and loads every core view with per-page p75 thresholds; a breach exits non-zero"
    requirement: NFR-02
    verification:
      - kind: other
        ref: "evidence/k6-local-smoke.json (204 requests, 0 percent failed; k6 exited 99 on a real p75 breach, proving the gate)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Ten concurrent signed Paystack charge.success posts leave one SUCCEEDED attempt, one PROCESSED WebhookEvent, order PAID, enrolment ACTIVE"
    requirement: NFR-03
    verification:
      - kind: other
        ref: "evidence/k6-webhook-replay-local.json (succeededAttempts 1, processedEvents 1, duplicateEvents 9)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A12: the no-JavaScript sign-in form replays and authenticates (multipart body required)"
    requirement: NFR-02
    verification:
      - kind: other
        ref: "perf/signin-burst.js, 10 attempts over 10 s locally: 11 of 11 authenticated, p75 1.65 s"
        status: pass
    human_judgment: false

duration: not timed (long waits on builds and containers)
completed: 2026-10-08
---

# Phase 15 Plan 14: Pilot load seeding, k6 harness and concurrent webhook replay Summary

**A guarded seeder for 150 learners and 10 staff with real sessions, a pinned-image k6 pilot load with a p75 threshold per core view, a signed-webhook replay that settles an order exactly once under 10 concurrent posts, and a README that says how the three perf harnesses fit.**

## Performance

- **Duration:** not timed; mostly waiting on a 3-minute compile plus 4-minute type check per production build and 6 minutes per Testcontainers run on a contended laptop
- **Tasks:** 3 (1 tracer, 1 TDD, 1 auto)
- **Files:** 11 created, 1 modified (`deferred-items.md`)

## Accomplishments

- `scripts/load/seed-load.ts`: `--learners` (150), `--staff` (10), `--target`, `--volume`, `--volume-scale`, `--tokens-out`, `--pending-order`, `--cohorts`. The guard runs first, `@prisma/client` is imported dynamically afterwards. One random password is hashed once and reused. Learners are enrolled ACTIVE round-robin over `SLP-2026-01`, `SLP-2026-03`, `FCM-2026-02`; staff get the Administrator role; each account gets one Session whose `sessionToken` is `hashToken(raw)`. Raw tokens, the password, learner emails and the dynamic ids (an enrolment and two lesson ids per learner, a cohort and an assignment for the grading page) go only to `perf/results/tokens.json` (ignored); the terminal gets counts.
- `--volume` adds 5,000 orders (70 percent PAID with SUCCEEDED attempts, the rest PENDING, FAILED, CANCELLED) and 2,000 tickets with an initial message, spread over 90 and 60 days, using fixed ids and `skipDuplicates` so a re-run adds nothing. `--pending-order` creates a fresh payer, a PENDING order, a PROCESSING Paystack attempt and a held seat, and writes `perf/results/pending-order.json`.
- `perf/pilot-load.js` and `perf/lib/config.js`: learners ramp to 150 over 2 minutes, hold 10, ramp down 30 seconds, 5 to 15 s think time; 10 staff in parallel; `SMOKE=1` gives 5 + 1 virtual users for a minute. Thirteen page tags each have `http_req_duration{page:<name>}: p(75)<2500`; plus `http_req_failed: rate<0.01` and `checks: rate>0.999` (status 200, still signed in, no render error). Documents only.
- `perf/webhook-replay.js` + `scripts/load/webhook-replay-report.ts`: one HMAC-SHA512 signed event posted by 10 virtual users at once; the report reads the local database and writes the evidence.
- `perf/signin-burst.js`: A12 held. The replay needs a multipart body (Next.js 16.3.8 does not find the server action in a url-encoded post); with that it authenticates.
- `perf/README.md`: the five required sections, the exit-code meaning (99 is a breached threshold), the Git Bash and PowerShell Docker invocations and the staging ramp.

## Task Commits

No commits. The owner commits explicitly; nothing is staged.

1. **Task 1 (tracer): seed, k6 smoke against the local production build.** Verified end to end. The final smoke: 204 requests, 0 percent failed. k6 exited 99 because `dashboard` p75 was 2.57 s at only 5 virtual users, which is the threshold gate working (see Findings).
2. **Task 2 (TDD): volume, seeder integration test, README.** 7 of 7 tests pass.
3. **Task 3: webhook replay and sign-in burst.** Replay evidence: 10 posts acknowledged, 1 SUCCEEDED attempt, 1 PROCESSED event, 9 duplicates absorbed, order PAID, enrolment ACTIVE.

## Verification run

| Check | Result |
| --- | --- |
| `npx vitest run tests/seed-load.integration.test.ts --no-file-parallelism` | 7 passed (4 database cases, 3 guard CLI cases) |
| `npx tsc --noEmit` | clean |
| `npx eslint scripts/load tests/seed-load.integration.test.ts` | clean (`perf/**` is globally ignored in `eslint.config.mjs`) |
| Task 1 verify (smoke JSON at least 10 requests, failure at most 1 percent; seed-load safe) | pass |
| Task 3 verify (succeededAttempts 1, processedEvents 1) | pass |
| `git status --short perf/results` | empty (ignored) |
| Production build (`npm run build`) against the local database | compiled, type-checked, 52 pages generated |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The webhook route calls the live Paystack API**
- **Found during:** Task 3 planning
- **Issue:** `route.ts` re-verifies every `charge.success` against `https://api.paystack.co` before it settles. A local replay with a fake key would fail verification and settle nothing, and the run rules forbid live providers.
- **Fix:** `perf/stubs/paystack-verify-stub.cjs`, preloaded with `NODE_OPTIONS="--require ./perf/stubs/paystack-verify-stub.cjs"`, answers only the verify call for the one pending order in `PAYSTACK_VERIFY_STUB_FILE` and returns 501 for any other api.paystack.co call. It installs nothing unless that variable is set. No application code changed.
- **Files:** `perf/stubs/paystack-verify-stub.cjs`

**2. [Rule 1 - Bug] The pending order's payment attempt was created as PENDING**
- **Found during:** Task 3, first replay run (order stayed PENDING, event PROCESSED, audit row `order.exception`)
- **Issue:** `PENDING` to `SUCCEEDED` is an illegal payment transition; after a real initiation the attempt is `PROCESSING`.
- **Fix:** `seedPendingOrder` creates the attempt as PROCESSING; test updated.
- **Files:** `scripts/load/seed-load.ts`, `tests/seed-load.integration.test.ts`

**3. [Rule 2 - Missing critical] Status 200 hid a render error**
- **Found during:** Task 3 (server log showed the `/staff/payments` error while k6 still passed)
- **Issue:** Next.js answers 200 when an error happens inside a streamed boundary, so status and sign-in checks cannot see a broken page.
- **Fix:** every visit now also checks the body has no `data-dgst=` marker, and the `checks` threshold is `rate>0.999` instead of 0.99.
- **Files:** `perf/lib/config.js`, `perf/README.md`

**4. [Rule 3 - Blocking] The sign-in replay needed a multipart body**
- **Found during:** Task 3 (url-encoded post returned 200 in 50 ms and "Failed to find Server Action" in the server log)
- **Fix:** `signin-burst.js` builds a multipart/form-data body with a CRLF boundary. This is the A12 outcome (see below).

### Other differences from the plan text

- Added `scripts/load/webhook-replay-report.ts` (the plan said "query the local database (guarded)" without naming a file).
- `evidence/k6-local-smoke.json` is the third smoke run (the one made after the render-error check existed); the earlier runs are not kept.
- The plan's `files_modified` lists no `perf/stubs/` file or report script; both are additions, not substitutions.

## A12 outcome (ledger row)

**A12 held: the no-JavaScript sign-in form can be replayed and authenticates.** Locally, 10 attempts over 10 s returned 11 of 11 session cookies, sign-in post p75 1.65 s (scrypt, no other load). The replay must be multipart. Not measured here, and left for plan 15-31: the full 150 in 60 s burst, and whether the per-IP sign-in throttle allows it from the single k6 address (`signin-burst.js` counts throttled and failed results separately so the two are not confused).

## Findings handed to later plans (not fixed here)

1. **`/staff/payments` is broken in a production build.** The page calls `initialPaymentStatus`, exported from the `"use client"` file `PaymentsTable.tsx`; every request errors on the server and the browser gets the error boundary with HTTP 200. Logged in `deferred-items.md` and in `.planning/WINDOWS.md`. This is a launch-blocking staff page and a one-line-class fix (move the helper to a plain module).
2. **Local smoke already breaches p75 2.5 s** on `dashboard` (4.56 s in one run, 2.57 s in another), `staff-overview` (3.33 s) and `learn` (first cold run) at only 5 + 1 virtual users. A laptop sharing CPU with Docker inflates this, but the pages are the ones 15-RESEARCH A2 flagged. Plan 15-28 owns the full run and fixes.

## Neon go-live list

None. This plan adds no migration and changes no schema. `seed-load.ts` must never be pointed at the production Neon database; the guard refuses it.

## Known Stubs

None. (`perf/stubs/paystack-verify-stub.cjs` is a deliberate local test double, off unless `PAYSTACK_VERIFY_STUB_FILE` is set.)

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: env-gated fetch override | perf/stubs/paystack-verify-stub.cjs | Replaces `globalThis.fetch` for api.paystack.co when `PAYSTACK_VERIFY_STUB_FILE` is set via `NODE_OPTIONS`. It must never be set in a deployed environment; the README states it is local rehearsal only. |

## Owner notes

- Local database now holds load data (10 learners, 2 staff, a few pending-payment test orders, about 25 seats). Harmless on the local Docker database; do not copy it anywhere.
- The `.next` production build and `perf/results/` exist locally and are ignored by git. No server or container started by this run is still running (the permanent compose Postgres on port 5434 was already up).
- k6 image `grafana/k6:2.3.0` was pulled and exists.

## Self-Check: PASSED

- Files exist: `scripts/load/seed-load.ts`, `scripts/load/webhook-replay-report.ts`, `perf/lib/config.js`, `perf/pilot-load.js`, `perf/webhook-replay.js`, `perf/signin-burst.js`, `perf/stubs/paystack-verify-stub.cjs`, `perf/README.md`, `tests/seed-load.integration.test.ts`, both evidence files.
- Acceptance checks: smoke JSON 204 requests and 0 failures; seed-load has no default password and calls `assertSafeDatabaseUrl` before the Prisma import; `pilot-load.js` contains `p(75)<2500` and `http_req_failed`; `webhook-replay.js` contains `x-paystack-signature` and reads the secret from `__ENV`; README has the five headings and mentions `npm run test:perf`; `git status --short perf/results` is empty; replay evidence shows 1 and 1.
- No commits made, nothing staged (per the run override).
