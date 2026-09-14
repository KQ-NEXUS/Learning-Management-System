---
created: 2026-09-14T00:00:00.000Z
title: Fix Phase 07 review findings — manual-payment race condition, idempotency, providerRef
area: payments
source: 07-REVIEW.md (standard-depth review of the paystack-integration merge)
files:
  - src/server/services/manual-payment-service.ts
  - src/server/services/payment-read-service.ts
  - prisma/schema.prisma
---

## Problem

A full code review of Phase 7 (multi-gateway payments: Paystack + manual
refunds), run right after the `paystack-integration` branch merged into
`develop`/`Khaliddev`, found one critical and two warning-level issues. None
blocked Phase 7's UAT (all 10 scenarios passed), but the critical item is a
real money/enrolment-integrity gap worth closing before Phase 8 builds
reconciliation dashboards on top of this data.

### CR-01 (critical) — unguarded check-then-act race in manual payment confirmation
`manual-payment-service.ts` (~lines 202-297) reads `Order.status`, decides
whether manual confirmation is blocked, then unconditionally overwrites
`selectedProvider`, `gatewayFeeEstimateMinor`, `schoolSettlementExpectedMinor`,
and `amountMinor` on the Order — **with no row lock**. `refund-service.ts`
already solved this exact class of race for refunds with an explicit
`SELECT ... FOR UPDATE`; that pattern was not carried over to the manual
payment path. Concrete failure: a staff member confirms a manual payment at
the same moment a Stripe/Paystack webhook settles the same order — the
Order snapshot can be silently corrupted with manual-flow values, and the
order can be downgraded from `PAID`/`ACTIVE` to `EXCEPTION` when
`activateOrderAsSystem` collides with the already-active enrolment.
Fix: mirror `refund-service.ts`'s row-lock pattern in the manual payment
confirmation path.

### WR-01 — duplicate manual confirmation throws raw Prisma error instead of idempotent skip
A second manual confirmation with the same `manualReference` throws an
unhandled unique-constraint error. The webhook path already handles this
class of duplicate via `recordWebhookEventOrSkip`; the manual path should
follow the same idempotency convention. Also: the `order.update` and
`paymentAttempt.create` in this path aren't wrapped in one transaction, so a
failure between them can leave inconsistent state.

### WR-02 — `PaymentAttempt.providerRef` is read everywhere but never written
`providerRef` is selected and displayed in the Finance UI and
`payment-read-service.ts`, but no Phase 7 settlement path writes it — it's
always `NULL`, papered over by a `?? providerIntentId` fallback in the UI.
Either wire it up at write time or remove the dead column/field.

## Not included

- INFO-01 (`RefundStatus.REQUESTED` unreachable enum value, no comment) —
  cosmetic, not tracked here; add a comment noting it's reserved, same as
  `PaymentStatus.PENDING_MANUAL_REVIEW`, whenever this file is next touched.
