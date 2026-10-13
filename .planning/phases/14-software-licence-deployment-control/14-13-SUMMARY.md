---
phase: 14-software-licence-deployment-control
plan: 13
subsystem: payments
tags: [licence, payments, webhook-settlement, restricted-continuity, initiated-before-rule, reconciliation, d-08, oq4, a13, lic-05, lic-08]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-09 licenceService.getRestrictionCutoff (restrictedAt equals graceEndsAt exactly, fails open); 14-02/14-04 SKEW_TOLERANCE_MS; 14-12 checkout/registration guards; 14-DECISIONS.md OQ4/A13 adopted payment-confirmation rule"
provides:
  - "checkout-webhook-system-service.ts: SettlementDeps.licence, module-private PaymentAfterRestrictionError, initiated-before rule in activateOrderAsSystem, reason payment_after_restriction mapped to reconciliation risk CAPTURED_MONEY, singleton wired to licenceService"
  - "event-mappers/staff.ts: ORDER_EXCEPTION_REASON_LABELS entry payment_after_restriction (fixed neutral sentence)"
  - "tests/licence-payments.integration.test.ts: real-Postgres proof of before, in-flight expiry, tolerance boundary, manual, operational webhooks and not-restricted behaviour"
affects: [14-17, 14-21]

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 3
  confidence: low
actuals:
  tokens: 13000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Optional injected cutoff dependency (licence?: { getRestrictionCutoff }) read once before the settlement transaction opens, so no licence query runs while the Order row is locked; a read failure is caught, logged by error name only, and treated as not restricted"
    - "Anchor chosen by rail: the matched PaymentAttempt.initiatedAt for a provider webhook, Order.createdAt for a manual confirmation (its attempt is created inside the settlement transaction); an absent anchor counts as before the cutoff"
    - "Money-recording exception reuses the existing illegal-transition shape: attempt to SUCCEEDED with an exceptionNote, Order to EXCEPTION unless already settled, one coded order.exception outbox row, no enrolment or seat write"

key-files:
  created:
    - tests/licence-payments.integration.test.ts
  modified:
    - src/server/services/checkout-webhook-system-service.ts
    - src/server/services/event-mappers/staff.ts
    - tests/checkout-webhook-system-service.test.ts
    - tests/event-mappers-staff.test.ts

key-decisions:
  - "The cutoff comparison is strictly greater than: an anchor at exactly restrictedAt plus 10 minutes is settled normally and plus 1 ms becomes the exception, as the plan's explicit boundary truth requires"
  - "An already-settled Order that receives a payment initiated after the restriction keeps its settled status; the attempt is still recorded SUCCEEDED and the same coded order.exception event is written (the existing F-16 rule, applied unchanged)"
  - "The coded reason is always payment_after_restriction in this branch, including for an already-settled order; the exceptionNote wording is neutral ('confirmed after enrolment activation was unavailable; money captured, needs reconciliation') and never names the licence"
  - "The webhook route, recordWebhookEventOrSkip, recordPaymentFailureAsSystem and recordSessionExpiredAsSystem are untouched and never consult the licence dependency (proven by unit and integration tests)"

patterns-established:
  - "Settlement integration tests insert Orders and PaymentAttempts directly with explicit createdAt and initiatedAt, and point DATABASE_URL at the container before dynamically importing the settlement module so the @/server/db singleton can never reach the shared database"

requirements-completed: []

