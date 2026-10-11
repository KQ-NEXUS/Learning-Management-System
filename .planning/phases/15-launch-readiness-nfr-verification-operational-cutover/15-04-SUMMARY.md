---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 04
subsystem: auth
tags: [sign-in, account-enumeration, audit, nextjs-after, server-actions, security, prisma]

requires:
  - phase: 15-03
    provides: requestCorrelationId() in src/server/auth/request-context.ts; rate_limit.blocked audit action
  - phase: F-14b sign-in throttle
    provides: decoy-hash timing parity, recordFailure, throttle keys
provides:
  - "SignInResult failure arm with optional unverified: true, set only on a real-hash match for a PENDING_VERIFICATION account"
  - "signInAction: one S4 message for every INVALID result; after(() => verificationService.resendVerification(email)) on the unverified branch"
  - "Audit actions auth.sign_in.succeeded, auth.sign_in.failed, auth.sign_in.throttled, auth.sign_out with IP and correlationId"
  - "createAuthService now owns signOut(token, { ip }) with optional audit and correlationId dependencies"
  - "tests/audit-coverage.test.ts: NFR-07 guard over 39 required audit action strings"
affects: [15 NFR-04/NFR-07 verification, 15-16 privacy tools, 15-21 privacy audit actions, 15-30 staging (after() support), security review]

actuals:
  tokens: 9000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Side effects that must not change response content or timing run in after() from next/server"
    - "Auth audit writes are best-effort: logged by error name only, never change the result the person sees"
    - "Static audit-coverage scan: action: property values (literal, ternary, multi-line, named constant) under src/server"

key-files:
  created:
    - tests/auth-service-signin.test.ts
    - tests/audit-coverage.test.ts
  modified:
    - src/server/services/auth-service.ts
    - src/app/(auth)/signin/actions.ts
    - tests/identity-security.integration.test.ts
    - tests/components/signin-form.test.tsx

key-decisions:
  - "Auth audit writes (sign-in and sign-out) are best-effort: a failed audit insert is logged by error name only and never blocks or changes a sign-in, so the audit table cannot become an oracle or a lock-out"
  - "auth.sign_out is written only when the call actually revoked a session; an unknown or already-revoked cookie writes nothing"
  - "All four sign-in/out rows use targetType User; failed and throttled rows use actorId null with actorType SYSTEM; no reason text, so neither the address nor the password can reach free text"
  - "signOut moved into createAuthService (exported singleton unchanged in name) and now takes { ip } from the action"

patterns-established:
  - "New security or sensitive-business audit actions are added to REQUIRED_AUDIT_ACTIONS in tests/audit-coverage.test.ts"

requirements-completed: [NFR-04, NFR-07]

coverage:
  - id: D1
    description: "signIn flags unverified only for a right password on a PENDING_VERIFICATION account with a real hash; wrong password, unknown address, active-wrong, null-hash and deactivated get no flag; real hash verified once and decoy not used on the pending path; a throttle failure is recorded on every failure path"
    requirement: NFR-04
    verification:
      - kind: unit
        ref: "tests/auth-service-signin.test.ts (signIn — D-16 unverified branch)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Through signInAction on real Postgres: right password on an unverified account queues exactly one verification token and one stub email dispatch, only after the action has returned; a wrong password queues nothing; unknown, unverified and wrong-password states are byte-identical with the S4 message"
    requirement: NFR-04
    verification:
      - kind: integration
        ref: "tests/identity-security.integration.test.ts (D-16 describe, Testcontainers)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Four audit actions with IP and correlationId; failure rows target the user only when the account exists; throttled rows have no target; sign-out audited for the session's user; no row carries the password or typed address; audit failure never changes the result; real-sink rows land in AuditEvent"
    requirement: NFR-07
    verification:
      - kind: unit
        ref: "tests/auth-service-signin.test.ts (NFR-07 audit rows)"
        status: pass
      - kind: integration
        ref: "tests/identity-security.integration.test.ts (F-14a success row; D-16 failed row)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Sign-in form shows the full S4 sentence, keeps the typed email and focuses the alert; the action source contains the same sentence"
    requirement: NFR-04
    verification:
      - kind: unit
        ref: "tests/components/signin-form.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "Audit-coverage guard over 39 required actions with a negative self-check and an extractor self-check"
    requirement: NFR-07
    verification:
      - kind: unit
        ref: "tests/audit-coverage.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "after() actually delivers the resend on the Netlify host (assumption A15)"
    verification: []
    human_judgment: true
    rationale: "Only provable on the real host; staging plan 15-30 confirms delivery (T-15-04-05, accepted)"

duration: 86 min
completed: 2026-10-07
status: complete
---

# Phase 15 Plan 04: Neutral Sign-in Failure, Quiet Verification Resend and Sign-in Audit Summary

