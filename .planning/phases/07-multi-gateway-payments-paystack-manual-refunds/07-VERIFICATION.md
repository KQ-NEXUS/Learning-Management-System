---
phase: 07-multi-gateway-payments-paystack-manual-refunds
verified: 2026-09-29
status: passed
score: 11/11 requirements verified
overrides_applied: 0
---

# Phase 7: Multi-Gateway Payments, Learner-Paid Fees, Split Settlement, Manual Payments & Refunds — Verification Report

**Verified:** 2026-09-29 (retroactive — the phase shipped without a VERIFICATION.md; flagged in the v1.0 milestone audit, section 5)
**Status:** passed
**Re-verification:** No — initial verification

## Method

Checked against the current code and a live re-run on 2026-09-29: 26 test files, **426/426 passed**, including seven real-Postgres (Testcontainers) suites — `checkout-webhook.integration` 22/22, `paystack-webhook.integration` 6/6, `manual-payment.integration` 3/3, `refund.integration` 8/8, `payment-reconciliation.integration` 10/10, `reconciliation-case.integration` 4/4, `checkout-intent.integration` 4/4. UAT: `07-UAT.md` 12/12 passed against real Paystack and Stripe test-mode checkouts, two bugs found and fixed live. The code review's findings (07-REVIEW CR-01, WR-01, WR-02) are fixed in code; their todo was closed today.

Payment code has since been hardened by the security audit (F-02 checkout sessions bounded by the seat hold and a per-attempt Paystack reference, F-16 Paystack non-charge events, F-17 refund edge cases, F-03 reconciliation back-off) and by integration warning #3 (a refund's "Revoke access" is now acted on) — all included in the re-run above.

