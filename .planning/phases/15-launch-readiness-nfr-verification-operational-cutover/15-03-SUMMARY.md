---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 03
subsystem: auth
tags: [rate-limiting, postgres, prisma, audit, nextjs-server-actions, security]

requires:
  - phase: F-14b sign-in throttle
    provides: LoginThrottle table, THROTTLE_WINDOW_MINUTES, ThrottleKey, clientIpFrom, recordFailure upsert pattern
provides:
  - Generalised Postgres-backed entry-point limiter (src/server/auth/rate-limit.ts)
  - rateLimitService.consume(scope, subject) bound to Prisma and the audit sink, classified continuity in the licence registry
  - requestCorrelationId() for audit rows written during a request
  - Audit action rate_limit.blocked
  - Per-device limits on register, forgot password, resend verification and the public certificate check; per-learner limit on new support requests, all with UI-SPEC S5 copy
  - Fourth render branch on /verify/[verificationRef] (no lookup, no <dl>)
affects: [15 NFR verification, security review, Neon go-live, ledger A13]

actuals:
  tokens: 11500
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Attempt counting via one INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING statement per key, so the read is atomic with the increment"
    - "Rate-limit keys namespaced per scope; no trusted IP falls back to a per-address key, never a shared bucket"
    - "Server page test that runs the real limiter and audit sink over a mocked @/server/db slice"

key-files:
  created:
    - src/server/auth/rate-limit.ts
    - src/server/auth/request-context.ts
    - src/server/services/rate-limit-service.ts
    - tests/rate-limit.test.ts
    - tests/rate-limit.integration.test.ts
    - tests/auth-rate-limit-actions.test.ts
    - tests/create-ticket-rate-limit.test.ts
  modified:
    - src/server/licence/registry.ts
    - src/app/(auth)/register/actions.ts
    - src/app/(auth)/forgot-password/actions.ts
    - src/app/(auth)/verify/actions.ts
    - src/app/verify/[verificationRef]/page.tsx
    - src/app/(learner)/support/new/actions.ts
    - tests/register-action.test.ts
    - tests/registration-service.test.ts
    - tests/verify-routes.test.ts

key-decisions:
  - "A limiter failure on forgot password and resend verification collapses to the same neutral sent state as a service failure; on register it returns the generic 'Something went wrong' refusal; on a support request it lands in the existing not-created message"
  - "An audit-write failure does not lift a refusal: the refusal stands and the failure is logged without the address"
  - "The support-request limiter runs inside the existing try block after the schema parse, so invalid submissions consume nothing"

patterns-established:
  - "rateLimitService.consume(scope, subject) before the service call in any public action; message names the device, never the address"

requirements-completed: [NFR-04, NFR-07]

coverage:
  - id: D1
    description: "Generalised limiter: keys per scope, null-IP per-address fallback, no keys for certificate check without IP, N allowed and N+1 refused, exact 15-minute window edge, atomic upsert statement shape"
    requirement: NFR-04
    verification:
      - kind: unit
        ref: "tests/rate-limit.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "40 concurrent forgot-password attempts from one device allow exactly 20; each refusal writes one rate_limit.blocked AuditEvent with IP and correlationId and no address; known and unknown addresses give identical decisions and rows; real-SQL window edge"
    requirement: NFR-07
    verification:
      - kind: integration
        ref: "tests/rate-limit.integration.test.ts (Testcontainers Postgres)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Register refuses a limited device with the S5 sign-up message, echoes name and email, never the password, and never calls registerLearner"
    requirement: NFR-04
    verification:
      - kind: unit
        ref: "tests/register-action.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Forgot password and resend verification refuse a limited device with S5 copy and otherwise keep one neutral state for known and unknown addresses"
    requirement: NFR-04
    verification:
      - kind: unit
        ref: "tests/auth-rate-limit-actions.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Certificate check fourth branch: heading, body with window minutes, Clock icon aria-hidden, Reference line, no <dl>, no lookup, one audit row; no trusted IP performs the lookup and records nothing"
    requirement: NFR-04
    verification:
      - kind: unit
        ref: "tests/verify-routes.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Support requests limited to 5 per learner per window with the S5 message; refused requests create no ticket; invalid submissions consume nothing"
    requirement: NFR-04
    verification:
      - kind: unit
        ref: "tests/create-ticket-rate-limit.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "Limiter service classified continuity in the licence registry"
    verification:
      - kind: unit
        ref: "tests/licence-enforcement-boundary.test.ts"
        status: pass
    human_judgment: false
  - id: D8
    description: "Visual look of the certificate-check throttled branch and the S5 messages in the live forms"
    verification: []
    human_judgment: true
    rationale: "Rendering is asserted by markup tests; the visual check in a browser belongs to the phase UI review"

