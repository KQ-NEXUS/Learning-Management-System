---
phase: 14-software-licence-deployment-control
plan: 12
subsystem: licensing
tags: [licence, learner-guard, checkout, registration, neutral-copy, d-06, d-08, d-09, oq8, a12, lic-05, lic-08]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-09 licenceService.assertWriteAllowed; 14-02 LicenceWriteBlockedError; 14-06 LEARNER_REFUSAL_MESSAGE; 14-DECISIONS.md OQ8/A12 adopted learner copy"
provides:
  - "checkout-service.ts: CheckoutServiceDeps.licence and guard calls (operations checkout.start, checkout.initiate_stripe, checkout.initiate_paystack) as the first statement of startCheckout, initiateStripePayment, initiatePaystackPayment; Prisma-backed factory bound to licenceService"
  - "registration-service.ts: REGISTRATION_UNAVAILABLE, RegistrationResult variant UNAVAILABLE, factory dependency licence, guard operation registration after validation and before any store call; singleton bound to licenceService"
  - "CheckoutNotice.tsx notice key unavailable rendering LEARNER_REFUSAL_MESSAGE in the existing warning style"
  - "Learner redirects /courses?notice=unavailable (enrollAction, payAction) and cohort-offer ?notice=unavailable (enrol page)"
affects: [14-13, 14-17, 14-21]

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 2
  confidence: low
actuals:
  tokens: 21000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Optional injected guard dependency (licence?: { assertWriteAllowed }) so existing unit tests without a guard are unchanged; the Prisma-backed wiring binds the real licenceService"
    - "Neutral learner refusal: one constant (LEARNER_REFUSAL_MESSAGE) reused by the notice and the register action; tests assert no /licen[cs]e|restricted|expir/i match"
    - "Registration guard placed after validation and before hashing and any store call, returning one frozen value, so the refusal cannot be an enumeration oracle (IAM-06)"

key-files:
  created: []
  modified:
    - src/server/services/checkout-service.ts
    - src/server/services/registration-service.ts
    - "src/app/(checkout)/actions.ts"
    - "src/app/(checkout)/enrol/[cohortId]/page.tsx"
    - "src/app/(checkout)/checkout/[orderId]/actions.ts"
    - "src/app/(public)/CheckoutNotice.tsx"
    - "src/app/(auth)/register/actions.ts"
    - tests/checkout-service.test.ts
    - tests/checkout-pay-action.test.ts
    - tests/registration-service.test.ts
    - tests/components/checkout-notice.test.tsx

key-decisions:
  - "The registration guard runs before password hashing (not after it): the plan says after input validation and before any store call, and since the refusal is uniform for every email there is no cost-symmetry concern; skipping the hash avoids pointless work on a refused request"
  - "The registration guard is called with actorId null (a visitor has no actor yet); only LicenceWriteBlockedError is mapped to REGISTRATION_UNAVAILABLE, any other guard failure propagates unchanged (the real gate fails open on read errors by design in 14-09)"
  - "payAction and enrollAction redirect a licence refusal to /courses?notice=unavailable per the plan; the enrol resumption page redirects to the cohort offer path with the same notice key"

patterns-established:
  - "Learner entry points outside withPermission carry an explicit guard through an injected dependency; plan 14-17 registry boundary test can require assertWriteAllowed in checkout-service.ts and registration-service.ts"

requirements-completed: []

coverage:
  - id: C1
    description: "D-08, T-14-12-01: with the guard rejecting, startCheckout, initiateStripePayment and initiatePaystackPayment each reject with LicenceWriteBlockedError; db.$transaction is called zero times (startCheckout) or not again (initiate functions); no provider session or Paystack initiation and no PaymentAttempt row; the guard receives the exact operation and the actor id"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/checkout-service.test.ts (describe 'Phase 14 - licence guard on new checkout sessions', 3 blocking tests) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "With an allowing guard or no guard the existing happy paths are unchanged, the guard operation sequence is checkout.start, checkout.initiate_paystack, checkout.start, checkout.initiate_stripe, and retireOpenPaymentAttempts never calls the guard"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/checkout-service.test.ts (3 further Phase 14 tests plus the 66 pre-existing tests) (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "OQ8/A12, LIC-05 learner prohibition, T-14-12-02/05: the unavailable notice renders exactly 'Enrolment is temporarily unavailable. Please contact support.' as a P with role status and border-l-2 border-warning bg-warning-surface; the constant and rendered text contain no match for /licen[cs]e|restricted|expir/i; an unknown key renders nothing"
    requirement: "LIC-05"
    verification:
      - kind: component
        ref: "tests/components/checkout-notice.test.tsx (3 new tests, 8 total) (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "D-08: payAction maps LicenceWriteBlockedError (Paystack and Stripe rails) to /courses?notice=unavailable, never to the payment=unavailable banner, and does not write the console.error line"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/checkout-pay-action.test.ts (2 new tests, 5 total) (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "D-06, A12, IAM-06, T-14-12-03: registerLearner under a blocking guard returns the frozen REGISTRATION_UNAVAILABLE with zero store, hash and dispatch calls; the results for an existing and a brand-new email are deep-equal and identical by identity; invalid input still returns INVALID_INPUT without calling the guard; non-licence guard errors propagate; allowing or absent guard leaves behaviour unchanged"
    requirement: "LIC-08"
    verification:
      - kind: unit
        ref: "tests/registration-service.test.ts (6 new guard tests plus the pre-existing registration tests) (pass)"
        status: pass
    human_judgment: false
  - id: C6
    description: "OQ8/A12: registerAction returns { error: LEARNER_REFUSAL_MESSAGE, sent: false } for UNAVAILABLE while every other failure keeps its text and success is unchanged"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/registration-service.test.ts (describe 'registerAction maps UNAVAILABLE', 2 tests) (pass)"
        status: pass
    human_judgment: false

duration: ~30min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 12: Learner Entry-Point Guards Summary

**New checkout sessions (start, Stripe initiate, Paystack initiate) and new learner registration now refuse in restricted continuity mode through an explicit injected `licence.assertWriteAllowed` guard before any transaction, provider call or store call, and every refusal surfaces as the single neutral sentence "Enrolment is temporarily unavailable. Please contact support." with no licence wording.**

## Performance

- **Duration:** about 30 min
- **Completed:** 2026-10-01
- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 auto; both marked tdd)
- **Files:** 0 created, 11 modified (7 source, 4 test)

