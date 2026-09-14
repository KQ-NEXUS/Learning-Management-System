---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 12
subsystem: payments
tags: [uat, paystack, stripe, webhooks, refunds, verification]

requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-11)
    provides: "Completed multi-gateway implementation and deployment documentation"
provides:
  - "A ten-item real-provider test-mode UAT record covering both payment rails, refunds, event edge cases, immutable receipts, and Finance UI backstops"
  - "A reconciled validation map for all twelve Phase 7 requirements"
  - "Regression fixes for transaction timeouts, retryable webhook delivery, decline-to-success retries, fail-closed Paystack configuration, and real Stripe refund targeting"
  - "A hydration-safe seat-hold countdown verified by both server-render/hydrate regression and a live browser"
affects: [08-finance-reconciliation-dashboards-reporting-exports]

actuals:
  tasks: 3
  commits: 0

key-files:
  created:
    - .planning/phases/07-multi-gateway-payments-paystack-manual-refunds/07-12-SUMMARY.md
  modified:
    - .planning/phases/07-multi-gateway-payments-paystack-manual-refunds/07-UAT.md
    - .planning/phases/07-multi-gateway-payments-paystack-manual-refunds/07-VALIDATION.md
    - src/server/services/checkout-service.ts
    - src/server/services/checkout-webhook-system-service.ts
    - src/server/services/refund-service.ts
    - src/app/api/webhooks/paystack/route.ts
    - src/app/api/webhooks/stripe/route.ts
    - tests/checkout-service.test.ts
    - tests/checkout-webhook-system-service.test.ts
    - tests/paystack-provider.test.ts
    - tests/refund-service.test.ts

key-decisions:
  - "A verified later capture may move a FAILED or CANCELLED PaymentAttempt only to SUCCEEDED; SUCCEEDED remains terminal. This preserves captured money after a decline retry or delayed success without reopening arbitrary transitions."
  - "A webhook processing failure leaves an explicitly retryable event marker. Redelivery atomically reclaims that marker, while an ordinary duplicate remains a no-op."
  - "Checkout and settlement database transactions use a 15-second timeout because real provider verification can exceed Prisma's default interactive-transaction window."
  - "Phase 7's expiry/reconciliation background path is a Netlify Scheduled Function, not an npm worker process."

requirements-completed: [COH-02, PAY-03, PAY-04, PAY-05, PAY-07, PAY-08, PAY-11, PAY-13, PAY-14, PAY-15, PAY-16, PAY-17]
completed: 2026-09-14
status: complete
---

# Phase 07 Plan 12: Automated and Real-Provider Acceptance Summary

**Phase 7 is complete in provider test mode: all ten UAT scenarios passed with live Paystack/Stripe or rendered-UI evidence, every requirement is reconciled, lint and the production build pass, and no reproducible assertion failure remains.**

## Task Results

### Task 1 — automated acceptance

- `npm run lint`: exit 0, 10 warnings, 0 errors.
- `npm run build`: exit 0 on Next.js 16.3.4; compilation, TypeScript, page-data collection, and all 28 static pages completed.
- Full `npm test`: 141 files attempted; 137 files passed, 1,882 tests passed, and 47 tests skipped. Four files were interrupted only by Docker Desktop/Testcontainers HTTP 409 container-stop responses, not assertion failures.
- Clean isolated accounting for those four files: Paystack webhook passed in the 109/109 affected regression run; continuity concurrency passed 14/14; publish passed 15/15; schema payment split passed 38/38.
- Focused payment regression run: 5 files and 109/109 tests passed.

The full-suite process therefore retained its non-zero Docker-infrastructure result in `07-VALIDATION.md`; it was not rewritten as an exit-0 run. Each affected test file passed when rerun cleanly in isolation.

### Task 2 — ten-scenario provider and UI UAT

All ten items in `07-UAT.md` are PASS with observed evidence:

1. Real Paystack NGN 450,000 base payment charged NGN 458,750 and preserved the planned school/platform split.
2. Real Stripe USD destination charge transferred the immutable base amount to the connected account and activated exactly once.
3. NGN→Stripe and USD→Paystack were both rejected server-side with zero payment attempts.
4. Decline, cancel, retry, duplicate, and delayed events were exercised on both providers without duplicate financial or enrolment effects.
5. Changing currency superseded the prior live hold without producing a second seat.
6. Missing Paystack and Stripe settlement credentials failed closed with zero payment attempts.
7. Full and partial refunds were exercised on both providers; component allocations and actual provider outcomes were recorded without assuming a fee return.
8. Receipt values remained unchanged after live Cohort-price and fee-schedule edits.
9. The large-variance Finance exception banner rendered visibly and readably.
10. The manual-payment evidence textarea enforced the owner-approved 2,000-character limit.

### Task 3 — record reconciliation

- `07-VALIDATION.md` maps every Phase 7 requirement to its delivering plan, automated proof, and UAT evidence, with no pending row.
- `07-UAT.md` records the live findings and fixes without summarizing away the initial failures.
- The only intentional product deferral remains the legacy Cohort `priceMinor`/`currency` column drop from 07-11; an AST invariant proves production code no longer reads those fields.

## Defects Found and Resolved During Acceptance

- Extended checkout and settlement transaction timeouts to prevent real provider calls from expiring Prisma transactions.
- Made failed webhook processing safely reclaimable on provider redelivery.
- Allowed a verified success after an earlier provider decline or local cancellation.
- Moved Paystack subaccount validation before PaymentAttempt creation so missing settlement configuration truly fails closed.
- Corrected Stripe refunds to use the captured PaymentIntent evidence rather than the Checkout Session id.
- Preserved delayed captured payments as visible exceptions when their seat hold had already expired.
- Removed the checkout countdown's server/browser clock mismatch by hydrating from the server's exact remaining-time snapshot; the regression suite passes 27/27 and a new live checkout reported zero hydration errors.

## Commits

No commit was created. This follows the repository owner's standing rule that all Phase 7 work remains available for review before the owner commits it.
