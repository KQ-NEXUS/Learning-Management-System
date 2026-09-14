---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 08
subsystem: payments
tags: [manual-payment, refunds, paystack, stripe, postgres, testcontainers, row-locking]

requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-01)
    provides: "The locked refund-reversal policy (Decision A: reverse_transfer true/false by full/partial; Decision B: ship-and-record for Paystack split refunds)"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-07)
    provides: "checkout-webhook-system-service.ts's current settlement/SettlementProvider shape, already generalized to accept MANUAL"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-04)
    provides: "The Paystack tracer and provider adapter pattern (paystackFetch envelope-unwrap, provider-isolation scan)"
provides:
  - "src/server/services/manual-payment-service.ts — confirmManualPayment, permission-gated, delegating to the shared settlement transition for the actual PAID/ACTIVE write"
  - "src/server/services/refund-service.ts — recordRefund plus the pure allocateRefundComponents calculation, with a real Order-row lock closing a refund double-spend race"
  - "src/server/payments/providers/{paystack,stripe}/refund.ts — the two isolated provider refund adapters"
  - "orderCohortScope (cohort-scope.ts) — the Order-id-to-cohort-scope resolver both new services' withPermission gates need"
affects: [07-09, 07-10, 07-UAT]

actuals:
  tokens: 26200
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Manual confirmation recomputes the Order's own D-15 snapshot (gatewayFeeEstimateMinor -> 0, amountMinor -> base+platform) via a plain Order.update BEFORE calling activateOrderAsSystem, so the shared settlement transition's own REG-03 amount/currency match guard compares against the correct manual total instead of a stale online-rail one"
    - "Refund eligible-value cap enforcement uses a real Order-row SELECT ... FOR UPDATE lock plus an immediate PROCESSING reservation row, inside one transaction, before any provider network call — the same TOCTOU-closing shape seat-accounting.ts's lockOpenCohort already established for capacity, applied here to money"
    - "'Full' vs 'partial' refund is derived (amountMinor === eligibleMinor at write time), never a separate staff-declared flag that could disagree with the entered amount — this is what 07-01's reverse_transfer decision keys off directly"

key-files:
  created:
    - src/server/services/manual-payment-service.ts
    - src/server/services/refund-service.ts
    - src/server/payments/providers/paystack/refund.ts
    - src/server/payments/providers/stripe/refund.ts
    - tests/manual-payment-service.test.ts
    - tests/refund-service.test.ts
    - tests/manual-payment.integration.test.ts
    - tests/refund.integration.test.ts
  modified:
    - src/server/services/checkout-webhook-system-service.ts
    - src/server/services/cohort-scope.ts
    - src/server/payments/providers/paystack/client.ts
    - tests/checkout-phase-invariants.test.ts

key-decisions:
  - "'Full' vs 'partial' refund is DERIVED from amountMinor === eligibleMinor at write time, not a separate kind flag a caller could set inconsistently with the entered amount — collapses two sources of truth (an explicit 'full' declaration and 'refund everything remaining') into one, and is what feeds 07-01 Decision A's reverse_transfer boolean directly."
  - "A real Order-row lock (SELECT ... FOR UPDATE) plus an immediate PROCESSING Refund reservation, both inside one transaction, close a genuine TOCTOU the plan's own text implied but did not spell out as a required fix ('the two-partial-refunds-then-refuse cap under real concurrent reads') — without it, two concurrent recordRefund calls against the same Order could both read alreadyRefundedMinor=0 and together refund more than the eligible captured value. Rule 2 auto-fix (missing critical security/correctness functionality); proven by a real concurrent-request integration test against Postgres, not merely asserted in a comment."
  - "Manual confirmation's D-15 snapshot recomputation (gatewayFeeEstimateMinor -> 0) happens via a plain Order.update call BEFORE activateOrderAsSystem runs, rather than teaching the shared settlement service a MANUAL-specific fee-zeroing branch — keeps activateOrderAsSystem's own responsibility (the transition, not the commercial math) unchanged, and the manual-specific math lives in the manual-specific caller."
  - "Refund provider-call deps (paystackRefund/stripeRefund) are typed structurally in refund-service.ts, never via ReturnType<typeof providerFn> or an imported provider TYPE — mirrors checkout-service.ts's own established discretion for the identical PAY-09 concern, applied to both providers this time (Stripe's stricter unconditional isolation rule and Paystack's narrower type-only one)."
  - "The staff-attributed audit row ('payment.manual_confirmed' / 'refund.recorded') is written by the calling service itself, separately from activateOrderAsSystem's own SYSTEM-attributed audit rows — the shared settlement transition's audit never names an actor or a reason, so the ONE row PAY-03/PAY-05 need naming the confirming/approving actor has to come from the caller, not from delegating further."

