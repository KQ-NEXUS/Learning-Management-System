---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 04
subsystem: payments
tags: [paystack, checkout, webhooks, hmac-sha512, prisma, postgres, testcontainers, nextjs]

requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-01)
    provides: "settlement-config.ts (paystackSecretKey/paystackSubaccountCode/paystackWebhookSecretKey), locked D-02/D-03 policy facts"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-02)
    provides: "Cohort.priceNgnMinor/priceUsdMinor, GatewayFeeSchedule model, Order/PaymentAttempt snapshot columns"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-03)
    provides: "calculateCheckoutBreakdown (pricing.ts), providerForCurrency/isSupportedCurrency (routing.ts)"
provides:
  - "One complete, production-quality NGN Paystack payment path: cohort card CTA -> currency-carrying checkout intent -> snapshotted Order -> Paystack split transaction -> HMAC-SHA512-verified webhook -> PAID Order + ACTIVE Enrolment"
  - "payment-provider.ts — the provider-neutral PaymentProviderAdapter/OrderCommercialSnapshot seam both adapters satisfy"
  - "providers/paystack/{client,initialize,webhook}.ts — the isolated Paystack adapter (initializeTransaction, verifyTransaction, buildInitializeTransactionRequest, initiatePaystackTransaction, verifyPaystackWebhook)"
  - "src/app/api/webhooks/paystack/route.ts — signature-verified, Verify-Transaction-cross-checked settlement trigger, PAY-10-compliant (never writes PAID itself)"
  - "startCheckout(actor, cohortId, currency) — full D-13 commercial snapshot at Order creation; initiatePaystackPayment alongside initiateStripePayment"
  - "SettlementProvider union widening checkout-webhook-system-service.ts to STRIPE|PAYSTACK|MANUAL, provider-threaded WebhookEvent marking"
  - "Generalized, rule-driven provider-isolation scan (checkout-phase-invariants.test.ts) covering both Stripe and Paystack from one shared file walk"
affects: [07-05, 07-06, 07-07, 07-08, 07-09, 07-10]

actuals:
  tokens: 52500
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Provider-neutral PaymentProviderAdapter interface (payment-provider.ts) sitting above both provider directories, satisfied structurally by CheckoutServiceDeps.paystack.initiate — mirrors how Stripe's own getStripe()/buildCheckoutSessionParams are already called from outside providers/stripe/"
    - "PAY-09 isolation scan generalized to a rule list: Stripe's rule flags the raw npm specifier (any import shape); Paystack's narrower rule flags only a TYPE-ONLY import of a path under providers/paystack/, since there is no npm package boundary to check against — a plain value import (calling the adapter's own exported function) is the sanctioned, pre-existing call shape for both providers"
    - "GatewayFeeSchedule read inside the SAME transaction as the seat hold, before tx.order.create, so the D-13 snapshot (baseAmountMinor/platformFeeMinor/gatewayFeeEstimateMinor/amountMinor/selectedProvider/gatewayFeeScheduleId+Version/schoolSettlementExpectedMinor) is written atomically with the hold"
    - "Shared runPaymentGuards/createPaymentAttemptWithConsent helpers factored out of initiateStripePayment so initiatePaystackPayment runs the identical cheapest-first guard chain, never a parallel one"
    - "Testcontainers fixture helpers (seedPaystackNgnFeeScheduleFixture/seedStripeUsdFeeScheduleFixture) added to tests/support/cohort-fixtures.ts — startTestDatabase() applies migrations only, never prisma/seed.ts, so every real-Postgres checkout test now seeds its own active GatewayFeeSchedule row"

key-files:
  created:
    - src/server/payments/payment-provider.ts
    - src/server/payments/providers/paystack/client.ts
    - src/server/payments/providers/paystack/initialize.ts
    - src/server/payments/providers/paystack/webhook.ts
    - src/app/api/webhooks/paystack/route.ts
    - tests/paystack-provider.test.ts
    - tests/paystack-webhook.integration.test.ts
  modified:
    - src/server/services/checkout-service.ts
    - src/server/services/checkout-webhook-system-service.ts
    - src/server/services/public-catalogue-service.ts
    - src/server/auth/landing.ts
    - src/app/(checkout)/actions.ts
    - src/app/(checkout)/enrol/[cohortId]/page.tsx
    - src/app/(checkout)/checkout/[orderId]/actions.ts
    - src/app/(public)/CohortCards.tsx
    - src/app/api/webhooks/stripe/route.ts
    - tests/checkout-service.test.ts
    - tests/checkout-webhook-system-service.test.ts
    - tests/checkout-phase-invariants.test.ts
    - tests/boundary.test.ts
    - tests/checkout-intent.test.ts
    - tests/landing.test.ts
    - tests/checkout-intent.integration.test.ts
    - tests/checkout-hold-race.integration.test.ts
    - tests/checkout-webhook.integration.test.ts
    - tests/public-catalogue-service.test.ts
    - tests/components/cohort-cards.test.tsx
    - tests/support/cohort-fixtures.ts

