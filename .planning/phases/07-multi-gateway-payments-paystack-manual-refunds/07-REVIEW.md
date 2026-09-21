---
phase: 07-multi-gateway-payments-paystack-manual-refunds
reviewed: 2026-09-14T00:00:00Z
depth: standard
files_reviewed: 88
files_reviewed_list:
  - netlify/functions/reconcile-payments.ts
  - prisma/migrations/20260912120000_dual_currency_split_settlement/migration.sql
  - prisma/schema.prisma
  - prisma/seed.ts
  - prisma/sql/004_payment_split_integrity.sql
  - src/app/(checkout)/actions.ts
  - src/app/(checkout)/checkout/[orderId]/actions.ts
  - src/app/(checkout)/checkout/[orderId]/page.tsx
  - src/app/(checkout)/enrol/[cohortId]/page.tsx
  - src/app/(public)/CohortCards.tsx
  - src/app/api/webhooks/paystack/route.ts
  - src/app/api/webhooks/stripe/route.ts
  - src/app/orders/[reference]/page.tsx
  - src/app/staff/cohorts/CohortForm.tsx
  - src/app/staff/cohorts/[id]/edit/page.tsx
  - src/app/staff/cohorts/[id]/page.tsx
  - src/app/staff/cohorts/actions.ts
  - src/app/staff/layout.tsx
  - src/app/staff/payments/ManualPaymentDialog.tsx
  - src/app/staff/payments/PaymentsTable.tsx
  - src/app/staff/payments/RefundDialog.tsx
  - src/app/staff/payments/[orderId]/page.tsx
  - src/app/staff/payments/actions.ts
  - src/app/staff/payments/page.tsx
  - src/components/checkout/OrderBreakdownCard.tsx
  - src/server/auth/landing.ts
  - src/server/payments/payment-provider.ts
  - src/server/payments/pricing.ts
  - src/server/payments/providers/paystack/client.ts
  - src/server/payments/providers/paystack/initialize.ts
  - src/server/payments/providers/paystack/refund.ts
  - src/server/payments/providers/paystack/webhook.ts
  - src/server/payments/providers/stripe/checkout-session.ts
  - src/server/payments/providers/stripe/client.ts
  - src/server/payments/providers/stripe/refund.ts
  - src/server/payments/routing.ts
  - src/server/payments/settlement-config.ts
  - src/server/scheduled/reconcile-payments-task.ts
  - src/server/services/checkout-service.ts
  - src/server/services/checkout-webhook-system-service.ts
  - src/server/services/cohort-scope.ts
  - src/server/services/cohort-service.ts
  - src/server/services/domain-event-service.ts
  - src/server/services/manual-payment-service.ts
  - src/server/services/payment-read-service.ts
  - src/server/services/payment-reconciliation-service.ts
  - src/server/services/public-catalogue-service.ts
  - src/server/services/readiness-service.ts
  - src/server/services/refund-service.ts
  - src/server/support-contact.ts
  - src/server/payments/order-status.ts
  - tests/boundary.test.ts
  - tests/checkout-hold-race.integration.test.ts
  - tests/checkout-intent.integration.test.ts
  - tests/checkout-intent.test.ts
  - tests/checkout-phase-invariants.test.ts
  - tests/checkout-service.test.ts
  - tests/checkout-webhook-system-service.test.ts
  - tests/checkout-webhook.integration.test.ts
  - tests/cohort-actions.test.ts
  - tests/cohort-cancel.integration.test.ts
  - tests/cohort-lifecycle-security.integration.test.ts
  - tests/cohort-readiness.test.ts
  - tests/cohort-service.test.ts
  - tests/components/checkout-summary.test.tsx
  - tests/components/cohort-cards.test.tsx
  - tests/components/cohort-form.test.tsx
  - tests/components/cohort-pages.test.tsx
  - tests/components/order-confirmation.test.tsx
  - tests/components/payment-detail.test.tsx
  - tests/landing.test.ts
  - tests/manual-payment-service.test.ts
  - tests/manual-payment.integration.test.ts
  - tests/netlify-reconcile-payments.test.ts
  - tests/payment-pricing.test.ts
  - tests/payment-read-service.test.ts
  - tests/payment-reconciliation.integration.test.ts
  - tests/payment-routing.test.ts
  - tests/payments-settlement-config.test.ts
  - tests/paystack-provider.test.ts
  - tests/paystack-webhook.integration.test.ts
  - tests/public-catalogue-service.test.ts
  - tests/reconcile-payments-task.test.ts
  - tests/refund-service.test.ts
  - tests/refund.integration.test.ts
  - tests/schema-cohort.test.ts
  - tests/schema-payment-split.test.ts
  - tests/staff-payments-actions.test.ts
  - tests/support/cohort-fixtures.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-09-14