## Accomplishments

- `checkout-service.ts`: `CheckoutServiceDeps.licence?` added; `startCheckout` (operation `checkout.start`), `initiateStripePayment` (`checkout.initiate_stripe`) and `initiatePaystackPayment` (`checkout.initiate_paystack`) call it as their first statement, ahead of the `runPaymentGuards` reads, the transaction and the provider adapters. `retireOpenPaymentAttempts` and all reads are untouched. `createPrismaBackedCheckoutService` binds `licence: licenceService`. `LicenceWriteBlockedError` propagates unchanged.
- `registration-service.ts`: `RegistrationResult` gains `{ ok: false; reason: "UNAVAILABLE" }`; frozen `REGISTRATION_UNAVAILABLE` exported next to `REGISTRATION_INVALID_INPUT`; the factory takes an optional `licence`; `registerLearner` calls it with operation `registration` after validation and before hashing and every store call, mapping only `LicenceWriteBlockedError`. The `registrationService` singleton is bound to `licenceService`. Sign-in, email verification and password reset were not touched (D-07).
- Learner mappings: `enrollAction` and `payAction` redirect to `/courses?notice=unavailable` (payAction before the `OrderNotPayableError` branch, so neither the "nothing was charged, try again" banner nor the operator console error is used); the enrol resumption page maps the error to notice key `unavailable` on the cohort offer path; `registerAction` returns `LEARNER_REFUSAL_MESSAGE` with `sent: false`.
- `CheckoutNotice.tsx`: key `unavailable` renders `LEARNER_REFUSAL_MESSAGE` through the existing warning-styled `role="status"` paragraph; header comment updated to five keys.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): checkout-service guard and wiring, enrollAction and enrol page mapping, `unavailable` notice, 6 service tests and 3 component tests. Commit: none (owner policy)
2. Task 2: payAction mapping, registration guard and result, registerAction mapping, 2 pay-action tests and 8 registration tests. Commit: none (owner policy)

TDD gate: the implementation was written before its tests (the plan lists the implementation in the action text), so no separate RED run exists and no `test(...)`/`feat(...)` commits exist, since commits are prohibited by owner policy. All new tests passed on the first run. To avoid vacuous passes the service tests assert concrete state (zero `$transaction` entries recorded by the fake, zero provider calls, empty order, enrolment and attempt stores, zero hash, store and dispatch calls) rather than only the thrown error, and the allow-path tests assert the exact operation sequence.

## Verification Results (real output)