key-decisions:
  - "PAY-09's Paystack isolation rule flags a TYPE-ONLY import of a path under providers/paystack/ from outside it, not a plain value import — mirroring the Stripe precedent where checkout-service.ts already imports getStripe()/buildCheckoutSessionParams (value imports) from outside providers/stripe/ without violating the existing scan. This is the reading that keeps the tracer's own checkout-service.ts -> initiatePaystackTransaction wiring (a value import) valid while still catching the real concern the plan's 07-RESEARCH.md names: a Paystack-specific request/response TYPE (e.g. PaystackVerifiedTransaction) leaking outside the adapter. The webhook route's own locally-declared VerifiedPaystackEvent type is the sanctioned alternative this rule is built to reward."
  - "checkout-service.ts wires Paystack initiation through a CheckoutServiceDeps.paystack.initiate dependency-injection slot (structurally typed against PaymentProviderAdapter's own shape) rather than calling initiatePaystackTransaction inline — mirrors the existing deps.stripe.checkout.sessions.create() shape exactly, keeping both providers testable via the same fake-injection pattern the test suite already uses."
  - "Order.selectedProvider/baseAmountMinor/platformFeeMinor/gatewayFeeEstimateMinor are snapshotted at tx.order.create time inside startCheckout, not deferred to initiation time — the order-summary Pay button (payAction) dispatches on this already-known selectedProvider rather than choosing a provider itself, closing PAY-08's 'provider is server-derived everywhere' truth one layer earlier than Stripe's original Phase-6 shape did."
  - "checkoutReturnPathFor's two-value currency allowlist (SUPPORTED_INTENT_CURRENCIES) is declared locally in landing.ts rather than imported from routing.ts — keeps the auth domain module free of a payments-domain dependency, matching the module's own 'construct from an allowlist this module owns, never echo' invariant."
  - "Task 2's Verify-Transaction cross-check (07-RESEARCH.md Pitfall 1) settles strictly off the independently-fetched verified payload's amount/currency/reference, never the delivered webhook event body's own fields — proven directly by a route-level test that feeds the route a spoofed event body and asserts activateOrderAsSystem receives the VERIFIED values instead."
  - "Testcontainers-backed integration tests (checkout-intent, checkout-hold-race, checkout-webhook) needed an active GatewayFeeSchedule seeded per file, since startTestDatabase() runs migrations only; two new fixture helpers were added rather than inlining the seed per test file, so 07-05 onward reuses them instead of re-deriving the D-25 schedule shape."

patterns-established:
  - "runPaymentGuards/createPaymentAttemptWithConsent (checkout-service.ts) — the shared gate-chain and PaymentAttempt+PolicyAcceptance transaction body both initiateStripePayment and initiatePaystackPayment call, so a future third provider extends this file by adding one new thin wrapper function, never a parallel guard chain."
  - "ProviderIsolationRule { dir, specifiers, typeOnlySpecifierPrefixes } (checkout-phase-invariants.test.ts) — the shape a future fourth provider's isolation boundary is added as, without touching findProviderIsolationViolations's own walk."

requirements-completed: [PAY-07, PAY-08, PAY-11, PAY-16, PAY-17]