**Depth:** standard
**Files Reviewed:** 88
**Status:** issues_found

## Summary

This phase (Paystack integration, manual payments, refunds, dual-currency split settlement,
and payment reconciliation) is unusually well documented and mostly follows a consistent,
deliberate set of invariants: a single actorless settlement writer
(`checkout-webhook-system-service.ts`) is the only place `Order.status = "PAID"` is ever
written; webhook signature verification uses `timingSafeEqual` with a pre-check length guard
for both Stripe and Paystack; idempotency is enforced at the database level via
`WebhookEvent`'s `(provider, providerEventId)` unique constraint; refunds are capped against a
row-locked (`SELECT ... FOR UPDATE`) read of the Order plus an aggregate of prior non-FAILED
refunds, closing the same TOCTOU class of bug that seat-accounting already guards against for
capacity; and the new migration's CHECK constraints correctly enforce "never negative" at the
database layer as a backstop against application bugs.

Given that discipline, the review found one significant gap: the **manual payment confirmation
path does not apply the same row-locking discipline the refund service uses**, creating a
real TOCTOU race between a staff member confirming a manual (offline) payment and a
concurrent online (Stripe/Paystack) settlement for the same Order. This is the one place in
the reviewed diff where the "lock before check, then act" pattern that is applied carefully
everywhere else (seat holds, refunds) is missing. Two secondary, lower-severity issues
(a swallowed-idempotency gap on double-submit, and a dead/never-populated database column)
round out the findings.

## Critical Issues

### CR-01: Manual payment confirmation has no row lock — concurrent online settlement can corrupt the Order snapshot and downgrade a paid order to EXCEPTION

**File:** `src/server/services/manual-payment-service.ts:202-297`

**Issue:**

`confirmManualPayment` reads the Order's current status with a plain (non-locking) read,
decides whether the confirmation is blocked, and — if not blocked — unconditionally overwrites
several Order-level commercial-snapshot columns before creating a `PaymentAttempt` and calling
`activateOrderAsSystem`:

```ts
const order = await deps.order.findUnique({ where: { id: rawInput.orderId } });
if (!order) throw new OrderNotFoundError(rawInput.orderId);

if (isManualPaymentConfirmationBlocked(order.status)) {   // <-- plain read, no lock
  ...
  return { outcome: "ALREADY_PAID", existingAttempt: existing };
}
...
await deps.order.update({
  where: { id: rawInput.orderId },
  data: {
    amountMinor: expectedTotalMinor,
    platformFeeMinor,
    gatewayFeeEstimateMinor,           // <-- forced to 0 for "manual"
    selectedProvider: "MANUAL",        // <-- forcibly overwrites STRIPE/PAYSTACK
    schoolSettlementExpectedMinor: order.baseAmountMinor,
  },
});
```

Compare this with `refund-service.ts`'s explicit design (`RefundTxClient.lockOrder`, doc
comment at lines 262-271): "`lockOrder` MUST take a real row lock ... Without that lock, two
concurrent ... calls against the SAME Order could both read `alreadyRefundedMinor` before
either writes ... the exact TOCTOU `lockOpenCohort` already closes for seat capacity, applied
here to money." The refund service takes this seriously and uses `SELECT ... FOR UPDATE`
(`createPrismaBackedRefundService`, `prisma/sql` raw query). The manual-payment service
performs the analogous check-then-act sequence with **no lock of any kind** — not even the
Order's own `updatedAt` optimistic-concurrency token that `cohort-service.ts` uses elsewhere
in this same codebase (see `updateCohortAction`/`StaleOrderError`).

Concrete failure sequence:

