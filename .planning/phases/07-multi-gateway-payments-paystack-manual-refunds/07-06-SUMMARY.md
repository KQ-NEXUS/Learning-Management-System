---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 06
subsystem: payments
tags: [stripe, stripe-connect, destination-charge, checkout-session, webhook, settlement-config]

requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-01)
    provides: "settlement-config.ts (stripeConnectedAccountId, MissingSettlementAccountError), locked Decision C (on_behalf_of not required, same-country USA/USA pairing)"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-04)
    provides: "startCheckout's currency parameter and D-13 commercial snapshot (baseAmountMinor/amountMinor), the generalized provider-isolation scan, initiatePaystackPayment as the sibling pattern"
provides:
  - "USD Stripe Checkout Sessions are Connect DESTINATION CHARGES — buildCheckoutSessionParams gains schoolSettlementMinor/connectedAccountId, payment_intent_data.transfer_data splits the school's immutable base price to the connected account while the platform account bears Stripe's actual fee (D-04, PAY-17)"
  - "ProviderCurrencyMismatchError — initiateStripePayment refuses non-USD Orders, initiatePaystackPayment refuses non-NGN Orders, both before any provider call and before the PaymentAttempt transaction (D-07)"
  - "initiateStripePayment fails closed with MissingSettlementAccountError when STRIPE_CONNECTED_ACCOUNT_ID is absent (D-05)"
  - "Stripe webhook settlement evidence carries paymentIntentId/chargeId/transferId/transferDestination correlation identifiers for 07-07's reconciliation sweep, without ever writing the four actual-settlement columns at webhook time (D-14, D-21)"
affects: [07-07, 07-08]

actuals:
  tokens: 18000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "ActivateOrderAsSystemInput gained an optional settlementEvidence field, spread into the existing narrowed evidence object — additive and backward-compatible for the Paystack call site, which passes nothing and gets the same evidence shape as before"
    - "buildStripeSettlementEvidence (route.ts) reads transferDestination from settlement-config.ts directly rather than from the event payload — the destination is deployment config, not something to trust from a webhook body, and it also survives a delivery whose payment_intent field isn't expanded"

key-files:
  created: []
  modified:
    - src/server/payments/providers/stripe/checkout-session.ts
    - src/server/services/checkout-service.ts
    - src/server/services/checkout-webhook-system-service.ts
    - src/app/api/webhooks/stripe/route.ts
    - tests/checkout-service.test.ts
    - tests/checkout-webhook.integration.test.ts
    - tests/checkout-hold-race.integration.test.ts

key-decisions:
  - "on_behalf_of is never set (07-01 Decision C, read as a resolved fact) — the checkout-session.ts header and a pure-builder test both pin this as an explicit absence, not an implicit omission."
  - "chargeId/transferId in Stripe settlement evidence are read from an OPTIONAL expanded payment_intent.latest_charge shape on the checkout.session.completed event (a Stripe webhook-endpoint expansion setting, external to this codebase) and are null, never fabricated, when the delivered event isn't expanded — 07-07's reconciliation sweep still has paymentIntentId to look up the rest directly from Stripe's API if a deployment hasn't configured that expansion."
  - "transferDestination in evidence is sourced from settlement-config.ts's stripeConnectedAccountId(), never from the event payload — every Session this deployment creates carries the same configured destination, so this only records what the deployment was configured to expect, mirroring how checkout-session.ts sources the same value at creation time."

patterns-established:
  - "The crossed-rail refusal (ProviderCurrencyMismatchError) lives in checkout-service.ts as a mirror-image pair — initiateStripePayment checks currency !== 'USD', initiatePaystackPayment checks currency !== 'NGN' — both after runPaymentGuards and before createPaymentAttemptWithConsent, so neither leaves an orphan PaymentAttempt row."

requirements-completed: [PAY-08, PAY-17]

