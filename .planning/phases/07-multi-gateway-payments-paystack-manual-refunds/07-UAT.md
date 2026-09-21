---
status: complete
phase: 07-multi-gateway-payments-paystack-manual-refunds
source: [07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md, 07-05-SUMMARY.md, 07-06-SUMMARY.md, 07-07-SUMMARY.md, 07-08-SUMMARY.md, 07-09-SUMMARY.md, 07-10-SUMMARY.md, 07-11-SUMMARY.md]
started: 2026-09-13T12:00:00Z
updated: 2026-09-14T06:00:00+01:00
---

## Current Test

[accepted] The product owner accepted the 2,000-character maximum for manual-payment evidence. The rendered control enforces it, and the PAY-04 refunded-order manual-confirmation guard defect has been fixed and verified.

## Tests

### 1. NGN end to end (COH-02, PAY-08, PAY-15, PAY-16, PAY-17, D-25)
expected: A Cohort with an NGN base price of 45,000,000 kobo produces a learner total of 45,875,000 kobo. Pay it in Paystack test mode. Confirm in the Paystack dashboard/API: the school subaccount receives NGN 450,000, KQ NEXUS is allocated NGN 8,750 gross, Paystack deducts NGN 2,000 from KQ's allocation, KQ nets NGN 6,750.
result: PASS
evidence: |
  Live, real Paystack test-mode transaction, driven end-to-end via a real browser session (learner4.uat@example.com signed in) against cohort SLP-2026-03 (`cmtn3eo6j001huliwsyaw1sw4`, NGN base price 45,000,000 kobo — same figures as the D-25 example cohort).

  Order-summary breakdown rendered by the app matched exactly: School fee NGN 450,000.00 / KQ NEXUS platform fee (1.5%) NGN 6,750.00 / Estimated payment-processing fee NGN 2,000.00 / Total charged NGN 458,750.00.

  Real Paystack Initialize Transaction call succeeded (`https://checkout.paystack.com/0zcz0tbwnmqgj0w`); completed via Paystack's own test-mode "Success" flow on the real hosted checkout page.

  Paystack Verify Transaction API response (reference `ORD-20260913-271CE9D7`, transaction id `6554394136`), fetched directly against the real API — actual observed figures, not restated from D-25:
  ```json
  "fees": 200000,
  "fees_split": {
    "paystack": 200000,
    "integration": 675000,
    "subaccount": 45000000,
    "params": { "bearer": "account", "transaction_charge": "875000", "percentage_charge": "2" }
  }
  ```
  Interpreted: subaccount (school) received NGN 450,000 exactly; `transaction_charge` (KQ's gross allocation) was NGN 8,750 exactly; Paystack's actual fee was NGN 2,000 exactly; KQ's net (8,750 − 2,000) is NGN 6,750 exactly. All four figures match D-25's worked example precisely.

  Since Paystack cannot reach `localhost` to deliver its own webhook, a correctly HMAC-SHA512-signed `charge.success` webhook (signed with the real `PAYSTACK_SECRET_KEY` over the exact payload Paystack's real event would carry, using the real transaction id/reference/metadata from the Verify Transaction response above) was POSTed to `/api/webhooks/paystack` directly — mirroring exactly how 06-UAT.md proved the equivalent Stripe path in Phase 6. The route's own independent Verify Transaction call (PAY-07/Pitfall 1) confirmed `status: "success"` before settling.

  Resulting database state (confirmed by direct query): `Order.status: PAID` (`paidAt` set), `Enrolment.status: ACTIVE` (`activatedAt` set), `PaymentAttempt.status: SUCCEEDED`, `WebhookEvent.status: PROCESSED`.
source: live-manual (driven by Claude, real Paystack test-mode API + real hosted checkout)
coverage_id: D25-1

### 2. USD end to end (PAY-08, PAY-17, D-04)
expected: An administrator-entered USD base price produces a Stripe Checkout total including the 1.5% fee and the configured estimate; the destination transfer equals the base price; the webhook activates the enrolment exactly once. Confirm the fund flow in the Stripe dashboard.
result: PASS
evidence: |
  Live, real Stripe test-mode transaction, driven end-to-end via a real browser session against cohort SLP-2026-03 (test-data USD price set: $500.00 base).

  Order-summary breakdown rendered by the app matched the D-12 gross-up formula exactly: School fee $500.00 / KQ NEXUS platform fee (1.5%) $7.50 / Estimated payment-processing fee $15.47 / Total charged $522.97 (verified by hand: ceil((50000+750+30)/(1-0.029)) = 52297 cents).

  Completed on Stripe's real hosted checkout (`cs_test_a1UjnOTNxIPKQLCfDCn1YSaEHuPOkKLJpOl0DabOTy9WoVWhoL4w2q5npZ`) with Stripe's standard test card (4242 4242 4242 4242). Real Stripe API evidence retrieved directly after payment (not restated from D-04, actual observed values):
  ```json
  "PaymentIntent": { "status": "succeeded", "amount": 52297, "transfer_data": { "amount": 50000, "destination": "acct_1UEuyvDP8APVIOmH" } },
  "Transfer": { "amount": 50000, "destination": "acct_1UEuyvDP8APVIOmH" },
  "Platform balance_transaction": { "amount": 52297, "fee": 1547, "net": 50750 }
  ```
  Interpreted: `transfer_data.amount` (and the real Transfer object) moved exactly $500.00 — the base price — to the school's connected account, matching D-04 exactly. Stripe's actual fee was $15.47 — matching the app's own gross-up estimate exactly (no variance in this case). Platform's real retained amount after the $500 transfer (50750 − 50000 = 750 cents = $7.50) equals exactly the 1.5% platform fee.

  A correctly-signed test webhook (`stripe.webhooks.generateTestHeaderString`, mirroring 06-UAT.md's own Stripe verification method) was POSTed to `/api/webhooks/stripe` carrying the real Checkout Session object. Resulting database state (confirmed by direct query): `Order.status: PAID`, `Enrolment.status: ACTIVE`, `PaymentAttempt.status: SUCCEEDED` — settled exactly once, from a single delivered event.
source: live-manual (driven by Claude, real Stripe test-mode API + real hosted checkout)
coverage_id: D04-2

### Findings from live provider testing — fixed and retested
- **Interactive transaction timeouts.** Real checkout and settlement each exceeded Prisma's default five-second interactive-transaction limit. Both transactions now receive an explicit 15-second budget. Regression tests assert the option, and live Paystack checkout/settlement subsequently completed without P2028.
- **Failed webhook redelivery was stranded.** The event row was inserted before processing, but an unexpected settlement failure left it `RECEIVED`; redelivery was then discarded as a duplicate. Failed processing now marks the event retryable, and one redelivery atomically claims it. Unit/route tests pass, and the original real Paystack event was reclaimed and processed with HTTP 200.
- **Decline then success on the same Stripe intent was rejected.** A real `payment_intent.payment_failed` moved the attempt to `FAILED`; a later successful retry on the same Checkout Session could not move it to `SUCCEEDED`. `FAILED` and `CANCELLED` may now move only to `SUCCEEDED`, because verified captured money must supersede a previous decline/local cancellation. The same real Stripe Session was retried and finished `Order: PAID`, `Enrolment: ACTIVE`, `PaymentAttempt: SUCCEEDED`.
- **Double-active enrolment settlement crash.** Settlement now locks the cohort, detects an existing active enrolment and records a controlled paid-payment `EXCEPTION` instead of leaking a unique-constraint 500. Covered by regression test.

### 3. Crossed-rail rejection (PAY-08, D-07)
expected: Requests pairing NGN with Stripe and USD with Paystack are refused server-side with no payment attempt created.
result: PASS
evidence: |
  Live production-service calls against real Postgres tested both directions on fresh orders. NGN order `cmu0qrhgp0001s5tc4l629qbg` was passed to `initiateStripePayment`; USD order `cmu0qro460008s5tcunourbfl` was passed to `initiatePaystackPayment`. Both threw `ProviderCurrencyMismatchError`; each order's PaymentAttempt count remained exactly `0 → 0`.

  The earlier browser-DOM tamper also remained refused before order creation when the requested currency was unavailable for that cohort.
source: live-manual (real service boundary + real Postgres, both crossed directions; browser tamper for unavailable-price boundary)
coverage_id: PAY08-3

### 4. Provider event edge cases (PAY-07, PAY-11)
expected: For each provider: a decline, a cancel, a retry, a duplicate delivery and a delayed delivery. None produces a duplicate enrolment, a duplicate receipt or a duplicate financial effect; ambiguous cases appear as visible exceptions.
result: PASS
evidence: |
  All five edge cases were driven against each provider's real hosted test checkout, with signed local webhook delivery where the public provider could not call localhost:

  - **Decline:** Paystack showed `Declined / Retry with test details`; Stripe showed `Your credit card was declined` for card `4000 0000 0000 0002`. Neither order or enrolment became paid/active.
  - **Cancel:** browser navigation returned from each hosted page to its unchanged local checkout. No paid or active state was created.
  - **Retry:** Paystack failed then succeeded on the same hosted transaction (`ORD-20260914-C7C90B2D`); Stripe declined then succeeded on the same Checkout Session (`cs_test_a14lTQa...`). Both ended with one `PAID` Order, one `ACTIVE` Enrolment and one `SUCCEEDED` attempt. The Stripe retry exposed and drove the `FAILED → SUCCEEDED` fix described above.
  - **Duplicate:** the same Paystack event id `6555854425` and the same Stripe event id `evt_test_phase7_duplicate_20260914` were each delivered twice. Every response was 200; settled database state and one-attempt/one-enrolment cardinality remained unchanged.
  - **Delayed:** Paystack transaction `6555682260` and Stripe Session `cs_test_a1XMGs...` were delivered after their holds had been cancelled. Each recorded captured money as `PaymentAttempt: SUCCEEDED`, kept the enrolment `CANCELLED`, and put the order in visible `EXCEPTION`; no seat was silently reclaimed.

  Regression verification: affected five-file suite passed 109/109, including both real-Postgres webhook integrations.
source: live-manual (both real provider test modes) + signed local delivery + real-Postgres regression suites
coverage_id: PAY07-4

### 5. Currency change (D-09)
expected: Start an NGN order, then start a USD order for the same cohort. The first is superseded, not duplicated: one seat, one live hold, at most one paid result.
result: PASS
evidence: |
  Real HTTP-driven test as a fresh learner (learner5.uat@example.com) against cohort SLP-2026-03. Clicked "Pay in NGN with Paystack" (real order created, `cmtzw6xuj002gs5ck3xfnepua`, status PENDING), then — without paying — returned to the offer page and clicked "Pay in USD with Stripe" for the same cohort (real order created, `cmtzwp05o0003s5w0cxzve23r`).

  Direct DB confirmation after the second click: the first (NGN) order automatically transitioned to `CANCELLED`, and its Enrolment also transitioned to `CANCELLED` with `holdExpiresAt: null`. Only the second (USD) order is `PENDING`, with exactly one live Enrolment (`PENDING_PAYMENT`, an active hold). `Cohort.seatsTaken` reflects exactly one seat for this learner, never two. At most one paid result is possible from here — no duplicate hold, no duplicate seat count.
source: live-manual (real HTTP requests via Playwright, DB-confirmed)
coverage_id: D09-5

### 6. Fail closed (D-05)
expected: With the school settlement identifier absent or the provider reporting the account cannot receive the intended settlement, checkout fails closed with a support route and no unpayable order is created.
result: PASS
evidence: |
  Both identifiers were temporarily set to whitespace inside isolated test processes (the real `.env.local` values were not edited). Real production service code and real Postgres were used.

  - Blank `PAYSTACK_SUBACCOUNT_CODE`: `MissingSettlementAccountError`; PaymentAttempt count remained `0 → 0` after the Paystack fail-closed ordering defect was found, fixed, regression-tested and retested live.
  - Blank `STRIPE_CONNECTED_ACCOUNT_ID`: `MissingSettlementAccountError`; PaymentAttempt count remained `0 → 0`.

  No provider request/session was created in either case. The public catalogue's existing enabled-rail filter suppresses that rail's CTA and renders the support route for ordinary browser navigation.
source: live-manual (real production services + real Postgres with isolated missing-env simulation) + UI component/service coverage
coverage_id: D05-6

### 7. Refunds (PAY-05, PAY-13, D-22, D-23)
expected: A full and a partial refund on each provider. Component allocation and the provider's actual reported outcome are both recorded; no fee return is assumed. Confirm in each dashboard what actually happened to the school's settled portion.
result: PASS (after a real bug was found and fixed live during this test)
evidence: |
  Driven through the real Finance staff UI (`/staff/payments/[orderId]`, signed in as `finance@kqnexus.test`), not a script bypassing the UI — the Finance list and detail pages rendered live, correctly, against all 8 real orders created this session (exact D-25/D-04 breakdowns, correct "— (pending reconciliation)" nulls, the PAY-04 already-paid guard).

  **Paystack — PARTIAL refund, NGN 100,000 of the NGN 458,750 order (scenario 1's real order):**
  Recorded via the real dialog. `Refund.status: COMPLETED`, `providerRef: "18258281"`. Independently confirmed via Paystack's own Refund API (not restated): `refund_type: "Partial"`, `amount: 10000000`, status progressed from `pending` to `processed` over the course of this session. `providerOutcome` text correctly states the school-settlement reversal is "not independently confirmed by this response — recorded as reported," matching 07-01 Decision B (B2) verbatim — no fee return was assumed.

  **Stripe — FULL refund, $522.97 of the $522.97 order (scenario 2's real order) — a real bug was found here, fixed live, and retested:**
  First attempt: `Refund.status: FAILED`, `providerOutcome: "No such payment_intent: 'cs_test_...'"`. Root cause: `PaymentAttempt.providerIntentId` holds the Stripe Checkout **Session** id (captured at order initiation), never the PaymentIntent id — but the real PaymentIntent id was already being captured separately at settlement time, in `PaymentAttempt.evidence.paymentIntentId` (07-06/07-07's `buildStripeSettlementEvidence`). `refund-service.ts`'s Stripe branch read the wrong field. The failure itself was handled exactly right — an honest `FAILED` status with Stripe's verbatim error, no false success (proving PAY-13's failure-handling half was already correct).

  **Fix (in-session, with explicit approval):** added `resolveStripeRefundTarget()` to `refund-service.ts`, preferring `evidence.paymentIntentId` and falling back to `providerIntentId` only when evidence carries no usable id. `tests/refund-service.test.ts`'s two existing Stripe tests were corrected to stop masking the bug (they had used a `pi_...`-shaped `providerIntentId`, which is not what real settlement ever writes there) and a third regression test was added proving the fallback path. 38/38 tests pass; `tsc --noEmit` clean; the PAY-09 provider-isolation invariant still passes unchanged.

  **Retest, same real order, after the fix:** `Refund.status: COMPLETED`, `providerRef: "re_3UFDsgDP8AyoFm7U1puK8ijY"`, `providerOutcome: "Stripe refund succeeded (amount 52297 usd); reverse_transfer=true."` — matching 07-01 Decision A (full refund → `reverse_transfer: true`) exactly. Independently confirmed via Stripe's own API (not restated): `refund.status: "succeeded"`, `refund.payment_intent: "pi_3UFDsgDP8AyoFm7U1XIy2Jom"` (the correct PaymentIntent, proving the fix), and the underlying Transfer object shows `amount_reversed: 50000, reversed: true` — the full $500.00 base-price transfer was genuinely pulled back from the school's connected account.

  **Paystack — FULL refund, NGN 458,750 of a second real NGN order (`ORD-20260914-BABE064F`):** submitted through the Finance dialog. The LMS recorded `Refund.status: COMPLETED`, `providerRef: "18263033"`, and exact components `45,000,000 + 675,000 + 200,000 = 45,875,000` kobo. Paystack's Refund API returned HTTP 200, `refund_type: "Full"`, `amount: 45875000`, currency `NGN`, status `processing`. This is an accepted provider outcome, not a claim that settlement reversal has already completed.

  **Stripe — PARTIAL refund, $100.00 of a second real $522.97 order (`ORD-20260914-94ECFA8A`):** submitted through the Finance dialog. The LMS recorded `Order.status: PARTIALLY_REFUNDED`, `Refund.status: COMPLETED`, provider ref `re_3UFQZYDP8AyoFm7U0OdxHbPU`, and components `10000 + 0 + 0 = 10000` cents. Stripe's API independently returned `status: succeeded`, amount `10000 usd`; the original $500 transfer showed `amount_reversed: 0, reversed: false`, matching the partial-refund policy (`reverse_transfer=false`).

  **Component allocation, all four refunds:** `baseComponentMinor + platformComponentMinor + gatewayComponentMinor` summed exactly to each refunded amount. `accessDecision: RETAINED` was recorded explicitly, with zero side effect on enrolment access.
source: live-manual (real Finance UI, real Paystack + Stripe refund APIs) — includes an in-session bug fix, approved by the repository owner before applying
coverage_id: PAY13-7

### Finding fixed this session
- **Stripe refund PaymentIntent-id resolution bug (found and fixed).** See scenario 7 above for the full account. Fixed in `src/server/services/refund-service.ts` (new `resolveStripeRefundTarget` export) and `tests/refund-service.test.ts` (two corrected fixtures + one new regression test). Staged, not committed, per the standing no-auto-commit rule.

### 8. Receipt immutability (D-13, D-18)
expected: Edit the Cohort's price and the active fee schedule after a paid order. The receipt's four lines are unchanged.
result: PASS (with a secondary, non-blocking finding — see below)
evidence: |
  Real receipt page (`/orders/ORD-20260913-271CE9D7`) captured BEFORE any edit: School fee NGN 450,000.00 / KQ NEXUS platform fee (1.5%) NGN 6,750.00 / Estimated payment-processing fee NGN 2,000.00 / Total charged NGN 458,750.00.

  Then, directly against the live database: the Cohort's `priceNgnMinor` was changed from 45,000,000 to 99,000,000 (a wildly different price), and the active `GatewayFeeSchedule` row was deactivated and replaced with a new one carrying completely different rates (5% + NGN 5,000 fixed, vs. the original 1.5% + NGN 100 capped at NGN 2,000).

  Re-loaded the same real receipt page AFTER both edits: all four breakdown lines and the total were byte-identical to the pre-edit capture. Confirms D-13/D-18 — the receipt reads exclusively from the Order's own immutable snapshot columns, never recomputing from the Cohort's or schedule's current state. Test-data changes reverted immediately after (cohort price restored, temporary schedule row deleted, original schedule reactivated).
source: live-manual (real page, real DB edit, real re-render)
coverage_id: D13-8

### Secondary finding — refund receipt labels fixed and verified
The Phase-6-era receipt status branch was extended for `PARTIALLY_REFUNDED` and `REFUNDED`. Regression tests now assert accurate refund copy and ensure the stale "Payment received — finishing up" message is absent for both states.

### 9. Reconciliation-exception banner at large variance (carried from 07-10, 07-UI-SPEC §8 backstop)
expected: A real large settlement variance renders the Finance-detail exception pill and warning-toned banner legibly, with the expected and actual values still readable.
result: PASS
evidence: |
  Resumed 2026-09-13 from Claude's incomplete setup. The prior screenshot showed expected school settlement `$500.00` and manually changed actual settlement `$0.01`, but `PaymentAttempt.exceptionNote` was still null; `derivedSettlementState` therefore correctly returned `RECONCILED`. That was incomplete test-data setup, not a demonstrated UI failure.

  Set the same attempt's test-only `exceptionNote` to the reconciliation service's large-variance message, rendered the real Finance detail, and observed: an `Exception` status pill; the warning-toned banner headed `Settlement doesn't match the expected amount`; its full non-alarming body; and the expected `$500.00` versus actual `$0.01` values legibly displayed below. Browser role inspection found the banner alert, and a full-page screenshot was captured outside the repository at `C:\Users\USER\AppData\Local\Temp\kq-phase7-scenario9.png`.

  Cleanup completed in a `finally` block: `schoolSettlementActualMinor` was restored to the provider-confirmed `$500.00` value and the test-only `exceptionNote` was removed.
source: live-manual (real Finance page, temporary test-data exception state, visually and semantically verified)

### 10. ManualPaymentDialog evidence-field ceiling (carried from 07-10, 07-UI-SPEC §8 unresolved)
expected: Confirm or override the planner's assumed 2,000-character maximum for manual-payment evidence; the rendered control must enforce whichever limit the owner accepts.
result: PASS
evidence: |
  Opened the real Finance `Confirm manual payment` dialog and inspected the actual rendered control. It is a multi-line `TEXTAREA` whose DOM `maxLength` property is exactly `2000`. Inserted 2,005 characters through a browser text-input event: the browser accepted exactly 2,000 and discarded the remaining five. The visible counter read `2000 / 2000 maximum`. Screenshot captured outside the repository at `C:\Users\USER\AppData\Local\Temp\kq-phase7-scenario10.png`.

  The implementation enforces the planned ceiling correctly. On 2026-09-13, the product owner accepted 2,000 characters as sufficient; longer supporting documents belong in uploaded evidence rather than this narrative field.
source: live-manual (real rendered dialog and native browser maxlength enforcement)

### Finding from Scenario 10 — manual confirmation offered on a refunded order
result: PASS — fixed and verified
evidence: |
  The original failure was reproduced in automated tests at both boundaries: `PARTIALLY_REFUNDED`, `REFUNDED`, and `EXCEPTION` each allowed the service to return `ACTIVATED`, and each rendered the manual-confirm trigger in the Finance UI.

  A shared fail-closed rule now blocks `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED`, and `EXCEPTION` at both the Server Component and service boundary. The service regression cases prove each guarded state returns `ALREADY_PAID` with zero Order updates, zero PaymentAttempt creates, zero activation calls, and zero audit writes. The component cases prove the warning renders and the confirm affordance is absent.

  Focused verification: 47/47 service and component tests passed; 2/2 real-Postgres manual-payment integration tests passed; 10/10 phase invariant tests passed on isolated rerun; TypeScript completed with exit 0; focused ESLint completed with 0 errors and 3 pre-existing unused-variable warnings in the test file.

  Live browser verification against the real refunded Stripe test order rendered one `Refunded` status, one `This order is already paid` warning, and zero `Confirm manual payment` buttons. Screenshot: `C:\Users\USER\AppData\Local\Temp\kq-phase7-refunded-guard.png`.
source: TDD regression tests + real-Postgres integration + live-manual Finance page

### Final checkout hydration finding — fixed and verified
result: PASS — fixed and verified
evidence: |
  The final live-server audit exposed a React hydration error in `HoldCountdown`: the server and browser
  each evaluated `Date.now()` independently, so the first browser render was commonly one second behind
  the server HTML. A regression test first reproduced the exact `9:47` versus `9:46` hydration failure.

  The checkout page now passes the server's exact remaining-time snapshot into the client component.
  The client hydrates from that stable value, then its effect immediately resumes clock-based ticking.
  The component suite passes 27/27, including the new server-render/hydrate regression.

  Live verification used a brand-new test learner and a newly created order. The checkout rendered a
  `29:50` countdown and Playwright observed zero console or page errors matching `Hydration failed`.
source: TDD regression + live browser against the running Next.js development server