1. A learner has a `PENDING` Order and has already opened a real Stripe/Paystack checkout
   session in another tab (or already wired a bank transfer AND started an online payment,
   which is exactly the ambiguous "did they double-pay" scenario `payments.confirm` exists to
   resolve).
2. Staff opens the Finance payment detail page and clicks "Confirm manual payment." Read #1
   (`deps.order.findUnique`) observes `status: "PENDING"` — not blocked.
3. Before staff's write lands, the learner's Stripe/Paystack webhook fires and
   `activateOrderAsSystem` runs to completion in its own transaction: `Order.status` becomes
   `PAID`, `Enrolment.status` becomes `ACTIVE`.
4. Staff's `confirmManualPayment` call proceeds (it already passed the blocked-check before
   step 3 committed) and calls `deps.order.update`, unconditionally setting
   `selectedProvider: "MANUAL"`, `gatewayFeeEstimateMinor: 0`, and
   `schoolSettlementExpectedMinor: order.baseAmountMinor` — silently overwriting the just-paid
   Order's real provider/fee snapshot with manual-confirmation values, even though the money
   never moved through a manual channel.
5. `confirmManualPayment` then creates a second `PaymentAttempt` (`provider: "MANUAL"`) and
   calls `activateOrderAsSystem` again. Inside that call, the amount/currency match still
   passes (the base amount is unchanged), but the enrolment-activation branch finds the
   enrolment is already `ACTIVE` and throws `AlreadyEnrolledError` — which
   `activateOrderAsSystem` handles by setting `Order.status = "EXCEPTION"` and appending an
   `exceptionNote`. **A genuinely, correctly PAID/ACTIVE order is downgraded to EXCEPTION**,
   and the Order's `selectedProvider`/`gatewayFeeEstimateMinor` are now wrong for the
   *already-settled* Stripe/Paystack `PaymentAttempt` — corrupting the very inputs
   `payment-reconciliation-service.ts` compares real provider evidence against
   (`order.gatewayFeeEstimateMinor`, now `0`, will show a spurious gateway-fee variance for
   the real online payment on every future reconciliation sweep).

This is exactly the TOCTOU class of bug `refund-service.ts`'s own header comment calls out
and defends against with a row lock — but the defense was not applied to the sibling
money-moving service introduced in the same phase.

**Fix:** Give `manual-payment-service.ts` the same lock-then-check-then-write discipline
`refund-service.ts` already has. At minimum:

```ts
// Inside one transaction, using SELECT ... FOR UPDATE (mirrors refund-service.ts's lockOrder):
const order = await tx.lockOrder({ orderId: rawInput.orderId });
if (!order) throw new OrderNotFoundError(rawInput.orderId);
if (isManualPaymentConfirmationBlocked(order.status)) {
  // return ALREADY_PAID, releasing the lock on commit/rollback
}
// ... validate, then write the Order snapshot mutation and create the
// PaymentAttempt inside the SAME locked transaction, so a concurrent webhook
// settlement cannot land between the check and the write.
```

At a minimum, re-check `order.status` a second time, inside a transaction, immediately before
the `order.update`/`paymentAttempt.create` writes (the same "re-read and re-evaluate inside the
transaction that claims the row" pattern `cohort-service.ts#publishCohort` already uses for its
own optimistic-concurrency race, referenced in that file as "CR-02").

---

## Warnings

### WR-01: Manual-payment double-submit throws an unhandled unique-constraint error instead of being treated as a duplicate

**File:** `src/server/services/manual-payment-service.ts:239-297`

**Issue:** The idempotency key for a manual confirmation is
`` `manual:${orderId}:${manualReference}` `` and `PaymentAttempt.idempotencyKey` is a `@unique`
column, so a resubmission (double-click, retried network request) with the same reference
before the Order's status has moved to a blocked state will hit a Prisma
`P2002` unique-constraint violation on `deps.paymentAttempt.create` (line ~258). Unlike the
webhook path, which explicitly anticipates and handles this exact class of race in
`recordWebhookEventOrSkip` (catches `P2002`, treats it as "already recorded," and returns
`{ isNew: false }` rather than throwing), this service has no equivalent catch. The error
propagates uncaught out of `confirmManualPayment`, and `confirmManualPaymentAction`
(`src/app/staff/payments/actions.ts`) has no matching `catch` clause for it either — it falls
through to `throw error;`, producing a raw 500 instead of the graceful "already confirmed"
outcome the type system (`ConfirmManualPaymentResult`) clearly anticipates.