- `npx vitest run tests/checkout-service.test.ts tests/checkout-pay-action.test.ts tests/registration-service.test.ts tests/checkout-intent.test.ts tests/boundary.test.ts tests/licence-purity.test.ts tests/checkout-phase-invariants.test.ts --project node`: 7 files passed, 171 tests passed, 0 failed. This includes the plan's node-project verify files plus the boundary closure test (the new `licence-service` import into the checkout and registration closures is accepted), the licence purity test and the checkout phase invariants (provider-isolation scan).
- `npx vitest run tests/components/checkout-notice.test.tsx --project components`: 1 file, 8 tests passed (5 pre-existing plus 3 new).
- Related files that import the changed modules, run for regression: `tests/communications-invariants.test.ts` (node, 6 passed); `tests/components/enrol-resumption.test.tsx` and `tests/components/checkout-summary.test.tsx` (components, 2 files, 38 passed).
- `npx tsc --noEmit`: no output, 0 errors (no new error).
- `npx eslint` on the 7 touched source files and 4 touched test files: 0 errors. Final warnings: 2 pre-existing `_userId` unused-variable warnings in `checkout-service.ts` (lines 630 and 643, not introduced by this plan). The two `_input` warnings my first test draft produced were fixed (typed `vi.fn` generic) and a re-run of eslint on both test files printed nothing.
- Not run (Docker integration, outside the plan's verify and not touched by a service closure change): `tests/checkout-intent.integration.test.ts`.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-12-PLAN.md LIC-05 LIC-08`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-05",
    "LIC-08"
  ],
  "total": 2
}
```

  No requirement is marked complete: both remain owned by later plans (14-13, 14-17, 14-21 prove settlement of initiated payments, the registry-driven enforcement boundary and the restricted-state proof). `requirements-completed` is therefore empty.

## Files Created/Modified

- `src/server/services/checkout-service.ts` - guard dependency, three guard calls, `licenceService` binding in the Prisma-backed factory
- `src/server/services/registration-service.ts` - `REGISTRATION_UNAVAILABLE`, result variant, guard dependency and call, singleton binding
- `src/app/(checkout)/actions.ts` - `enrollAction` redirects a licence refusal to `/courses?notice=unavailable`
- `src/app/(checkout)/enrol/[cohortId]/page.tsx` - licence refusal mapped to notice key `unavailable` on the cohort offer path
- `src/app/(checkout)/checkout/[orderId]/actions.ts` - `payAction` licence branch before the generic handling
- `src/app/(public)/CheckoutNotice.tsx` - `unavailable` key and header comment
- `src/app/(auth)/register/actions.ts` - UNAVAILABLE mapped to `LEARNER_REFUSAL_MESSAGE`
- `tests/checkout-service.test.ts`, `tests/checkout-pay-action.test.ts`, `tests/registration-service.test.ts`, `tests/components/checkout-notice.test.tsx` - new guard, mapping and wording tests

## Decisions Made

See key-decisions. Next.js: only the existing `redirect()` usage was extended (read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`); redirects stay in the catch branches exactly as the surrounding code already does, and no new route, cache or layout API was introduced.

## Deviations from Plan

### Auto-fixed Issues

None of Rules 1 to 3 applied: no bug, missing critical piece or blocker was found.

### Interpretation choices (no change to listed behaviours or the interface contract)

- The registration guard is placed before the password hash rather than after it. The plan fixes "after input validation and before any store call"; both positions satisfy that, and before the hash avoids a wasted hash for a request that is always refused. IAM-06 holds because the result is identical for every email.
- `registerAction` mapping is tested in `tests/registration-service.test.ts` (as the plan lists) by mocking only the `registrationService` singleton export of the module (`importOriginal` keeps `createRegistrationService` and the constants real), so the existing registration tests are unaffected.
- The registration guard passes `actorId: null` since a registering visitor has no actor.

**Total deviations:** 0 rule-based, 3 interpretation choices. **Impact:** none breaks the interface contract.

## Issues Encountered

A first draft of two test helpers produced `_input` unused-parameter eslint warnings; fixed with a typed `vi.fn<...>` generic. No auth gates, no checkpoints, no Rule 4 decisions.

## Outstanding Human UAT (browser-only, not run by this plan)

- With a deployment in restricted continuity mode (needs the 14-03 migration applied to a database, which is itself still an outstanding human step), clicking Enrol on a cohort offer lands on the catalogue showing the neutral notice in the warning style; the notice reads exactly "Enrolment is temporarily unavailable. Please contact support." and shows no licence wording.
- In the same state, the Pay button on an existing order returns to `/courses` with the neutral notice (not the "nothing was charged" banner), and the registration form shows the neutral sentence instead of creating an account; sign-in, email verification and password reset still work.
- Visual check that the `unavailable` notice is legible without colour (left border plus text, role status).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change: the plan adds guard calls and redirects to existing routes. Register items T-14-12-01 (guard-first and no-transaction tests), -02 (wording test), -03 (existing-versus-new email deep-equal test) and -05 (unknown key renders nothing) are covered by tests. T-14-12-04 holds by construction: only session creation is guarded here; webhook settlement of already-initiated payments is untouched and is plan 14-13.

## Next Phase Readiness

- Plan 14-13 can rely on `checkout.initiate_*` refusing new payment attempts while webhooks stay outside the guard. Plan 14-17's registry boundary test can require `assertWriteAllowed` in `src/server/services/checkout-service.ts` and `src/server/services/registration-service.ts` (both now contain it).
- Carried forward: the 14-03 migration apply to the shared database remains an outstanding human step (WINDOWS.md entry id 20); this plan used no database.
- Broken-windows ledger: no new stub, skipped test or unrun verify was introduced; the Docker-backed `tests/checkout-intent.integration.test.ts` was simply not part of this plan's verify and was not run, so nothing was appended to `.planning/WINDOWS.md`.

## Self-Check: PASSED

- FOUND on disk: src/server/services/checkout-service.ts (contains checkout.start, checkout.initiate_stripe, checkout.initiate_paystack); src/server/services/registration-service.ts (exports REGISTRATION_UNAVAILABLE, contains operation "registration"); the five app files; the four test files; this SUMMARY.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-01*