coverage:
  - id: D1
    description: "A USD Checkout Session is a Stripe Connect destination charge: unit_amount is the learner's full total, payment_intent_data.transfer_data.amount is the school's immutable base price, transfer_data.destination is sourced only from settlement-config.ts, and on_behalf_of is absent per 07-01's locked Decision C"
    requirement: "PAY-17"
    verification:
      - kind: unit
        ref: "tests/checkout-service.test.ts#buildCheckoutSessionParams > 07-06: carries a Stripe Connect destination-charge transfer whose amount and destination are distinct from, and never derived from, the line-item total"
        status: pass
      - kind: unit
        ref: "tests/checkout-service.test.ts#initiateStripePayment > 07-06: sends transfer_data.amount as the Order's base price and transfer_data.destination as the configured connected account"
        status: pass
      - kind: integration
        ref: "tests/checkout-webhook.integration.test.ts#Stripe webhook settlement — real Postgres > 07-06: a USD destination charge's snapshotted base price and learner total are two distinct values that both survive settlement unchanged"
        status: pass
    human_judgment: false
  - id: D2
    description: "The two payment rails never cross: initiateStripePayment refuses an NGN Order and initiatePaystackPayment refuses a USD Order, both before any provider call and before the PaymentAttempt transaction; initiateStripePayment fails closed with MissingSettlementAccountError when STRIPE_CONNECTED_ACCOUNT_ID is absent"
    requirement: "PAY-08"
    verification:
      - kind: unit
        ref: "tests/checkout-service.test.ts#initiateStripePayment > 07-06: refuses with ProviderCurrencyMismatchError and records no Stripe call when the Order's currency is NGN"
        status: pass
      - kind: unit
        ref: "tests/checkout-service.test.ts#initiateStripePayment > 07-06: raises MissingSettlementAccountError and records no Stripe call or PaymentAttempt when STRIPE_CONNECTED_ACCOUNT_ID is unset"
        status: pass
      - kind: unit
        ref: "tests/checkout-service.test.ts#initiatePaystackPayment > 07-06: refuses with ProviderCurrencyMismatchError and records no Paystack call when the Order's currency is USD"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every Phase 6 Stripe checkout behaviour (idempotency request option, client_reference_id correlation, mirrored payment_intent metadata, declined=1 cancel marker, single-writer settlement, webhook 200/400/500 discrimination) is preserved unchanged"
    requirement: "PAY-17"
    verification:
      - kind: unit
        ref: "tests/checkout-service.test.ts (48 tests, full file)"
        status: pass
      - kind: integration
        ref: "tests/checkout-webhook.integration.test.ts (20 tests, real Postgres)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Stripe settlement evidence carries paymentIntentId/chargeId/transferId/transferDestination for 07-07's reconciliation sweep, with no secret-bearing key, and the four actual-settlement PaymentAttempt columns stay NULL at webhook time"
    requirement: "PAY-17"
    verification:
      - kind: integration
        ref: "tests/checkout-webhook.integration.test.ts#Stripe webhook settlement — real Postgres > 07-06: stores Stripe settlement correlation evidence ... and leaves all four actual-settlement columns NULL"
        status: pass
      - kind: integration
        ref: "tests/checkout-webhook.integration.test.ts#Stripe webhook settlement — real Postgres > 07-06: an unexpanded payment_intent ... still records the PaymentIntent id and destination, with charge/transfer left null rather than fabricated"
        status: pass
    human_judgment: false

duration: ~110min
completed: 2026-09-12
status: complete
---

# Phase 07 Plan 06: Stripe Connect Destination Charge (USD) Summary

**USD Checkout Sessions are now Stripe Connect destination charges — `transfer_data` splits the school's immutable base price to the connected account while KQ NEXUS bears Stripe's actual fee, both payment rails are hard-refused against the wrong currency, and Stripe settlement evidence carries correlation identifiers for the future reconciliation sweep without ever writing an "actual" value at webhook time.**

## Performance

- **Duration:** ~110 min
- **Tasks:** 3/3 completed
- **Files modified:** 7 (0 created, 7 modified)

## Accomplishments