duration: ~30 min (resume run only; first run's duration unknown)
completed: 2026-10-07
status: complete
---

# Phase 15 Plan 03: Entry-point Rate Limiting Summary

**Postgres-backed per-device and per-learner rate limits on register, forgot password, resend verification, the public certificate check and new support requests, using one atomic INSERT ... ON CONFLICT ... RETURNING per key in the existing LoginThrottle table, with neutral UI-SPEC S5 copy and a `rate_limit.blocked` audit row per refusal.**

## Performance

- **Duration:** about 30 minutes for this resume run; the first run was cut off by an API login error and its duration is not recorded
- **Completed:** 2026-10-07
- **Tasks:** 3 of 3
- **Files:** 7 created, 9 modified

## Interrupted first run

The first executor was cut off mid-run ("Now the page edit." was its last message) and wrote no SUMMARY. This run checked its uncommitted work against the plan:

- **Task 1 (tracer):** complete as left. Verify command re-run and passed.
- **Task 2:** complete as left. Both verify commands re-run and passed, including the Testcontainers integration suite.
- **Task 3:** partial. The page had the limiter call and the new header comment, but still read `result.status` while `result` could be `null`, so the throttled render branch was missing and the page would not have type-checked. The support action, `tests/verify-routes.test.ts` page cases and `tests/create-ticket-rate-limit.test.ts` had not been started. This run finished all of them.

## Accomplishments

- `src/server/auth/rate-limit.ts`: frozen `RATE_LIMITS` (register 30, forgot 20, resend 20, certificate check 60 per device; support 5 per learner per 15 minutes), `rateLimitKeysFor` with per-scope namespacing and the per-address fallback, `isOverLimit`, and `consumeAttempts` issuing one upsert with `RETURNING` per key. No in-memory store and no schema change.
- `src/server/services/rate-limit-service.ts`: `createRateLimitService` and the `rateLimitService` singleton. Refusals are audited as `rate_limit.blocked` (targetType RateLimit, targetId scope, outcome DENIED, IP, correlationId). The address and typed text are never recorded. `windowMinutes` is `Math.ceil(15)`, never a remainder. Registered as `continuity` in the licence registry.
- `src/server/auth/request-context.ts`: `requestCorrelationId()` returns `x-nf-request-id` when present and a random UUID otherwise.
- All five entry points are wired with the exact S5 copy. The certificate page has a fourth branch (Clock icon, 28px/600/1.2 heading, Reference line kept, no `<dl>`, no lookup).
- `NewTicketForm` already keeps category, subject, message and picked files on `ok: false`, so it was left unchanged as the plan allowed.

## Task Commits

Not committed (owner commits explicitly). All changes are left uncommitted in the working tree.

1. **Task 1: Tracer, limiter + service + register.** Not committed (owner commits explicitly). Work by the first run, verified here.
2. **Task 2: Forgot password, resend, integration proof.** Not committed (owner commits explicitly). Work by the first run, verified here.
3. **Task 3: Certificate fourth branch + support limit.** Not committed (owner commits explicitly). Started by the first run, finished here.

## Files Created/Modified

- `src/server/auth/rate-limit.ts`: pure limiter module
- `src/server/auth/request-context.ts`: correlation id helper
- `src/server/services/rate-limit-service.ts`: service binding and audit
- `src/server/licence/registry.ts`: continuity entry for the limiter service
- `src/app/(auth)/register/actions.ts`, `forgot-password/actions.ts`, `(auth)/verify/actions.ts`: per-device limits
- `src/app/verify/[verificationRef]/page.tsx`: fourth render branch, lookup skipped when limited
- `src/app/(learner)/support/new/actions.ts`: per-learner limit after the schema parse
- `tests/rate-limit.test.ts`, `tests/rate-limit.integration.test.ts`, `tests/auth-rate-limit-actions.test.ts`, `tests/create-ticket-rate-limit.test.ts`: new
- `tests/register-action.test.ts`, `tests/verify-routes.test.ts`: extended
- `tests/registration-service.test.ts`: mocks the limiter and `next/headers` so its register-action section stays database-free

## Decisions Made

- When the limiter itself fails, each entry point falls back to its existing failure state: neutral sent state on forgot and resend, the generic refusal on register, the not-created message on support. No new response shape is added, so no outcome becomes distinguishable (P4).
- An audit-write failure keeps the refusal in place and is logged without the address.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Half-finished certificate page edit from the interrupted run**
- **Found during:** Task 3 (resume)
- **Issue:** `result` became `null` when limited, but the JSX still read `result.status` and had no throttled branch.
- **Fix:** Added the throttled branch keyed on `limit.limited` and changed the three outcome branches to `result?.status`.
- **Files modified:** src/app/verify/[verificationRef]/page.tsx
- **Commit:** not committed (owner commits explicitly)

**2. [Rule 3 - Blocking] `tests/verify-routes.test.ts` was only a file-existence route guard**
- **Found during:** Task 3
- **Issue:** The plan says to extend it for the two page behaviours, but it had no render harness.
- **Fix:** Kept the four route-table cases. Added three render cases that run the real limiter and audit service over a mocked `@/server/db`, so the test proves wiring, the absence of `<dl>`, no lookup and one audit row without a database. There is also a third case: at exactly 60 the lookup still runs.
- **Files modified:** tests/verify-routes.test.ts
- **Commit:** not committed (owner commits explicitly)

**3. [Rule 3 - Blocking] `tests/registration-service.test.ts` touched outside `files_modified`** (first run)
- **Issue:** The file imports `registerAction`, which now calls `headers()` and the limiter.
- **Fix:** Mocked the limiter and `next/headers` there. The file passes.

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking). **Impact:** no scope change.