**One S4 message for wrong password, unknown address and unverified account; a fresh verification email is queued with `after()` only when the password matches the real hash of a PENDING_VERIFICATION account; sign-in success, failure, throttle and sign-out are now audited with IP and correlationId; a static guard pins 39 required audit actions.**

## Performance

- **Duration:** 86 min (2026-10-07T17:07:31Z to 18:33:24Z). About half of this was waiting on Docker and Testcontainers retries on a machine with roughly 0.4 to 1 GB of free memory.
- **Tasks:** 3 of 3
- **Files:** 2 created, 4 modified

## Accomplishments

- `auth-service.ts`: new branch before the decoy path. A PENDING_VERIFICATION account with a non-null hash is verified against its real hash, so the cost matches the decoy and an active account. The throttle failure is recorded, and the result is `{ ok: false, reason: "INVALID", unverified: true }` only on a match. Null-hash (contested registration) and deactivated accounts stay on the decoy path.
- `signin/actions.ts`: `after` imported from `next/server`. When the result is INVALID with `unverified`, `after(async () => verificationService.resendVerification(email))` runs, with errors logged by name only. Every INVALID result returns the same state with the S4 sentence. The empty-fields and throttled messages are unchanged. `signOutAction` now passes the client IP.
- Audit rows: `auth.sign_in.succeeded` (actor and target are the user, SUCCESS), `auth.sign_in.failed` (actor null, SYSTEM, target is the user id when the account exists, DENIED), `auth.sign_in.throttled` (actor null, SYSTEM, no target, DENIED), `auth.sign_out` (session's user, SUCCESS). Every row carries `ipAddress` and `correlationId` from `requestCorrelationId()`. Each failure path writes exactly one row, so known and unknown accounts do the same work.
- `tests/audit-coverage.test.ts`: reads every `.ts` file under `src/server` once and extracts `action:` values: literals, single-line and multi-line ternaries, and named constants such as `RATE_LIMIT_BLOCKED_ACTION`. Query filters (`action: { in: [...] }`), selects and comment lines are skipped. The test fails with `Missing audit action write site: <action>` for any required action that is missing.

### Required audit action list (for plans 15-16 and 15-21)

| Group | Actions |
|-------|---------|
| identity | auth.sign_in.succeeded, auth.sign_in.failed, auth.sign_in.throttled, auth.sign_out, rate_limit.blocked, user.verified, user.password_reset, user.email_changed |
| authorization | authorization.denied |
| roles | role.created, role.updated, assignment.created, assignment.revoked |
| users | user.created, user.deactivated, user.reactivated |
| money | order.paid, payment.manual_confirmed, payment.reconciled, refund.recorded, reconciliation.case_resolved |
| grades | grade.released, grade.released_batch, grade.overridden |
| credentials | certificate.issued, certificate.issued_auto, certificate.revoked, certificate.reissued |
| exports | export.requested, export.download_authorized |
| licence | licence.activated, licence.activation_rejected, licence.state_changed, licence.restriction_enforced |
| failures | domain_event.poisoned, refund.access_revoke_failed |

Plans 15-16 and 15-21 should add a `privacy` group to `REQUIRED_AUDIT_ACTIONS` when they write the privacy actions.

## Task Commits

Not committed (owner commits explicitly). All changes are left uncommitted in the working tree and nothing is staged.

1. **Task 1 (tracer): unverified branch, after() resend, S4 message.** Not committed (owner commits explicitly). Tracer gate: verify re-run end-to-end and passed before expansion.
2. **Task 2: sign-in and sign-out audit rows, form test.** Not committed (owner commits explicitly).
3. **Task 3: audit-coverage guard.** Not committed (owner commits explicitly).

## Files Created/Modified

- `src/server/services/auth-service.ts`: unverified branch, `audit` and `correlationId` dependencies, four audit actions, `signOut(token, { ip })` moved into the factory
- `src/app/(auth)/signin/actions.ts`: S4 constant, `after()` resend, IP passed to sign-out
- `tests/auth-service-signin.test.ts` (new): 18 unit cases, D-16 branch and NFR-07 rows
- `tests/identity-security.integration.test.ts`: `@/server/db` pointed lazily at the Testcontainers client; `next/headers`, `next/navigation` and `after` mocked; 3 new D-16 action cases; real-sink audit assertions; file-level 60 s test timeout
- `tests/components/signin-form.test.tsx`: full S4 sentence asserted, plus a check that the action source holds the same sentence
- `tests/audit-coverage.test.ts` (new): 14 cases including the two self-checks

## Decisions Made

See `key-decisions` above. The main one is that auth audit writes are best-effort. This matches the 15-03 rule that an audit-write failure is logged and does not change what the person sees.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Integration test needed the action's module singletons on the Testcontainers database**
- **Found during:** Task 1
- **Issue:** `signInAction` uses the `signIn` and `verificationService` singletons bound to `@/server/db`, which would otherwise point at the `.env` (shared Neon) database.
- **Fix:** `vi.mock("@/server/db")` with a lazy Proxy that forwards to the Testcontainers client once `beforeAll` has started it. `EMAIL_TRANSPORT=stub` and sender variables are stubbed, so no real email is sent.
- **Files modified:** tests/identity-security.integration.test.ts
- **Commit:** not committed (owner commits explicitly)

**2. [Rule 3 - Blocking] 5 s default timeout in the integration file on this machine**
- **Found during:** Task 1 and plan-level verification
- **Issue:** Under heavy memory pressure, existing cases timed out at Vitest's 5 s default, including two that never sign in. They pass with more time, so the cause is load, not behaviour.
- **Fix:** `vi.setConfig({ testTimeout: 60_000 })` at file level, with a comment. The plan's exact verify command then passed (15/15).
- **Files modified:** tests/identity-security.integration.test.ts
- **Commit:** not committed (owner commits explicitly)

**3. [Rule 2 - Missing critical] Real-sink proof for the audit rows**
- **Found during:** Task 2
- **Issue:** Audit writes are best-effort, so a broken insert (for example a constraint on `actorId` null) would be swallowed and no test would notice.
- **Fix:** Integration assertions that `auth.sign_in.succeeded` and `auth.sign_in.failed` rows really land in `AuditEvent` with IP and correlationId and without the address or password.
- **Files modified:** tests/identity-security.integration.test.ts
- **Commit:** not committed (owner commits explicitly)

**4. [Rule 2 - Missing critical] Sign-out IP**
- **Found during:** Task 2
- **Issue:** NFR-07 rows need the client IP, but `signOut(token)` had no context.
- **Fix:** `signOut(token, { ip })`. `signOutAction` passes `clientIpFrom(await headers())`.
- **Files modified:** src/server/services/auth-service.ts, src/app/(auth)/signin/actions.ts

**Total deviations:** 4 auto-fixed (2 blocking, 2 missing critical). **Impact:** no scope change, and no schema change.

## Issues Encountered

- Testcontainers was intermittent: 3 of 7 container starts failed (P1001 during `prisma migrate deploy`, a Docker HTTP 500, and "no such container"). Each failure is environmental. The orphaned containers from those failed starts were removed. Every run that got a database passed.
- One jsdom component run failed to start its worker ("Timeout waiting for worker to respond"). The retry passed. This is the same environment limit noted in 15-03.

## Verification run (this session)

| Command | Result |
|---------|--------|
| `npx vitest run tests/auth-service-signin.test.ts` (RED before each implementation step) | 2 failed, then 8 failed, as expected |
| `npx vitest run tests/auth-service-signin.test.ts tests/components/signin-form.test.tsx tests/audit-coverage.test.ts --testTimeout=60000` | 3 files, 35 passed |
| `npx vitest run tests/identity-security.integration.test.ts --no-file-parallelism` (Testcontainers) | 15 passed (final run includes the audit assertions) |
| `npx vitest run tests/token-hashing.test.ts tests/checkout-intent.test.ts` (other importers of the changed modules) | 2 files, 15 passed |
| `npx vitest run tests/licence-enforcement-boundary.test.ts --testTimeout=60000` | 41 passed |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint` on all 6 touched files | clean |
| Acceptance-criteria greps (all three tasks) | all PASS |

## Tracking

- `state.advance-plan` (run once), `state.record-metric`, two `state.add-decision`, `state.record-session` and `roadmap.update-plan-progress 15` ran and returned success. Phase 15 is still In Progress.
- `state.update-progress` skipped with "phase scope is unscoped, not complete". STATE.md's Progress field was left unchanged and was not edited by hand.
- `requirements.ready-ids <plan> NFR-04,NFR-07` returned 0 of 2 ready. Both IDs are blocked by sibling plans in phase 15 that declare them and have no SUMMARY yet, so REQUIREMENTS.md was not marked.

## Observations for the owner

- No schema migration was created, so nothing is added to the Neon go-live list.
- `after()` support on Netlify is still assumption A15. If it is not supported, the learner can still use the resend form on the verify page. Plan 15-30 checks this on staging.
- The new audit rows add one insert per sign-in attempt, including throttled attempts. Throttled attempts are already capped per device by the F-14b throttle.

## Next Phase Readiness

Plan 15-04 is done. U-11 is closed and NFR-07 sign-in auditing is in place. Ready for the next plan in phase 15.

## Self-Check: PASSED

- Both created files exist on disk: tests/auth-service-signin.test.ts and tests/audit-coverage.test.ts (checked).
- No commits were expected, because the owner commits explicitly. `git diff --cached` is empty.
- All acceptance criteria and the plan-level verification commands were re-run in this session and passed.