- **`buildCheckoutSessionParams`** (`checkout-session.ts`) extended additively with `schoolSettlementMinor`/`connectedAccountId`, adding `payment_intent_data.transfer_data: { destination, amount }` inside the existing `payment_intent_data` object. `line_items[0].price_data.unit_amount` (learner total) and `transfer_data.amount` (school's base price) are asserted as two distinct literal values in a dedicated pure-builder test, so a regression that accidentally passes the learner total as the transfer cannot pass by coincidence. `on_behalf_of` is deliberately never set, per 07-01's locked Decision C (KQ NEXUS's platform account and this deployment's connected account are both US-registered) — the header comment records the two country values the decision was made from.
- **`initiateStripePayment`** (`checkout-service.ts`) now refuses any Order whose `currency` is not `USD` with a typed `ProviderCurrencyMismatchError`, resolves the connected account through `settlement-config.ts`'s `stripeConnectedAccountId()` (failing closed with `MissingSettlementAccountError` when absent, D-05), and reads `schoolSettlementMinor` from the Order's own `baseAmountMinor` snapshot — never recomputed from the Cohort. Both new checks run after the existing guard chain and before the `PaymentAttempt` transaction, so a crossed rail or missing account leaves no orphan attempt row.
- **`initiatePaystackPayment`** gained the mirror-image refusal: any Order whose currency is not `NGN` is refused before any Paystack call.
- **Stripe webhook evidence** (`src/app/api/webhooks/stripe/route.ts`): a new `buildStripeSettlementEvidence` helper narrows whatever `session.payment_intent` carries (a bare id string by default, or an expanded object when a deployment's webhook endpoint is configured to expand `payment_intent`/`payment_intent.latest_charge`) into `paymentIntentId`/`chargeId`/`transferId`, plus `transferDestination` read directly from `settlement-config.ts` (never the event payload — every Session this deployment creates carries the same configured destination). Fields the event doesn't carry are `null`, never fabricated. `ActivateOrderAsSystemInput` gained an optional `settlementEvidence` field (an additive, backward-compatible extension to `checkout-webhook-system-service.ts` — necessary to thread the route's evidence into the existing narrowed evidence object; see Deviations), spread into the evidence object already built there. The four `PaymentAttempt` "actual settlement" columns are never written at webhook time (D-14) — proven directly by an integration test asserting all four read back `NULL` immediately after settlement.
- **Real-Postgres proof, not BLOCKED:** Docker was available. `tests/checkout-webhook.integration.test.ts` (now 20 tests, up from 17) passed in full, including three new 07-06 cases: the destination-charge round trip (base and total both survive settlement unchanged), the evidence-with-expansion case, and the evidence-without-expansion case (chargeId/transferId null, not fabricated).

## Task Commits

Per this plan's `<global_constraints>` ("Never run `git commit`."), **no commits were made**. All changes are staged with `git add` only:

1. **Task 1 (TDD RED): failing Connect destination-charge and crossed-rail refusal tests** — staged as part of the combined `tests/checkout-service.test.ts` / `tests/checkout-webhook.integration.test.ts` changes below (this plan implemented Tasks 1 and 2 together rather than as two separate commits, since the failing tests and the implementation were verified together before staging — see Deviations).
   - Suggested message: `test(07-06): add failing Stripe Connect destination-charge and crossed-rail tests`
2. **Task 2: destination-transfer parameters and fail-closed connected-account resolution** — staged: `src/server/payments/providers/stripe/checkout-session.ts`, `src/server/services/checkout-service.ts`, `tests/checkout-service.test.ts`, `tests/checkout-hold-race.integration.test.ts` (compile/runtime-fix for the new currency guard — see Deviations).
   - Suggested message: `feat(07-06): make USD Stripe checkout a Connect destination charge with hard currency-rail refusal`
3. **Task 3: capture destination-charge settlement evidence for reconciliation** — staged: `src/app/api/webhooks/stripe/route.ts`, `src/server/services/checkout-webhook-system-service.ts` (necessary deviation — see below), `tests/checkout-webhook.integration.test.ts`.
   - Suggested message: `feat(07-06): record Stripe settlement correlation evidence without writing actual-settlement columns`

**Plan metadata:** not committed (per constraint); `07-06-SUMMARY.md` staged with `git add` only.

## Files Created/Modified

- `src/server/payments/providers/stripe/checkout-session.ts` — `buildCheckoutSessionParams` gains `schoolSettlementMinor`/`connectedAccountId`, adds `payment_intent_data.transfer_data`; header extended with the destination-charge/on_behalf_of rationale
- `src/server/services/checkout-service.ts` — `ProviderCurrencyMismatchError`; `initiateStripePayment` refuses non-USD and resolves the connected account; `initiatePaystackPayment` refuses non-NGN
- `src/server/services/checkout-webhook-system-service.ts` — `ActivateOrderAsSystemInput.settlementEvidence` (optional, additive), merged into the existing narrowed evidence object
- `src/app/api/webhooks/stripe/route.ts` — `buildStripeSettlementEvidence`, threading `settlementEvidence` into the `activateOrderAsSystem` call for `checkout.session.completed`
- `tests/checkout-service.test.ts` — destination-charge pure-builder test, crossed-rail refusal tests (both directions), `MissingSettlementAccountError` test, a USD/Stripe end-to-end settlement test, and the six pre-existing NGN-cohort Stripe-completion tests switched to USD cohorts (D-07 fallout — see Deviations)
- `tests/checkout-webhook.integration.test.ts` — switched from NGN/`PAYSTACK_NGN_SCHEDULE` to USD/`STRIPE_USD_SCHEDULE` fixtures throughout (17 pre-existing cases, D-07 fallout), added `STRIPE_CONNECTED_ACCOUNT_ID` to `beforeAll`, extended `buildCheckoutCompletedEventBody` with an optional `paymentIntent` shape, and added three new 07-06 cases (destination-charge round trip, evidence-with-expansion, evidence-without-expansion)
- `tests/checkout-hold-race.integration.test.ts` — added `STRIPE_CONNECTED_ACCOUNT_ID` to `beforeAll` (D-05 fallout — this file was already USD/Stripe from 07-04's own fix, so no currency changes were needed here)

## Decisions Made

See `key-decisions` in frontmatter. The two genuinely interpretive calls, both made necessary by real Stripe API shape constraints rather than plan ambiguity:

1. **chargeId/transferId are read from an optional expanded `payment_intent.latest_charge` shape, not fetched via a live Stripe API retrieve call.** By default, `checkout.session.completed`'s session object carries `payment_intent` as a bare id string; the charge id and transfer id are only present if a deployment has configured its Stripe webhook endpoint to expand `payment_intent`/`payment_intent.latest_charge` (a dashboard/API setting external to this codebase). Adding a live retrieve call inside the webhook route would introduce a real network dependency to a security-critical, currently-dependency-free handler, and would require mocking Stripe's API in the real-Postgres integration suite (which today only stubs `checkout.sessions.create`, never Stripe's read APIs). The chosen design reads whatever the delivered event already carries, defaulting absent fields to `null` — honest per D-14's "never conflate" discipline — while `paymentIntentId` (always available without expansion) is enough for 07-07's reconciliation sweep to retrieve the rest directly from Stripe's API if a deployment hasn't configured that expansion.
2. **`transferDestination` in evidence is sourced from `settlement-config.ts`, never the event payload.** Every USD Session this deployment creates carries the exact same configured connected-account id — there is no per-Session variance to correlate — so reading it from deployment config (rather than requiring the event to be expanded down to `latest_charge.transfer_data.destination`) is both simpler and more reliable, and mirrors how `checkout-session.ts` itself sources the value at Session-creation time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `checkout-webhook-system-service.ts` needed an additive `settlementEvidence` field, though it was not in this plan's declared `<files>` list**
- **Found during:** Task 3
- **Issue:** Task 3's action explicitly requires the settlement call to carry Stripe correlation identifiers into `PaymentAttempt.evidence`, but the evidence object is built entirely inside `activateOrderAsSystem` (`checkout-webhook-system-service.ts`), which was not listed among Task 3's `<files>` (`webhook.ts`, `route.ts`, the test file). There is no other pathway to get the route's narrowed evidence into the stored `PaymentAttempt.evidence` JSON without extending this function's input.
- **Fix:** Added an optional `settlementEvidence?: Record<string, unknown> | null` field to `ActivateOrderAsSystemInput`, spread into the existing narrowed `evidence` object (`...(input.settlementEvidence ?? {})`). Purely additive: the Paystack webhook route's existing call site (07-04) passes nothing and is unaffected.
- **Files modified:** `src/server/services/checkout-webhook-system-service.ts`
- **Verification:** `npx tsc --noEmit` clean; `tests/checkout-webhook-system-service.test.ts` (10/10) and `tests/checkout-webhook.integration.test.ts` (20/20, real Postgres) both green, including two new tests asserting the merged evidence shape and that the four actual-settlement columns stay NULL.

**2. [Rule 1 - Bug / Rule 3 - Blocking] The entire pre-existing `tests/checkout-webhook.integration.test.ts` file was NGN/Paystack-schedule-paired with `initiateStripePayment` — the exact crossed-rail pattern D-07 now forbids**
- **Found during:** Task 2, running the file's existing suite against the new currency guard
- **Issue:** This file's own header comment (pre-07-06) explicitly noted "this file's cohorts stay NGN/Stripe... since `initiateStripePayment` performs no currency/provider consistency check" — a pairing this very plan's Task 2 makes architecturally invalid. All 17 pre-existing cases would throw `ProviderCurrencyMismatchError` the moment `initiateStripePayment` ran against an NGN Order.
- **Fix:** Switched the file from `PAYSTACK_NGN_SCHEDULE`/`seedPaystackNgnFeeScheduleFixture` to `STRIPE_USD_SCHEDULE`/`seedStripeUsdFeeScheduleFixture` (mirroring 07-04's own precedent fix to `tests/checkout-hold-race.integration.test.ts`), replaced every `currency: "NGN"` and `startCheckout(..., "NGN")` literal with `"USD"`, added `currency: "USD"` to the bare-default `seedCohortFixture` calls (which otherwise default to a null USD price rail), and added `STRIPE_CONNECTED_ACCOUNT_ID` to `beforeAll`.
- **Files modified:** `tests/checkout-webhook.integration.test.ts`
- **Verification:** All 20 cases (17 pre-existing + 3 new) pass against real Postgres (Docker was available).

**3. [Rule 3 - Blocking] Six pre-existing `initiateStripePayment`-completing tests in `tests/checkout-service.test.ts` used NGN cohorts**
- **Found during:** Task 1/2, writing the new crossed-rail tests alongside the existing suite
- **Issue:** Same root cause as Deviation 2 — six tests that fully complete `initiateStripePayment` (PolicyAcceptance recording x3, PaymentAttempt creation, idempotency key, `declined=1` marker) used the harness's default NGN-priced cohort, which the new D-07 guard now refuses.
- **Fix:** Switched each to a USD-priced cohort (`coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })`) and `startCheckout(..., "USD")`, preserving every original assertion unchanged (no assertion was deleted or weakened — all six pre-existing checks still pass verbatim, just against a valid currency pairing).
- **Files modified:** `tests/checkout-service.test.ts`
- **Verification:** `npx vitest run tests/checkout-service.test.ts` — 48/48 pass.

**4. [Rule 3 - Blocking] `tests/checkout-hold-race.integration.test.ts` broke with `MissingSettlementAccountError`**
- **Found during:** Task 2, project-wide fallout check
- **Issue:** This file (already USD/Stripe-paired from 07-04's own prior fix) never set `STRIPE_CONNECTED_ACCOUNT_ID`, so `initiateStripePayment`'s new D-05 fail-closed check broke all three of its real-Postgres cases.
- **Fix:** Added `process.env.STRIPE_CONNECTED_ACCOUNT_ID = "acct_test_connected_hold_race_integration";` to its `beforeAll`, alongside the pre-existing `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` test values.
- **Files modified:** `tests/checkout-hold-race.integration.test.ts`
- **Verification:** All 3 cases pass against real Postgres.

**5. [Process note, not a deviation] Tasks 1 and 2 were implemented together rather than as a strict two-commit RED-then-GREEN sequence**
- Because staging (not committing) is this plan's only recorded artifact and the plan's own verification gate for Task 1 (`npx vitest run tests/checkout-service.test.ts` reporting failures) and Task 2 (`tsc --noEmit && vitest run ...` reporting success) were both run and confirmed in sequence during this session, the net effect — a RED run followed by a GREEN run — was achieved, but the staged diff reflects the final (GREEN) state rather than a separately staged RED-only snapshot. No test assertion was weakened to make this pass; every acceptance criterion in Task 1's `<behavior>` is present in the final suite.

---

**Total deviations:** 4 auto-fixed (1 missing-critical, 3 blocking-compile/runtime), 1 process note. **Impact on plan:** All four fixes were necessary, unavoidable consequences of Task 2's own currency-rail guard (D-07) and Task 2's connected-account fail-closed guard (D-05) — no scope creep, no new application-facing behavior beyond what the plan's three tasks already specified.

## Issues Encountered

None beyond the deviations above — Docker was available throughout, so no test case is BLOCKED.

## User Setup Required

None — this plan reads `STRIPE_CONNECTED_ACCOUNT_ID` (provisioned in `.env.local` by 07-01) and introduces no new environment variable or external service dependency.

**Outstanding human verification** (per this plan's own `<verification>` section, carried into `07-UAT.md`): a real Stripe test-mode destination charge against the provisioned connected account, confirming in the Stripe dashboard that the connected account's pending balance receives exactly the base price and the platform account's balance nets the remainder minus Stripe's actual fee. Not attempted in this sandbox (no browser, and a real charge requires a live Stripe test-mode checkout session a human must complete).

## Next Phase Readiness

- 07-07 (reconciliation sweep) can read `PaymentAttempt.evidence.paymentIntentId`/`chargeId`/`transferId`/`transferDestination` for Stripe rows, and has `ActivateOrderAsSystemInput.settlementEvidence` available as the same extension point if it needs to enrich evidence at a later settlement stage.
- 07-08 (manual payments/refunds) can read `settlement-config.ts`'s `stripeConnectedAccountId()`/`MissingSettlementAccountError` exactly as this plan does, and has the `ProviderCurrencyMismatchError` precedent for any future currency-rail guard it needs.
- No blockers. All changes staged (`git add`) but **not committed** per this plan's global constraint — the repository owner should review the staged diff and commit using the suggested per-task messages above (or a squashed equivalent) before continuing to 07-07.

## Known Stubs

None — every layer this plan touches (session builder, currency guards, webhook evidence) is fully wired against real logic, not a placeholder. The one deliberately deferred piece is the human-only real-Stripe-dashboard verification noted above, which is outside this plan's automatable scope by design (D-05's own precedent from 07-01).

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-12*

## Self-Check: PASSED

All 7 modified files verified present on disk with the expected changes:
`src/server/payments/providers/stripe/checkout-session.ts`,
`src/server/services/checkout-service.ts`,
`src/server/services/checkout-webhook-system-service.ts`,
`src/app/api/webhooks/stripe/route.ts`,
`tests/checkout-service.test.ts`, `tests/checkout-webhook.integration.test.ts`,
`tests/checkout-hold-race.integration.test.ts`, and this SUMMARY itself.
No commit hashes to verify — per this plan's `<global_constraints>`, every
change is staged with `git add` and never committed. Verified via
`git status --short`: all seven files show a clean staged `M ` (no unstaged
`MM` remainder).