## Issues Encountered

- Running the three jsdom component suites in one vitest call timed out while starting workers ("Timeout waiting for worker to respond"). Run one file at a time, all three passed. This is an environment limit, not a regression.

## Tracking

- `state.advance-plan`, `state.record-metric`, `state.add-decision`, `state.record-session` and `roadmap.update-plan-progress 15` ran and returned success.
- `state.update-progress` skipped and reported "phase scope is unscoped, not complete". STATE.md's Progress field was not changed, and was not edited by hand.
- `requirements.ready-ids <plan> NFR-04,NFR-07` returned no ready IDs. Both are blocked by sibling plans in phase 15 that declare them and have no SUMMARY yet, so REQUIREMENTS.md was not marked. They will become ready when the last declaring plan finishes.

## Observations for the owner

- Without a trusted client IP, the plan's per-address fallback on register, forgot and resend shows the "from this device" message after 30/20/20 attempts for one address. It does not depend on whether an account exists (proven by the known-versus-unknown integration case). UI-SPEC S5's line that "a per-address limit stays silent" refers to the 60-second cooldown, which is unchanged. In production on Netlify the IP header is always present, so this fallback should not trigger there.
- No schema migration was created. The limiter reuses the existing `LoginThrottle` table, so nothing is added to the Neon go-live list.

## Verification run (this session)

| Command | Result |
|---------|--------|
| `npx vitest run tests/rate-limit.test.ts tests/register-action.test.ts tests/licence-enforcement-boundary.test.ts tests/registration-service.test.ts tests/auth-rate-limit-actions.test.ts` | 5 files, 102 tests passed |
| `npx vitest run tests/rate-limit.integration.test.ts --no-file-parallelism` (Testcontainers) | 5 passed |
| `npx vitest run tests/verify-routes.test.ts tests/create-ticket-rate-limit.test.ts tests/unit/design-contract.test.ts` | 3 files, 117 passed |
| Plan-level unit batch (5 files) | 39 passed |
| `tests/licence-enforcement-boundary.test.ts` (re-run after Task 3) | 41 passed |
| `tests/components/register-form`, `verify-set-password`, `learner-support` (one at a time) | 2, 4, 25 passed |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint` on all 16 touched files | clean |
| Acceptance-criteria greps (all three tasks) | all PASS |

## Next Phase Readiness

Plan 15-03 is done. The limiter is ready for the phase NFR-04/NFR-07 verification and the security review.

## Self-Check: PASSED

- All 7 created files exist on disk (checked).
- No commits were expected: this run does not commit, at the owner's rule, and nothing was staged.
- All acceptance criteria and plan-level verification commands were re-run and passed in this session.