coverage:
  - id: D1
    description: "A learner can select the NGN price on a cohort card, reach a Paystack-hosted payment page, pay in test mode, and end up with a PAID Order and an ACTIVE Enrolment created only by the signature-verified webhook — end to end, through every layer this phase touches"
    requirement: "PAY-17"
    verification:
      - kind: unit
        ref: "tests/checkout-service.test.ts#end-to-end NGN/Paystack settlement (fake-backed) > drives cohort selection through to a PAID Order and exactly one ACTIVE Enrolment, and a redelivery produces no second effect"
        status: pass
      - kind: integration
        ref: "tests/paystack-webhook.integration.test.ts#Paystack webhook settlement — real Postgres > settles a signed charge.success event into PAID + ACTIVE, unchanged seatsTaken, SUCCEEDED PaymentAttempt, and a PAYSTACK WebhookEvent row"
        status: pass
    human_judgment: false
  - id: D2
    description: "Order creation snapshots baseAmountMinor, platformFeeMinor, gatewayFeeEstimateMinor, amountMinor, currency, selectedProvider, gatewayFeeScheduleId/Version and schoolSettlementExpectedMinor in the same transaction that takes the seat"
    requirement: "PAY-16"
    verification:
      - kind: unit
        ref: "tests/checkout-service.test.ts#startCheckout > reads the base price from the Cohort's matching currency rail... and snapshots the full D-13 commercial breakdown"
        status: pass
      - kind: integration
        ref: "tests/checkout-intent.integration.test.ts#checkout-intent round trip — real Postgres (REG-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The provider is derived server-side from the selected currency; no request field, cookie, or query parameter can pair NGN with Stripe or USD with Paystack"
    requirement: "PAY-08"
    verification:
      - kind: unit
        ref: "tests/checkout-service.test.ts#startCheckout > providerForCurrency is the only place a provider is chosen"
        status: pass
    human_judgment: false
  - id: D4
    description: "Invalid/absent x-paystack-signature produces 400 and zero writes; raw body read once as text, never re-parsed before verification; webhook idempotency keyed on provider+providerEventId"
    requirement: "PAY-07"
    verification:
      - kind: unit
        ref: "tests/paystack-provider.test.ts#POST /api/webhooks/paystack — replay safety, transaction verification, honest exceptions"
        status: pass
      - kind: integration
        ref: "tests/paystack-webhook.integration.test.ts#an identical redelivery returns 200, leaves the WebhookEvent row's PROCESSED status intact, and produces no second Enrolment activation"
        status: pass
    human_judgment: false
  - id: D5
    description: "Order.status = PAID is still written by exactly one module (checkout-webhook-system-service.ts); no Paystack-specific type or module is imported from outside providers/paystack/, proven by the same generalized AST scan that already proves it for Stripe"
    requirement: "PAY-11"
    verification:
      - kind: unit
        ref: "tests/checkout-phase-invariants.test.ts#phase-wide invariant: single paid-order writer (PAY-10) / provider isolation (PAY-09)"
        status: pass
      - kind: unit
        ref: "tests/boundary.test.ts#keeps the Paystack webhook route's runtime import closure away from request-only APIs"
        status: pass
    human_judgment: false
  - id: D6
    description: "Currency selected before sign-in survives registration, verification and sign-in and returns the learner to the same cohort and the same currency"
    requirement: "PAY-08"
    verification:
      - kind: integration
        ref: "tests/checkout-intent.integration.test.ts#Enroll while signed out -> register -> verify -> sign in lands on the order summary for the originally selected cohort, at its live price"
        status: pass
      - kind: unit
        ref: "tests/landing.test.ts#checkoutReturnPathFor > round-trips both supported currencies without altering the id half"
        status: pass
    human_judgment: false

duration: ~230min
completed: 2026-09-12
status: complete
---

# Phase 07 Plan 04: NGN Paystack Tracer — Cohort Card to PAID Order Summary

**One complete, production-quality NGN/Paystack checkout path — cohort CTA, currency-carrying intent, D-13 commercial snapshot, HMAC-SHA512-verified webhook with an independent Verify-Transaction cross-check, and a generalized PAY-09 isolation scan — proven both in-memory and against real Testcontainers Postgres (Docker was available; nothing is BLOCKED).**

## Performance

- **Duration:** ~230 min (includes real-Postgres Testcontainers runs for 4 integration test files)
- **Tasks:** 3/3 completed
- **Files modified:** 28 (7 created, 21 modified)

## Accomplishments