coverage:
  - id: C1
    description: "D-08, T-14-13-01: a payment initiated before the restriction instant completes and receives its entitlement after the restriction (PaymentAttempt SUCCEEDED, Order PAID, Enrolment ACTIVE, no order.exception); the cutoff the settlement reads equals graceEndsAt exactly"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-payments.integration.test.ts (before) + tests/checkout-webhook-system-service.test.ts (activates an attempt initiated one hour before) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "D-08 in-flight expiry: an attempt created one minute before R, while the real guard still allowed new sessions, settles after R and activates, while the same guard refuses a new session after R"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-payments.integration.test.ts (in-flight expiry) (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "D-08 boundary, T-14-13-02: initiatedAt exactly R plus 10 minutes settles normally and R plus 10 minutes plus 1 ms becomes the payment_after_restriction exception with the attempt SUCCEEDED (money recorded), Order EXCEPTION, Enrolment still PENDING_PAYMENT, cohort seat counter unchanged, exactly one coded order.exception event, no order.paid, a CAPTURED_MONEY reconciliation case and a SYSTEM audit row; a redelivery stays an echo"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-payments.integration.test.ts (tolerance boundary, 2 tests) (pass)"
        status: pass
      - kind: unit
        ref: "tests/checkout-webhook-system-service.test.ts (tolerance boundary and already-settled tests) (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "OQ4 and A13, T-14-13-04: a manual confirmation is judged by Order.createdAt, not by the in-transaction attempt: an order created before R activates even though its manual attempt is created after R; an order created at R plus 11 minutes (or plus 10 minutes plus 1 ms in the unit test) becomes the exception with the manual evidence fields intact and the order.exception_manual audit action"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-payments.integration.test.ts (manual) (pass)"
        status: pass
      - kind: unit
        ref: "tests/checkout-webhook-system-service.test.ts (describe 'D-08 manual confirmation anchor', 4 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "T-14-13-03: a licence read failure fails open: a rejecting cutoff dependency (unit) and a licence service over a database whose LicenceState read throws (integration) both leave the paid order activating; the error is logged by name only"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-payments.integration.test.ts (T-14-13-03) (pass)"
        status: pass
      - kind: unit
        ref: "tests/checkout-webhook-system-service.test.ts (T-14-13-03 rejecting cutoff read) (pass)"
        status: pass
    human_judgment: false
  - id: C6
    description: "D-08 operational: recordWebhookEventOrSkip records a new event and skips a duplicate while restricted; recordPaymentFailureAsSystem and recordSessionExpiredAsSystem still work and never consult the licence dependency; a refund through the real withPermission with the real licence guard runs without consulting the guard (refunds.manage is continuity) while a write-effect permission (courses.edit) is refused in the same state"
    requirement: "LIC-08"
    verification:
      - kind: integration
        ref: "tests/licence-payments.integration.test.ts (operational webhooks) (pass)"
        status: pass
      - kind: unit
        ref: "tests/checkout-webhook-system-service.test.ts (never consult the licence dependency) (pass)"
        status: pass
    human_judgment: false
  - id: C7
    description: "Not restricted: an ACTIVE licence and a never-activated deployment (OQ1 option-a) settle every date exactly as before, with or without a licence dependency; a missing initiatedAt on an older fake counts as before the cutoff"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-payments.integration.test.ts (not restricted, 2 tests) (pass)"
        status: pass
      - kind: unit
        ref: "tests/checkout-webhook-system-service.test.ts (not restricted; missing initiatedAt; fail open without restrictedAt) (pass)"
        status: pass
    human_judgment: false
  - id: C8
    description: "T-14-13-05 and T-13-03: the staff label for payment_after_restriction is the fixed sentence 'Payment received while new enrolments were unavailable', matches no /licen[cs]e|restricted|expir/i, never leaks the raw code, an unknown reason still renders 'Payment needs review', and the learner order-exception mapper emits nothing for the reason"
    requirement: "LIC-08"
    verification:
      - kind: unit
        ref: "tests/event-mappers-staff.test.ts (2 new tests) (pass)"
        status: pass
    human_judgment: false
  - id: C9
    description: "Closure rule: checkout-webhook-system-service.ts gains only licence-service and @/server/licence/constants imports; its runtime closure stays free of next/headers and the permission layer, and the PAY-09/PAY-10 provider-isolation invariants still hold"
    requirement: "LIC-08"
    verification:
      - kind: unit
        ref: "tests/boundary.test.ts, tests/licence-purity.test.ts, tests/checkout-phase-invariants.test.ts (pass)"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-10-02
status: complete
---

# Phase 14 Plan 13: Initiated-Before Payment Rule Summary

**In restricted continuity mode a webhook or manual payment initiated at or before the restriction instant plus 10 minutes still completes and delivers its entitlement, while anything later records the captured money (attempt SUCCEEDED), flags the Order EXCEPTION with the coded reason `payment_after_restriction`, leaves enrolment and seats untouched and opens a CAPTURED_MONEY reconciliation case, with webhooks, failure recording and refunds still operational, all proven on a real Postgres.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-10-02
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 1 created, 4 modified (2 source, 3 test counting the created one)

## Accomplishments

- `checkout-webhook-system-service.ts`: `SettlementDeps.licence?: { getRestrictionCutoff }`. `activateOrderAsSystem` reads the cutoff once before the transaction opens (failure caught, logged by name, treated as not restricted). Inside the activation try block, after the enrolment presence check and before `lockOpenCohort` and `applyEnrolmentActivation`, a restricted cutoff with a `restrictedAt` compares the anchor (`order.createdAt` for a manual confirmation, the matched attempt's `initiatedAt` otherwise) with `restrictedAt + SKEW_TOLERANCE_MS`; strictly greater throws the module-private `PaymentAfterRestrictionError`. The catch records the money in the existing illegal-transition shape and returns outcome EXCEPTION, reason `payment_after_restriction`, which the reconciliation sync maps to risk CAPTURED_MONEY. The order select gained `createdAt`, the attempt select gained `initiatedAt` (both optional on the structural row types, so older fakes still type-check). The singleton `settlementDeps` is wired to `licenceService`.
- `event-mappers/staff.ts`: `payment_after_restriction` maps to "Payment received while new enrolments were unavailable". The learner mapper stays silent for it (it only mails `illegal_transition`).
- The webhook route, `recordWebhookEventOrSkip`, `recordPaymentFailureAsSystem` and `recordSessionExpiredAsSystem` were not touched.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): service rule, wiring, 9 unit tests. Commit: none (owner policy)
2. Task 2: manual anchor tests (4), staff label and learner-silence tests (2), staff label entry. Commit: none (owner policy)
3. Task 3: `tests/licence-payments.integration.test.ts` (9 Testcontainers tests). Commit: none (owner policy)

TDD gate: the service code was written before its tests (the plan's action text lists the implementation first), so no separate RED run exists and no `test(...)` or `feat(...)` git commits exist because commits are prohibited by owner policy. One first-run unit failure was a wrong expectation of mine (I assumed activation increments `seatsTaken`; the held seat is already counted, so the counter is unchanged). The integration file passed on its first run (9 of 9). To guard against vacuous passes the tests assert concrete database state (Order, Enrolment, PaymentAttempt, cohort seat counter, outbox rows, reconciliation case and audit rows), and the boundary cases prove both sides of the comparison (ACTIVATED at plus 10 minutes, EXCEPTION at plus 10 minutes plus 1 ms) so a rule that never fired or always fired would fail.

## Verification Results (real output)

- `npx vitest run tests/checkout-webhook-system-service.test.ts tests/event-mappers-staff.test.ts tests/event-mappers-enrolment-payment.test.ts --project node`: 3 files passed, 77 tests passed, 0 failed (checkout-webhook-system-service now 39 tests incl. 13 new in two describes).
- `npx vitest run tests/licence-payments.integration.test.ts tests/boundary.test.ts --project node --no-file-parallelism`: 2 files passed, 33 tests passed, 0 failed (licence-payments 9 tests; Testcontainers postgres, all 24 migrations applied; Docker was reachable).
- `npx vitest run tests/checkout-webhook-system-service.test.ts tests/event-mappers-staff.test.ts tests/event-mappers-enrolment-payment.test.ts tests/licence-purity.test.ts tests/checkout-phase-invariants.test.ts --project node`: 5 files passed, 113 tests passed (also confirms PAY-09/PAY-10 invariants and the licence purity rule).
- Regression for the changed singleton wiring (the real route and services now call `licenceService.getRestrictionCutoff` against a migrated container where the state is UNLICENSED): `npx vitest run tests/checkout-webhook.integration.test.ts tests/paystack-webhook.integration.test.ts tests/manual-payment.integration.test.ts --project node --no-file-parallelism`: 3 files passed, 30 tests passed.
- `npx tsc --noEmit`: no output, 0 errors (no new error).
- `npx eslint` on `checkout-webhook-system-service.ts`, `event-mappers/staff.ts`, `tests/checkout-webhook-system-service.test.ts`, `tests/event-mappers-staff.test.ts` and `tests/licence-payments.integration.test.ts`: no output, 0 findings.
- Acceptance greps: `payment_after_restriction` present in the service (4 occurrences) and in `staff.ts` (1); `SKEW_TOLERANCE_MS` import present; integration test titles contain before, in-flight, tolerance boundary, manual and operational webhooks.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-13-PLAN.md LIC-05 LIC-08`, output verbatim:

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

  No requirement is marked complete: both remain owned by later plans (the registry-driven enforcement boundary 14-17 and the restricted-state proof 14-21). `requirements-completed` is therefore empty.

## Files Created/Modified

- `src/server/services/checkout-webhook-system-service.ts` - `SettlementDeps.licence`, `PaymentAfterRestrictionError`, cutoff read, anchor comparison, money-recording catch branch, CAPTURED_MONEY mapping, singleton wiring, header doc bullet
- `src/server/services/event-mappers/staff.ts` - label entry for `payment_after_restriction`
- `tests/checkout-webhook-system-service.test.ts` - harness exposes `cohorts` and optional `createdAt` and `initiatedAt`; 13 new tests in two describes
- `tests/event-mappers-staff.test.ts` - neutral label and learner-silence tests
- `tests/licence-payments.integration.test.ts` - 9 real-Postgres tests

## Decisions Made

See key-decisions. Next.js: no Next.js API was written or changed (service and test code only), so no framework guide applied.

## Deviations from Plan

### Auto-fixed Issues

None of Rules 1 to 3 applied: no bug, missing critical piece or blocker was found in prior work.

### Interpretation choices (no change to the plan's listed behaviours or the interface contract)

- The plan's Task 1 listed `licence` plus a fake that returns `restrictedAt`; I added a unit test for `restricted: true` with `restrictedAt: null` (applies no rule) so a malformed cutoff cannot block a payment (fail-open consistent with T-14-13-03).
- The integration "operational webhooks" test runs the real `withPermission` choke point with the real licence guard through `createTestWithPermission` and the real refund service over Testcontainers, and additionally asserts the guard is never called for `refunds.manage` while `courses.edit` is refused in the same state, so the test proves the guard is live rather than absent.
- Three extra integration tests beyond the plan's six (redelivery stays an echo, never-activated deployment, failing LicenceState read) were added; none weakens or replaces a planned case.
- `recordPaymentFailureAsSystem` and `recordSessionExpiredAsSystem` are Stripe-only entry points, so the operational integration test flips the seeded attempt to provider STRIPE for those two cases.

**Total deviations:** 0 rule-based, 4 interpretation choices. **Impact:** none breaks the interface contract.

## Issues Encountered

One wrong expectation in my own first unit test run (see TDD gate); corrected, no service change. No auth gates, no checkpoints, no Rule 4 decisions.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the plan adds one rule inside an existing transaction and one label. Register items T-14-13-01 (branch tests on unit and real database), -02 (exact tolerance boundary tests), -03 (fail-open tests), -04 (manual anchor tests), -05 (label wording test) and -06 (order.exception event, SYSTEM audit row and CAPTURED_MONEY reconciliation case asserted) are covered.

## Next Phase Readiness

- Plan 14-17's registry boundary test can treat `checkout-webhook-system-service.ts` as SYSTEM with the D-08 rule now in place; plan 14-21's restricted-state proof can reuse `tests/licence-payments.integration.test.ts` fixtures.
- Carried forward: the 14-03 migration apply to the shared database remains an outstanding human step (WINDOWS.md entry id 20); this plan used Testcontainers only and never connected to the configured DATABASE_URL (the integration test points `process.env.DATABASE_URL` at the container before importing the settlement module and injects `testDb.prisma` everywhere).
- Broken-windows ledger: no new stub, skipped test or unrun verify was introduced, so nothing was appended to `.planning/WINDOWS.md`.

## Self-Check: PASSED

- FOUND on disk: src/server/services/checkout-webhook-system-service.ts (contains payment_after_restriction and the SKEW_TOLERANCE_MS import); src/server/services/event-mappers/staff.ts (contains payment_after_restriction); tests/licence-payments.integration.test.ts; tests/checkout-webhook-system-service.test.ts; tests/event-mappers-staff.test.ts; this SUMMARY.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-02*