Additionally, by the time the create throws, `deps.order.update` (mutating
`amountMinor`/`platformFeeMinor`/`gatewayFeeEstimateMinor`/`selectedProvider`/
`schoolSettlementExpectedMinor`) has **already run** for the second call — a second,
redundant, non-transactional write to the Order row that happens even though the subsequent
`PaymentAttempt` creation is about to fail. It is a same-value write in the common case
(harmless), but it is a second unguarded write to the Order's commercial snapshot on every
retry, compounding CR-01's lack of transactional isolation.

**Fix:** Wrap the `order.update` + `paymentAttempt.create` pair in a transaction, and catch the
unique-constraint violation on `idempotencyKey` the same way
`createRecordWebhookEventOrSkip` does, returning the existing/duplicate outcome instead of
letting the error surface as an unhandled exception.

### WR-02: `PaymentAttempt.providerRef` is read and displayed but never written by any Phase 7 settlement path

**File:** `prisma/schema.prisma:1316`, `src/server/services/checkout-webhook-system-service.ts:691-697`,
`src/server/services/manual-payment-service.ts:167-172, 345-351`,
`src/server/services/payment-read-service.ts:108-113, 268-274`,
`src/app/staff/payments/[orderId]/page.tsx:276`

**Issue:** `PaymentAttempt.providerRef` is selected in multiple read paths
(`ExistingAttemptFacts.providerRef` in both `manual-payment-service.ts` and
`payment-read-service.ts`) and rendered in the Finance UI
(`detail.existingAttempt?.providerRef ?? detail.existingAttempt?.providerIntentId ?? "—"`), but
grepping every write site in the reviewed diff shows it is **never assigned** by
`activateOrderAsSystem` (which only ever writes `providerIntentId` and the narrowed `evidence`
JSON blob) or by `confirmManualPayment`. The column is therefore always `NULL` for every
`PaymentAttempt` this phase's code creates, and the UI's fallback to `providerIntentId` is
silently doing all of the real work. This isn't causing a visible defect today (the fallback
covers it), but it is either dead schema/dead code (the column should be removed) or a missed
requirement (some call site was supposed to populate it with the *provider's* transaction
reference, distinct from the `providerIntentId` used for internal correlation, but nothing
does). Left as-is, a future refactor that removes the `?? providerIntentId` fallback will
silently regress the UI to blank "—" for every attempt.

**Fix:** Either populate `PaymentAttempt.providerRef` at settlement time (e.g. the Paystack
`verified.reference`/Stripe charge id, distinct from `providerIntentId`), or remove the column
and its read sites if it is intentionally superseded by `providerIntentId`/`evidence`.

## Info

### IN-01: `Refund.status` "REQUESTED" enum value is unreachable in the implemented flow

**File:** `prisma/schema.prisma:160-166`, `src/server/services/refund-service.ts:362-380`

**Issue:** `RefundStatus` declares `REQUESTED` as the default enum value, but
`recordRefund` always creates a `Refund` row with `status: "PROCESSING"` directly (line 374) —
there is no code path in this phase that ever leaves a `Refund` in `REQUESTED`. This mirrors
the intentionally-reserved-but-unreachable `PENDING_MANUAL_REVIEW` `PaymentStatus` value (which
is explicitly documented as deliberate in `checkout-webhook-system-service.ts:171-174`), but
`REQUESTED` has no equivalent doc comment explaining that it is reserved for a future
multi-step approval flow rather than an oversight. Not a functional bug, but worth an explicit
comment (mirroring the `PENDING_MANUAL_REVIEW` precedent) so a future reader doesn't spend time
looking for a "requested, not yet processing" code path that doesn't exist.

**Fix:** Add a one-line comment next to the `RefundStatus` enum (or on `Refund.status`) noting
that `REQUESTED` is reserved/unreachable in the current implementation, matching the existing
convention for `PaymentStatus.PENDING_MANUAL_REVIEW`.

---

_Reviewed: 2026-09-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