patterns-established:
  - "orderCohortScope (cohort-scope.ts) — the Order-id two-hop scope resolver, following sessionCohortScope/enrolmentCohortScope's exact shape; CohortScopeDeps.order is optional so every pre-existing caller of createCohortScopeResolvers (attendance-service.ts, several integration tests) keeps compiling without supplying a delegate it never calls."

requirements-completed: [PAY-03, PAY-04, PAY-05, PAY-13]

coverage:
  - id: D1
    description: "A staff member holding payments.confirm confirms a manual payment through all seven required PAY-03 fields, reaching PAID/ACTIVE through the shared settlement transition, never writing the status itself"
    requirement: "PAY-03"
    verification:
      - kind: unit
        ref: "tests/manual-payment-service.test.ts (20 tests) — permission gating, all seven field-validation cases, D-15 snapshot recomputation, exactly-one-audit-row"
        status: pass
      - kind: integration
        ref: "tests/manual-payment.integration.test.ts#confirmManualPayment — real Postgres (PAY-03, PAY-04, PAY-10) > moves a real Order to PAID and the Enrolment to ACTIVE... with exactly one actor-attributed audit row and exactly one enrolment activation"
        status: pass
    human_judgment: false
  - id: D2
    description: "A second confirmation against an already-PAID Order returns the existing successful transaction and creates nothing — no second attempt, no second audit row, no second enrolment effect"
    requirement: "PAY-04"
    verification:
      - kind: unit
        ref: "tests/manual-payment-service.test.ts#confirmManualPayment — PAY-04 duplicate guard"
        status: pass
      - kind: integration
        ref: "tests/manual-payment.integration.test.ts#confirmManualPayment — real Postgres... > a second confirmation against the now-PAID Order returns ALREADY_PAID and creates no second attempt, no second audit row, and no second enrolment effect"
        status: pass
    human_judgment: false
  - id: D3
    description: "A refund is capped at the eligible captured value (learner total minus already-recorded refunds), computed server-side and never from a client-supplied balance; two partial refunds summing to the total are permitted, a third of any positive amount is refused; the cap holds under real concurrent requests via an Order-row lock"
    requirement: "PAY-05"
    verification:
      - kind: unit
        ref: "tests/refund-service.test.ts#recordRefund — eligible-value cap (PAY-05, D-22) (5 tests)"
        status: pass
      - kind: integration
        ref: "tests/refund.integration.test.ts#recordRefund — real Postgres eligible-value cap (PAY-05, D-22) > permits two sequential partial refunds... then refuses a third positive amount"
        status: pass
      - kind: integration
        ref: "tests/refund.integration.test.ts#recordRefund — real Postgres eligible-value cap (PAY-05, D-22) > serializes two CONCURRENT refund requests against the same Order — together they never exceed the eligible captured value"
        status: pass
    human_judgment: false
  - id: D4
    description: "allocateRefundComponents is pure, integer-only, and its four components always sum exactly to the refunded amount; a refund routes to the original provider (Paystack /refund or Stripe reverse_transfer), records the provider's actual reported outcome, and a provider failure leaves a non-COMPLETED status with the provider's own error recorded"
    requirement: "PAY-13"
    verification:
      - kind: unit
        ref: "tests/refund-service.test.ts#allocateRefundComponents — pure, integer-only (D-24) (6 table cases, property-asserted) and #recordRefund — routes to the original provider / provider failure is honest"
        status: pass
      - kind: integration
        ref: "tests/refund.integration.test.ts#recordRefund — real Postgres component allocation and access decision > a full refund's components sum exactly to the refunded amount, stored against real Postgres"
        status: pass
    human_judgment: false
  - id: D5
    description: "Stripe refunds pass reverse_transfer explicitly (true for full, false for partial, per 07-01 Decision A), asserted by reading the built request object; Paystack/Stripe refund types stay inside their own provider directories"
    requirement: "PAY-13"
    verification:
      - kind: unit
        ref: "tests/refund-service.test.ts#provider refund request builders — pure, no network call / #routes to the original provider"
        status: pass
      - kind: unit
        ref: "tests/checkout-phase-invariants.test.ts#phase-wide invariant: provider isolation (PAY-09)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The refund's access decision is recorded as its own explicit field, distinct from the money movement, with both RETAINED and REVOKED representable"
    requirement: "PAY-13"
    verification:
      - kind: unit
        ref: "tests/refund-service.test.ts#recordRefund — access decision is a distinct, explicit field (D-23)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A real Paystack test-mode refund of a split transaction and a real Stripe test-mode refund of a destination charge, confirming in each provider dashboard what happened to the school's settled portion"
    human_judgment: true
    rationale: "No sandbox-callable API substitutes for a live provider dashboard confirmation of an actual settlement reversal (this plan's own <verification> section names this as outstanding human verification, carried into 07-UAT.md, mirroring 07-01/07-04/07-06/07-07's identical precedent for real-provider-only facts)."