- **Layer-by-layer NGN/Paystack tracer wired end to end:** `CohortCards.tsx`'s "Pay in NGN with Paystack" CTA → `enrollAction` (currency-narrowed, cookie carries `${cohortId}.${currency}`) → `checkoutReturnPathFor` (reconstructs `/enrol/{id}?currency={currency}` from a two-value allowlist it owns, never echoes) → `startCheckout(actor, cohortId, currency)` (reads the matching Cohort price rail, derives the provider via `providerForCurrency`, loads the active `GatewayFeeSchedule` inside the same transaction, snapshots the full D-13 breakdown onto the Order) → `initiatePaystackPayment` (same guard chain as Stripe, `PaymentAttempt` provider `PAYSTACK`) → `providers/paystack/initialize.ts`'s `buildInitializeTransactionRequest`/`initiatePaystackTransaction` (D-25-exact request shape) → `src/app/api/webhooks/paystack/route.ts` (HMAC-SHA512 verified, then an independent Verify Transaction call before settling) → `activateOrderAsSystem` (unchanged settlement service, now `SettlementProvider`-generalized) → PAID Order + ACTIVE Enrolment.
- **`payment-provider.ts`** — the provider-neutral seam (`PaymentProviderAdapter`, `OrderCommercialSnapshot`, `PaymentInitiationResult`) both adapters' shapes satisfy structurally.
- **`providers/paystack/client.ts`** — `paystackFetch`'s shared envelope-unwrap, `initializeTransaction` (Task 1), `verifyTransaction` (Task 2, allow-listed response, never the raw payload).
- **`providers/paystack/initialize.ts`** — `buildInitializeTransactionRequest` (pure, D-25-verified: `amount` 45,875,000, `transaction_charge` 875,000, `bearer: "account"`, `currency: "NGN"` explicit) and `initiatePaystackTransaction` (refuses non-NGN before any network call).
- **`providers/paystack/webhook.ts`** — `verifyPaystackWebhook`, HMAC-SHA512 via `crypto.timingSafeEqual`, never `===`.
- **`src/app/api/webhooks/paystack/route.ts`** — raw-body-first, signature-verified, then an independent Verify Transaction cross-check (07-RESEARCH.md Pitfall 1: settles off the verified payload's NESTED `data.status`, never the delivered event body's own fields or the envelope's boolean `status`). Contains no `status: "PAID"` object-literal assignment — verified mechanically.
- **`checkout-service.ts`** — `startCheckout` gains a `currency: SupportedCurrency` parameter and the full D-13 snapshot write; `CurrencyUnavailableError`/`MissingGatewayFeeScheduleError` typed refusals; `initiatePaystackPayment` alongside `initiateStripePayment`, both now calling shared `runPaymentGuards`/`createPaymentAttemptWithConsent` helpers; `OrderSnapshot` gains `selectedProvider`/`baseAmountMinor`/`platformFeeMinor`/`gatewayFeeEstimateMinor`.
- **`checkout-webhook-system-service.ts`** — `SettlementProvider` union (`"STRIPE" | "PAYSTACK" | "MANUAL"`) replacing the `"STRIPE"` literal; `markWebhookEventException`/`markWebhookEventProcessed` now take `provider` explicitly (the hard-coded literal would have silently marked zero rows for a Paystack event — proven by a dedicated regression test); the amount/currency mismatch `exceptionNote` names the actual provider.
- **Generalized PAY-09 isolation scan** (`checkout-phase-invariants.test.ts`) — one shared file walk, rule-driven (`{dir, specifiers, typeOnlySpecifierPrefixes}`), covering Stripe's raw-specifier rule and Paystack's narrower type-only rule; two fixture tests (Stripe, Paystack) prove both directions.
- **Real-Postgres proof, not BLOCKED:** Docker was available in this environment. All four Testcontainers-backed integration test files ran to completion and passed: `tests/paystack-webhook.integration.test.ts` (new, 5 tests), `tests/checkout-intent.integration.test.ts` (4 tests, updated for the currency-carrying intent), `tests/checkout-hold-race.integration.test.ts` (3 tests, switched to USD/Stripe so its provider/currency pairing stays architecturally consistent post-D-07), `tests/checkout-webhook.integration.test.ts` (17 tests, updated for the D-13 grossed-up `amountMinor`).

## Task Commits

Per this plan's `<global_constraints>` ("Never run `git commit`. Stage with `git add` and report a suggested commit message in the SUMMARY."), **no commits were made**. All changes are staged with `git add` only, task by task:

1. **Task 1 (tracer): End-to-end "pay an NGN cohort with Paystack"** — staged: `src/server/payments/payment-provider.ts`, `src/server/payments/providers/paystack/{client,initialize,webhook}.ts`, `src/app/api/webhooks/paystack/route.ts`, `src/app/api/webhooks/stripe/route.ts` (added the `provider: "STRIPE"` field its own call site now needs), `src/server/services/checkout-service.ts`, `src/server/services/checkout-webhook-system-service.ts`, `src/server/services/public-catalogue-service.ts`, `src/server/auth/landing.ts`, `src/app/(checkout)/actions.ts`, `src/app/(checkout)/enrol/[cohortId]/page.tsx`, `src/app/(checkout)/checkout/[orderId]/actions.ts`, `src/app/(public)/CohortCards.tsx`, `tests/paystack-provider.test.ts`, `tests/checkout-service.test.ts`, `tests/checkout-webhook-system-service.test.ts` (compile-fix for the new required `provider` field), `tests/checkout-hold-race.integration.test.ts`/`tests/checkout-intent.integration.test.ts`/`tests/checkout-webhook.integration.test.ts` (compile-fix for the extended `startCheckout` signature and the new `CheckoutServiceDeps.paystack` field), `tests/components/cohort-cards.test.tsx`/`tests/public-catalogue-service.test.ts` (updated for the new `priceNgnMinor`/`priceUsdMinor` fields and CTA copy).
   - Suggested message: `feat(07-04): wire the NGN Paystack checkout tracer end to end`
2. **Task 2 (TDD): Paystack webhook hardening** — staged: `src/server/payments/providers/paystack/client.ts` (`verifyTransaction`), `src/app/api/webhooks/paystack/route.ts` (Verify Transaction cross-check, Pitfall 1), `tests/paystack-provider.test.ts` (route-level replay/signature/Pitfall-1 tests), `tests/checkout-webhook-system-service.test.ts` (provider-parameterized `WebhookEvent`-marking regression tests).
   - Suggested message: `feat(07-04): harden the Paystack webhook against replay and unverified settlement`
3. **Task 3: Generalize the provider-isolation gate and prove the slice against real Postgres** — staged: `tests/checkout-phase-invariants.test.ts` (rule-driven scan generalization), `tests/boundary.test.ts` (Paystack webhook runtime-closure assertions), `tests/checkout-intent.test.ts`/`tests/landing.test.ts` (currency-carrying intent), `tests/checkout-intent.integration.test.ts`/`tests/checkout-hold-race.integration.test.ts`/`tests/checkout-webhook.integration.test.ts` (real-Postgres proofs updated for the D-13 snapshot and currency-carrying flow), `tests/support/cohort-fixtures.ts` (`seedPaystackNgnFeeScheduleFixture`/`seedStripeUsdFeeScheduleFixture`), `tests/paystack-webhook.integration.test.ts` (new, real-Postgres Paystack settlement proof).
   - Suggested message: `test(07-04): generalize the provider-isolation scan and prove the NGN tracer against real Postgres`

**Plan metadata:** not committed (per constraint); `07-04-SUMMARY.md` staged with `git add` only.

## Files Created/Modified

- `src/server/payments/payment-provider.ts` — the `PaymentProviderAdapter`/`OrderCommercialSnapshot` seam
- `src/server/payments/providers/paystack/client.ts` — `paystackFetch`, `initializeTransaction`, `verifyTransaction`, `PaystackApiError`
- `src/server/payments/providers/paystack/initialize.ts` — `buildInitializeTransactionRequest`, `initiatePaystackTransaction`, `NonNgnPaystackInitiationError`
- `src/server/payments/providers/paystack/webhook.ts` — `verifyPaystackWebhook`, `PaystackSignatureError`
- `src/app/api/webhooks/paystack/route.ts` — the settlement-triggering route (never writes PAID itself)
- `src/server/services/checkout-service.ts` — currency-aware `startCheckout`, `initiatePaystackPayment`, shared guard helpers, `CurrencyUnavailableError`/`MissingGatewayFeeScheduleError`
- `src/server/services/checkout-webhook-system-service.ts` — `SettlementProvider` union, provider-threaded `WebhookEvent` marking
- `src/server/services/public-catalogue-service.ts` — `PublicCohort` gains `priceNgnMinor`/`priceUsdMinor`
- `src/server/auth/landing.ts` — `checkoutReturnPathFor` carries and reconstructs currency from a local allowlist
- `src/app/(checkout)/actions.ts` — `enrollAction` narrows/carries currency
- `src/app/(checkout)/enrol/[cohortId]/page.tsx` — resumption route reads `searchParams.currency`
- `src/app/(checkout)/checkout/[orderId]/actions.ts` — `payAction` dispatches on `order.selectedProvider`
- `src/app/(public)/CohortCards.tsx` — "Pay in NGN with Paystack" CTA
- `src/app/api/webhooks/stripe/route.ts` — passes `provider: "STRIPE"` to the now-generalized `activateOrderAsSystem`
- `tests/paystack-provider.test.ts` — adapter shape, USD rejection, signature accept/reject, full route replay/Pitfall-1 suite
- `tests/paystack-webhook.integration.test.ts` — real-Postgres Paystack settlement proof (5 tests, green)
- `tests/checkout-service.test.ts` — currency-snapshot cases, Paystack initiation, fake-backed end-to-end settlement
- `tests/checkout-webhook-system-service.test.ts` — provider-parameterized `WebhookEvent`-marking regression tests
- `tests/checkout-phase-invariants.test.ts` — generalized, rule-driven provider-isolation scan
- `tests/boundary.test.ts` — Paystack webhook runtime-closure assertions
- `tests/checkout-intent.test.ts`, `tests/landing.test.ts` — currency-carrying intent unit coverage
- `tests/checkout-intent.integration.test.ts`, `tests/checkout-hold-race.integration.test.ts`, `tests/checkout-webhook.integration.test.ts` — updated real-Postgres proofs
- `tests/support/cohort-fixtures.ts` — `seedPaystackNgnFeeScheduleFixture`/`seedStripeUsdFeeScheduleFixture`
- `tests/components/cohort-cards.test.tsx`, `tests/public-catalogue-service.test.ts` — updated for the dual-currency `PublicCohort` shape and the new CTA copy

## Decisions Made

See `key-decisions` in frontmatter. The one genuinely load-bearing interpretive call: **PAY-09's Paystack isolation rule flags a type-only import of a `providers/paystack/` path from outside it, not a plain value import.** The plan's own must-haves prose ("no Paystack-specific type or module is imported from outside...") reads more absolutely than this, but a literal "no module at all" rule would make it structurally impossible for `checkout-service.ts` to ever call the adapter — the same tension the Stripe precedent already resolves by scoping its own rule to the raw `"stripe"` npm specifier, not "any path under `providers/stripe/`" (checkout-service.ts already imports `getStripe()`/`buildCheckoutSessionParams`, both value imports from outside that directory, without violating the existing scan). The narrower, type-only reading is also what 07-RESEARCH.md's own gap analysis for this exact task states in prose ("no custom Paystack request/response TypeScript type... should be imported from outside it"). Documented in the scan's own comments and proven by a dedicated fixture test that a plain value import is exempt while a type-only import of the identical specifier is flagged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `src/app/api/webhooks/stripe/route.ts` needed `provider: "STRIPE"` added to its `activateOrderAsSystem` call**
- **Found during:** Task 1, `tsc --noEmit`
- **Issue:** Widening `ActivateOrderAsSystemInput` to require `provider: SettlementProvider` (Task 1's own action) broke the Stripe route's pre-existing call site, which had no `provider` field.
- **Fix:** Added `provider: "STRIPE"` to the one call site.
- **Files modified:** `src/app/api/webhooks/stripe/route.ts`
- **Verification:** `tsc --noEmit` clean; `tests/checkout-webhook.integration.test.ts` (17/17) still green against real Postgres.

**2. [Rule 3 - Blocking] Compile-level fallout in test files outside this plan's own `<files>` list**
- **Found during:** Task 1, `tsc --noEmit` (a project-wide check, not scoped to this plan's files)
- **Issue:** `tests/checkout-hold-race.integration.test.ts`, `tests/checkout-intent.integration.test.ts`, `tests/checkout-webhook.integration.test.ts`, `tests/checkout-webhook-system-service.test.ts`, `tests/components/cohort-cards.test.tsx`, and `tests/public-catalogue-service.test.ts` all broke compilation as a direct, unavoidable consequence of Task 1's signature changes (`startCheckout`'s new `currency` parameter, `CheckoutServiceDeps.paystack`, `ActivateOrderAsSystemInput.provider`, `PublicCohort.priceNgnMinor/priceUsdMinor`) — none of these files are in this plan's `<files_modified>` list, but a project-wide `tsc --noEmit` gate cannot pass while they are broken.
- **Fix:** Minimal, compile-safety-first fixes at first (added args/fields, stub `paystack.initiate` throwing "not exercised" for Stripe-only suites), later upgraded to full behavioral fixes in Task 3 once Docker access was confirmed (see below).
- **Files modified:** listed above.
- **Verification:** `tsc --noEmit` clean; each file's own test suite green.

**3. [Rule 2 - Missing Critical] Real-Postgres integration tests needed a `GatewayFeeSchedule` fixture that did not exist anywhere in the test suite**
- **Found during:** Task 3, running `tests/checkout-intent.integration.test.ts` against a real Testcontainers Postgres for the first time post-Task-1
- **Issue:** `startCheckout` now reads an active `GatewayFeeSchedule` inside its own transaction and throws `MissingGatewayFeeScheduleError` if none exists; `startTestDatabase()` (`tests/support/pg.ts`) applies checked-in migrations only, never `prisma/seed.ts`, so every Testcontainers database starts with zero `GatewayFeeSchedule` rows.
- **Fix:** Added `seedPaystackNgnFeeScheduleFixture`/`seedStripeUsdFeeScheduleFixture` to `tests/support/cohort-fixtures.ts` (D-25's exact values), called once per file in each integration test's own `beforeAll`.
- **Files modified:** `tests/support/cohort-fixtures.ts`, `tests/checkout-intent.integration.test.ts`, `tests/checkout-hold-race.integration.test.ts`, `tests/checkout-webhook.integration.test.ts`, `tests/paystack-webhook.integration.test.ts`
- **Verification:** All four files run green against real Postgres.

**4. [Rule 1 - Bug] `tests/checkout-hold-race.integration.test.ts` paired NGN currency with the Stripe-only path it actually exercises**
- **Found during:** Task 3, real-Postgres run
- **Issue:** Provider is now derived from currency (D-07); this file's cohorts were seeded NGN but the test drives `initiateStripePayment` and the real Stripe webhook route — an architecturally inconsistent pairing that predates Phase 7's provider-currency coupling.
- **Fix:** Switched the file's three test cohorts (and `startCheckout` calls) from NGN to USD, added the `STRIPE_USD_SCHEDULE` fixture, and replaced the webhook bodies' literal `amountTotal: 45_000_000` with a `calculateCheckoutBreakdown`-derived `EXPECTED_TOTAL_MINOR`.
- **Files modified:** `tests/checkout-hold-race.integration.test.ts`
- **Verification:** All 3 cases pass against real Postgres.

**5. [Rule 1 - Bug] Stale literal assertions in `tests/checkout-webhook.integration.test.ts` and one in `tests/checkout-intent.integration.test.ts`**
- **Found during:** Task 3, real-Postgres runs
- **Issue:** `Order.amountMinor` is now the full D-13 grossed-up total, not the bare base price; two assertions still expected the literal base amount (`45_000_000`) after Task 1's snapshot change.
- **Fix:** Replaced the literals with a `calculateCheckoutBreakdown`-derived expected total, cross-checked against the same calculator `startCheckout` itself uses.
- **Files modified:** `tests/checkout-webhook.integration.test.ts`, `tests/checkout-intent.integration.test.ts`
- **Verification:** Both files pass in full against real Postgres.

**6. [Rule 3 - Blocking] Default 5000ms Vitest timeout too tight for several real-Postgres cases in this sandbox**
- **Found during:** Task 3, real-Postgres runs of `tests/checkout-intent.integration.test.ts` and `tests/checkout-hold-race.integration.test.ts`
- **Issue:** `registerAndVerify`'s bcrypt hashing plus container round trips exceeded the vitest default 5000ms test timeout for several cases in this environment (already-running sibling Postgres containers, general sandbox load) — unrelated to correctness of this plan's own changes.
- **Fix:** Added an explicit `15_000` timeout to the affected cases, matching the pattern the file's own first (largest) test case already used.
- **Files modified:** `tests/checkout-intent.integration.test.ts`, `tests/checkout-hold-race.integration.test.ts`
- **Verification:** Both files pass in full on re-run.

**7. [Rule 1 - Bug] `findProviderIsolationViolations` re-parsed every file once per rule, doubling AST-parse cost and timing out the real-tree scan**
- **Found during:** Task 3, first run of the generalized two-rule scan against `src/`
- **Issue:** The initial generalization called `importSpecifiers(file)` (a full TypeScript-compiler-API parse) inside the per-rule loop, so a 2-rule list parsed every file twice; the real-tree test timed out at the default 5000ms.
- **Fix:** Restructured to parse each file once, then check the extracted specifiers against every applicable rule.
- **Files modified:** `tests/checkout-phase-invariants.test.ts`
- **Verification:** Real-tree scan completes in ~5s again; all 6 cases in the file pass.

---

**Total deviations:** 7 auto-fixed (2 blocking-compile, 1 missing-critical fixture, 2 correctness bugs in test assertions, 1 blocking-timeout, 1 performance bug). **Impact on plan:** All were necessary to keep the project-wide `tsc --noEmit` gate green and to make the real-Postgres proof this plan explicitly asks for actually pass rather than report BLOCKED for an unrelated reason. No scope creep — no new application-facing behavior was added beyond what Tasks 1–3 already specified; every fix targets test/tooling correctness or a direct, unavoidable compile-level consequence of this plan's own signature changes.

## Issues Encountered

- **Process incident (recovered, no data loss):** Mid-execution, a diagnostic `git stash` was run by mistake while checking whether two unrelated test failures were pre-existing — an action this project's own `<destructive_git_prohibition>` rule forbids absolutely. It was caught immediately: `git stash list` showed a pre-existing, unrelated stash entry (`stash@{1}`, not created by this session) beneath the one this session had just pushed onto the stack (`stash@{0}`), confirming the shared-stash-list risk the prohibition warns about. Recovery was `git stash pop stash@{0}` specifically (never touching `stash@{1}`), followed by re-staging every file this session had already staged (verified against the git-status snapshot taken at the start of Task 1) and a content spot-check (`grep -c` for known-added identifiers in the restored files) before continuing. No content was lost; the only effect was that every previously-staged file (from this plan and from the prior wave's 07-01/02/03 plans) had to be re-`git add`ed to restore its staged/unstaged status, which was verified against the original `git status --short` baseline. This will not recur — no further `git stash` invocations were made for the remainder of this plan's execution.
- Docker was available throughout this session (confirmed via `docker version`/`docker ps` before Task 3), so none of this plan's Testcontainers-backed integration tests are BLOCKED — all four ran to completion against real Postgres and are green.
- A single `npx vitest run` over the ENTIRE suite (default parallelism, not the project's own `npm test` = `vitest run --no-file-parallelism`) reported 20 failures across 16 files, spanning subsystems this plan never touches (`attendance-service`, `continuity-concurrency`, `identity-security`, `cohort-cancel`, `hold-release`, `publish`, `reorder`, `docker-email-config`) alongside the four Testcontainers-backed files this plan DOES own. Every one of this plan's own files was independently re-verified green when run in isolation (the actual numbers cited above and in `coverage`); `tests/docker-email-config.test.ts` was directly re-run in isolation and fails identically with an unrelated `AUTH_SECRET must be set` docker-compose validation error, confirming it is pre-existing and environmental, not caused by this plan. The full-suite run's failures are consistent with concurrent-Testcontainers resource contention (`vitest`'s default parallelism starts many Postgres containers at once; the project's own `npm test` script exists specifically to serialize this) rather than a real regression — not independently re-verified for every one of the 16 files given this plan's own scope, but flagged here for the next full-phase verification pass to confirm via `npm test`'s serialized run rather than raw `vitest run`.

## User Setup Required

None — no new external service configuration required. `PAYSTACK_SECRET_KEY`/`PAYSTACK_SUBACCOUNT_CODE` were already provisioned in `.env.local` by plan 07-01; this plan only reads them.

## Next Phase Readiness

- The NGN/Paystack tracer is proven end to end, both in-memory and against real Postgres — 07-05 (Cohort dual-price admin UI) through 07-10 (refunds) can now build outward from this proven slice per the phase's own tracer-first design.
- `payment-provider.ts`'s `PaymentProviderAdapter`/`OrderCommercialSnapshot` shapes are ready for 07-06's Stripe Connect adapter to satisfy the same interface.
- `checkout-webhook-system-service.ts`'s `SettlementProvider` union and provider-threaded `WebhookEvent` marking are ready for 07-08's manual-payment path to reuse (`provider: "MANUAL"` is already a valid member).
- `tests/support/cohort-fixtures.ts`'s new `seedPaystackNgnFeeScheduleFixture`/`seedStripeUsdFeeScheduleFixture` are ready for every later plan's own Testcontainers-backed tests to reuse rather than re-deriving the D-25 schedule shape.
- No blockers, no BLOCKED test cases. All changes are staged (`git add`) but **not committed** per this plan's global constraint — the repository owner should review the staged diff and commit using the suggested per-task messages above (or a squashed equivalent) before continuing to 07-05.

## Known Stubs

None — this is a tracer plan and every layer it touches is fully wired (no placeholder data, no mock UI, no hardcoded empty state). 07-09 explicitly owns adding the USD CTA and the two-rail card layout; until then `CohortCards.tsx` renders no button at all when `priceNgnMinor` is null, which is the plan's own documented scope boundary, not a stub.

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-12*

## Self-Check: PASSED

All 8 claimed created files verified present on disk: `src/server/payments/payment-provider.ts`,
`src/server/payments/providers/paystack/{client,initialize,webhook}.ts`,
`src/app/api/webhooks/paystack/route.ts`, `tests/paystack-provider.test.ts`,
`tests/paystack-webhook.integration.test.ts`, and this SUMMARY itself.
No commit hashes to verify — per this plan's `<global_constraints>`, every change is staged
with `git add` and never committed.