## Requirements

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | **PAY-03** — `payments.confirm` staff confirm an approved manual payment with amount, currency, date, channel, reference, evidence, reason; one audit, one enrolment effect | ✓ VERIFIED | `manual-payment-service.ts` refuses any missing field and writes nothing (e.g. missing `currency`, missing `manualEvidenceKey`); refuses a currency mismatch and an amount ≠ base + platform fee (`manual-payment-service.test.ts` 23/23). Real Postgres: moves the Order to PAID and the Enrolment to ACTIVE through the shared settlement transition with exactly one actor-attributed audit row and one activation (`manual-payment.integration`). |
| 2 | **PAY-04** — Duplicate/conflicting confirmation prevented; staff shown the existing transaction and a corrective path | ✓ VERIFIED | A second confirmation returns `ALREADY_PAID` with no second attempt, audit or enrolment effect; concurrent confirmations serialize into one activation (`manual-payment.integration`). The action surfaces the existing transaction's provider, date and reference (`staff-payments-actions.test.ts`); payment detail shows an already-paid banner with no confirm affordance (`payment-detail.test.tsx`). |
| 3 | **PAY-05** — `refunds.manage` records refunds; amount, reason, approver, access decision, actor, time preserved; never above eligible value | ✓ VERIFIED | `refund-service.ts`: eligible cap computed under an Order row lock from the Order's own history; two concurrent refunds never exceed it (`refund.integration`). Reason, approver, `accessDecision`, actor and time stored and audited. Since 2026-09-28 REVOKED actually withdraws the enrolment (integration warning #3). |
| 4 | **PAY-07** — Delayed, duplicate, out-of-order notifications safe; ambiguous cases enter a visible exception state | ✓ VERIFIED | Webhook events are recorded once (`recordWebhookEventOrSkip`). Real Postgres: payment after another ACTIVE enrolment won → 200 + reconciliation exception; amount/currency mismatch → EXCEPTION, never activates; hold expired before the webhook → EXCEPTION with correct seat arithmetic (`checkout-webhook.integration`, `paystack-webhook.integration`). Staff see an exception banner (`payment-detail.test.tsx`). |
| 5 | **PAY-08** — Learner picks an offered currency price before order creation; NGN→Paystack, USD→Stripe only; manual shown only when configured; no client re-pairing; no FX | ✓ VERIFIED | `providerForCurrency` is the only place a provider is chosen and takes one argument — no override (`payment-routing.test.ts` 16/16); the base price is read from the Cohort's matching rail, never the client; a missing rail creates no Order and no hold (`checkout-service.test.ts`); no currency → never defaults to a rail (`checkout-intent.test.ts`). **Manual:** by decision D-16/D-19 learners are offered only the two online options; offline payments are recorded by staff (PAY-03), so a manual option is never shown unconfigured. |
| 6 | **PAY-11** — Initiation, confirmation, failure, cancellation, refund, reconciliation idempotent across methods; at most one successful payment effect and active enrolment | ✓ VERIFIED | Online and manual share one settlement transition under an Order `FOR UPDATE` lock; a second success on a paid Order is `ALREADY_PAID` (manual) or an EXCEPTION (online), never a second enrolment (`checkout-webhook-system-service.test.ts`, `manual-payment.integration`). Refunds carry the refund id as the provider idempotency key (F-17). Reconciliation writes actuals once and backs off failing rows (F-03). |
| 7 | **PAY-13** — Refund routes to the original provider or records a controlled manual outcome; capped; auditable | ✓ VERIFIED | Stripe refunds target the PaymentIntent (not the Checkout Session) with an explicit amount and `reverse_transfer` true only for a full refund; Paystack refunds send an explicit amount; MANUAL records `RECORDED_MANUALLY`; a provider failure records FAILED, never success (`refund-service.test.ts` 32/32). |
| 8 | **PAY-14** — Credentials and webhook secrets only in deployment secret storage; never in browser, exports, audit, staff UI or source | ✓ VERIFIED | Server-only configuration (`payments-settlement-config.ts`, `stripe/client.ts`); checkout renders no provider secret or account identifier (`checkout-summary.test.tsx`, T-07-12); settlement evidence is stored without secret-bearing fields (`checkout-webhook.integration`); report exports use allow-listed `safeColumns`; `.env` is git-ignored. Since 2026-09-28 Turbopack's build cache no longer writes secret values to disk (Netlify secrets-scan fix). |
| 9 | **PAY-15** — Platform fee exactly 1.5% of the base price, integer minor units, never 1.5% of the grossed total | ✓ VERIFIED | `payment-pricing.test.ts` 23/23 — "1.5% of 45_000_000 is 675_000", half-up rounding at .5, "never equals 1.5% of the grossed-up total (688_125 must not appear)". |
| 10 | **PAY-16** — Gross-up from an explicit, versioned provider fee schedule (percentage, fixed, threshold, cap, tax, rounding); order snapshot reproducible after config changes | ✓ VERIFIED | `GatewayFeeSchedule` declares every D-11 field with provider+currency+version uniqueness and a positive-version check constraint (`schema-payment-split.test.ts` 38/38). Orders snapshot six D-13 columns; payment detail throws rather than render without a snapshot. |
| 11 | **PAY-17** — Provider-native split settlement; school gets the base price, KQ the platform allocation, bears the gateway charge; expected vs actual reconcilable | ✓ VERIFIED | Paystack: `transaction_charge`, `bearer: 'account'`, the subaccount code and explicit currency (`paystack-provider.test.ts`). Stripe: a destination charge whose base price and learner total both survive settlement, with PaymentIntent/charge/transfer correlation recorded (`checkout-webhook.integration`). Reconciliation writes the four actual columns and flags a school settlement beyond tolerance with both figures named (`payment-reconciliation.integration`). |

**Score:** 11/11

## Notes

- PAY-08's manual clause is met by decision (D-16/D-19), not by a configurable learner option. If a learner-facing "pay by bank transfer" option is wanted later, it needs a configuration flag and checkout UI — a new requirement, not a defect here.
- The receipt/confirmation emails that exist today are dispatched from the settlement transition; broader lifecycle notifications are Phase 13.

## Human verification

Already done: `07-UAT.md`, 12/12 against real provider test mode.