duration: ~140min
completed: 2026-09-13
status: complete
---

# Phase 07 Plan 08: Manual Payment Confirmation & Component-Aware Refunds Summary

**Manual bank-transfer confirmations and staff-initiated refunds both landed as permission-gated services that delegate all settlement writes to the existing shared transition — refunds are now capped by a real Postgres row lock that closes a genuine double-spend race, not merely a sequential-only check.**

## Performance

- **Duration:** ~140 min (includes real-Postgres Testcontainers runs for both new integration test files)
- **Tasks:** 3/3 completed
- **Files modified:** 12 (8 created, 4 modified)

## Accomplishments

- **`manual-payment-service.ts`** — `confirmManualPayment(actor, input)`, wrapped in `withPermission("payments.confirm", orderCohortScope)`. All seven PAY-03 fields (amount, currency, date, channel, reference, evidence key, reason) are validated server-side with zod; the PAY-04 duplicate guard runs BEFORE field validation (a resubmission against an already-PAID Order is refused with the existing successful attempt's provider/date/reference, even if the rest of the form is stale/incomplete). For a confirmable Order, the service recomputes the D-15 manual snapshot (`gatewayFeeEstimateMinor` -> 0, `amountMinor` -> base + 1.5% platform fee) via a plain `Order.update`, writes a `PaymentAttempt` (provider `MANUAL`, `PROCESSING`) carrying the manual evidence and the confirming actor id, then calls `activateOrderAsSystem` — the SAME shared settlement writer the Stripe/Paystack webhooks use — with `provider: "MANUAL"` and an idempotency key of `manual:{orderId}:{reference}`. `PENDING_MANUAL_REVIEW` stays deliberately unused, documented as such in the file's own header rather than left unexplained.
- **`refund-service.ts`** — `recordRefund(actor, input)`, wrapped in `withPermission("refunds.manage", orderCohortScope)`, plus the pure, exported `allocateRefundComponents(order, refundAmountMinor, alreadyRefundedMinor)`. The eligible-value cap (learner total minus every already-recorded, non-FAILED refund) is enforced inside a transaction that takes a real `SELECT ... FOR UPDATE` lock on the Order row and immediately inserts a `PROCESSING` reservation — closing a genuine TOCTOU that a plain read-then-write would leave open (see Deviations). The provider network call happens OUTSIDE that lock; a failure leaves the reservation `FAILED` with the provider's own error recorded, never a fabricated success. "Full" vs "partial" is derived (`amountMinor === eligibleMinor`), directly feeding 07-01 Decision A's `reverse_transfer` boolean. The access decision (`RETAINED`/`REVOKED`) is stored as its own field with zero side effects on Enrolment access.
- **`providers/paystack/refund.ts`** — `buildPaystackRefundRequest`/`refundPaystackTransaction`, `POST /refund` via the now-exported `paystackFetch`. Per 07-01 Decision B (B2), records exactly what Paystack reports and never assumes the school's subaccount settlement reversed.
- **`providers/stripe/refund.ts`** — `buildStripeRefundRequest`/`refundStripeCharge`. `reverse_transfer` is always passed explicitly, proven by a test reading the built request object, never inferred from Stripe's own default.
- **`orderCohortScope`** (`cohort-scope.ts`) — the missing Order-id-to-cohort-scope resolver both new services' `withPermission` gates need; `CohortScopeDeps.order` is optional so every pre-existing caller (`attendance-service.ts`, several integration tests) keeps compiling.
- **`checkout-webhook-system-service.ts`** — accepted `provider: "MANUAL"` was already generalized (07-04); this plan threads the provider into the enrolment-activation reason text (`"Manual payment confirmed"` instead of the pre-existing, silently-wrong-for-Paystack-too `"Stripe payment confirmed"` — Rule 1 fix) and into the audit action name (`order.paid_manual`/`enrolment.activated_manual`, additive, STRIPE/PAYSTACK action strings unchanged).
- **Real-Postgres proof, not BLOCKED:** Docker was available. `tests/manual-payment.integration.test.ts` (2 tests) and `tests/refund.integration.test.ts` (3 tests) both ran to completion against real Testcontainers Postgres and are green — including a genuinely concurrent two-request race test proving the Order-row lock serializes refunds correctly.

## Task Commits

Per this plan's `<global_constraints>` ("Never run `git commit`."), **no commits were made**. All changes are staged with `git add` only, task by task:

1. **Task 1 (TDD RED): failing manual-confirmation and refund lifecycle tests** — staged as part of the combined implementation below (see Deviations/Process note — implemented alongside Tasks 2/3 rather than a strict separately-staged RED-only snapshot, mirroring 07-07's own recorded precedent). Every case in the plan's `<behavior>` list has a corresponding, currently-passing assertion; none was weakened to make this pass.
   - Suggested message: `test(07-08): add failing manual-confirmation and refund lifecycle tests`
2. **Task 2: manual payment confirmation through the shared settlement transition** — staged: `src/server/services/manual-payment-service.ts` (new), `src/server/services/checkout-webhook-system-service.ts`, `src/server/services/cohort-scope.ts`, `tests/manual-payment-service.test.ts` (new), `tests/manual-payment.integration.test.ts` (new).
   - Suggested message: `feat(07-08): confirm manual payments through the shared settlement transition`
3. **Task 3: component-aware refunds routed to the original provider** — staged: `src/server/services/refund-service.ts` (new), `src/server/payments/providers/paystack/refund.ts` (new), `src/server/payments/providers/paystack/client.ts` (exported `paystackFetch`), `src/server/payments/providers/stripe/refund.ts` (new), `tests/checkout-phase-invariants.test.ts` (Paystack refund-path isolation rule extended), `tests/refund-service.test.ts` (new), `tests/refund.integration.test.ts` (new).
   - Suggested message: `feat(07-08): cap, allocate and route refunds to the original provider, with a real row lock closing the double-spend race`

**Plan metadata:** not committed (per constraint); `07-08-SUMMARY.md` staged with `git add` only.

## Files Created/Modified

- `src/server/services/manual-payment-service.ts` — `confirmManualPayment`, `ManualPaymentInput`, the `ALREADY_PAID` result shape, five typed refusals
- `src/server/services/refund-service.ts` — `recordRefund`, `RefundInput`, `allocateRefundComponents`, `RefundComponents`, `RefundTxClient`, `RefundExceedsEligibleValueError` and four sibling typed refusals
- `src/server/payments/providers/paystack/refund.ts` — `buildPaystackRefundRequest`, `refundPaystackTransaction`, `PaystackRefundRequest`/`PaystackRefundOutcome`
- `src/server/payments/providers/stripe/refund.ts` — `buildStripeRefundRequest`, `refundStripeCharge`, `StripeRefundOutcome`
- `src/server/payments/providers/paystack/client.ts` — exported the previously-module-private `paystackFetch` so `refund.ts` reuses the one envelope-unwrap discipline
- `src/server/services/cohort-scope.ts` — `orderCohortScope`, `OrderScopeDelegate`, `MissingOrderScopeDelegateError`; `CohortScopeDeps.order` made optional
- `src/server/services/checkout-webhook-system-service.ts` — provider-aware enrolment-activation reason text, `_manual`-suffixed audit action names for a MANUAL settlement
- `tests/checkout-phase-invariants.test.ts` — extended the Paystack isolation rule's `typeOnlySpecifierPrefixes` to cover `providers/paystack/refund`
- `tests/manual-payment-service.test.ts` (20 tests), `tests/refund-service.test.ts` (27 tests) — unit proofs, no Docker
- `tests/manual-payment.integration.test.ts` (2 tests), `tests/refund.integration.test.ts` (3 tests) — real-Postgres proofs, Docker was available

## Decisions Made

See `key-decisions` in frontmatter. The two genuinely load-bearing calls:

1. **"Full" vs "partial" refund is derived, never a separate staff-declared flag.** D-23's own wording ("a full refund request means the full captured learner total") is naturally satisfied by testing `amountMinor === eligibleMinor` at write time — this is also exactly the boolean 07-01 Decision A needs for `reverse_transfer`, so there is only one source of truth for "is this refund exhausting the balance," never two that could disagree.
2. **A real Order-row lock closes a refund double-spend race the plan's own text implied but did not spell out as a mandatory fix.** The plan's Task 1 action text asks for "the two-partial-refunds-then-refuse cap under real concurrent reads" as integration-test material — a naive read-then-write cap check cannot actually hold under real concurrency (two simultaneous requests could both read `alreadyRefundedMinor = 0` and together refund more than the eligible value). Rather than write an integration test that would either need to skip proving concurrency or expose a real bug, `recordRefund` was restructured so the cap check, the eligible-value read, and an immediate `PROCESSING` reservation all happen inside one transaction holding a `SELECT ... FOR UPDATE` lock on the Order row — mirroring `seat-accounting.ts`'s own `lockOpenCohort` pattern for the identical class of problem (seat capacity). Proven by a genuinely concurrent `Promise.allSettled` integration test against real Postgres, not asserted only in a comment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Refund eligible-value cap needed a real Order-row lock, not a plain read-then-write check**
- **Found during:** Task 3, while designing the refund integration test the plan itself asks for ("the two-partial-refunds-then-refuse cap under real concurrent reads")
- **Issue:** The initial design read `Order` and `aggregateRefundedMinor` with two separate, unlocked queries, then wrote the `Refund` row afterward. Two concurrent `recordRefund` calls against the SAME Order could both observe the same "already refunded" total before either commits, and together exceed PAY-05's eligible-value cap — a real security/correctness gap, not a hypothetical one.
- **Fix:** Restructured `recordRefund` around a `RefundTxClient` transaction surface: `lockOrder` takes a `SELECT ... FOR UPDATE` lock, then the cap check and an immediate `PROCESSING` `Refund` reservation happen inside that same transaction (so a second locker's `aggregateRefundedMinor` sees the first's in-flight reservation). The provider network call and the final status update happen after the transaction commits, mirroring `initiatePaystackPayment`/`initiateStripePayment`'s own "create PaymentAttempt in a transaction, call the provider after" shape.
- **Files modified:** `src/server/services/refund-service.ts`, `tests/refund-service.test.ts` (harness updated to the new `db.$transaction`/`refund.update` deps shape)
- **Verification:** `tests/refund-service.test.ts` (27/27, unit) plus `tests/refund.integration.test.ts`'s dedicated concurrent-request case (2 simultaneous refund requests summing to one more than the eligible total — exactly one succeeds, real Postgres) both pass.

**2. [Rule 3 - Blocking] `CohortScopeDeps` needed an `order` delegate that did not exist, but making it required broke every pre-existing caller**
- **Found during:** Task 2, `tsc --noEmit`
- **Issue:** Adding `orderCohortScope` required a new `OrderScopeDelegate` on `CohortScopeDeps`. Making it a required field broke compilation for `attendance-service.ts` and three test files that construct `createCohortScopeResolvers` instances without ever calling `orderCohortScope`.
- **Fix:** Made `CohortScopeDeps.order` optional; `orderCohortScope` throws a clearly-named `MissingOrderScopeDelegateError` if invoked on an instance built without one, rather than a bare "Cannot read property of undefined."
- **Files modified:** `src/server/services/cohort-scope.ts`
- **Verification:** `tsc --noEmit` clean project-wide; `tests/attendance-service.test.ts` and `tests/cohort-scope.test.ts` both still pass.

**3. [Rule 1 - Bug] `activateOrderAsSystem`'s enrolment-activation reason was hard-coded to "Stripe payment confirmed" for every provider, including Paystack, before this plan**
- **Found during:** Task 2, while wiring the MANUAL provider through the shared settlement transition
- **Issue:** A pre-existing (07-04-era) literal wrote `"Stripe payment confirmed"` onto the Enrolment's activation reason regardless of which provider actually settled the Order — already silently wrong for Paystack, and would have been actively misleading for a manual confirmation.
- **Fix:** The reason text now names the actual provider (`Stripe`/`Paystack`/`Manual`); the Stripe wording is preserved byte-for-byte for backward compatibility.
- **Files modified:** `src/server/services/checkout-webhook-system-service.ts`
- **Verification:** `tests/checkout-webhook-system-service.test.ts` (unaffected — no test in that file asserts this string); `tests/enrolment-service.test.ts`'s own unrelated uses of the same literal string (calling `applyEnrolmentActivation` directly with a test-supplied reason) confirmed untouched by this change.

---

**Total deviations:** 3 auto-fixed (1 missing-critical security fix, 1 blocking-compile, 1 pre-existing correctness bug). **Impact on plan:** The row-lock fix is the only one with real behavioral weight — it closes a genuine TOCTOU the plan's own verification language pointed at without spelling out the mechanism; no scope creep beyond what Task 3's own concurrency-proof request already implied.

## Issues Encountered

- A duplicate, accidental concurrent `vitest run` of the same integration test file (an operator mistake mid-session, two Testcontainers Postgres instances racing for the same Docker resources) caused one run's `beforeAll` hook to time out at 300s. Not a code defect — recognized immediately from the stalled migration log, the stray run was left to exit on its own (Testcontainers cleans up automatically), and a single clean re-run completed normally in ~224s. No stray containers or state were left behind (`docker ps` confirmed clean afterward).
- Docker was available throughout this session (confirmed via `docker ps` before Task 1), so neither `tests/manual-payment.integration.test.ts` nor `tests/refund.integration.test.ts` is BLOCKED — all 5 cases across both files ran to completion against real Postgres and are green.

## User Setup Required

None — this plan reads no new environment variable and introduces no new external service dependency; it calls the same `PAYSTACK_SECRET_KEY`/`STRIPE_SECRET_KEY`-backed adapters 07-01/07-04/07-06 already provisioned.

**Outstanding human verification** (carried into `07-UAT.md`, mirroring 07-01/07-04/07-06/07-07's identical precedent): a real Paystack test-mode refund of a split transaction and a real Stripe test-mode refund of a destination charge, confirming in each provider dashboard what actually happened to the school's settled portion. Not attempted in this sandbox — no live provider evidence exists yet for the underlying split/destination charges themselves (06-09/07-04/07-07's own outstanding human verifications), so there is nothing live to refund against.

## Next Phase Readiness

- 07-09/07-10 (Finance payment-detail UI) can now build the "Confirm manual payment" and "Record refund" dialogs directly against `confirmManualPayment`/`recordRefund`'s typed inputs and result shapes — both are fully wired, permission-gated, server-validated services, not stubs.
- `allocateRefundComponents` is exported as a pure function, ready for a Finance detail page to preview the component split before submission without a server round trip.
- `orderCohortScope` is available for any future Order-scoped staff action to reuse rather than re-deriving a resolver.
- No blockers. All changes staged (`git add`) but **not committed** per this plan's global constraint — the repository owner should review the staged diff and commit using the suggested per-task messages above (or a squashed equivalent) before continuing to 07-09.

## Known Stubs

None — every layer this plan touches (both services, both provider refund adapters, the settlement-service extension) is fully wired against real logic, real Postgres transactions, and a real row lock. The one deliberately deferred piece is the human-only real-provider dashboard verification noted above, outside this plan's automatable scope by design (07-01/07-04/07-06/07-07's own precedent for the same kind of deferral).

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-13*
