/**
 * The enrolment/payment mapper group (D-07, D-09).
 *
 * `enrolment.activated` (a verified payment) and `enrolment.approved` (a
 * staff approval with no payment) share ONE mapper — both mean "the seat is
 * confirmed" and both produce exactly the same `enrolment-confirmed` mail,
 * with an order section only when the enrolment actually has an order
 * (D-07's "one combined mail per settlement", never a second mail for the
 * payment itself). `order.paid` deliberately has NO mapper here — it
 * processes silently, since the combined mail is triggered by the enrolment
 * side, not the payment side.
 *
 * `order.exception` maps to a learner mail ONLY for the `illegal_transition`
 * reason — the Pitfall-4 "payment received, finishing up" case where the
 * money genuinely moved but the seat hold had already lapsed. Every other
 * reason (`duplicate_active_enrolment`, `amount_or_currency_mismatch`,
 * `payment_attempt_not_found`, `illegal_payment_transition`) is staff-only
 * territory (a later plan) and yields no learner intent here.
 *
 * `payment.failed` and `payment.refunded` (D-09) are added by Task 3 —
 * both load their own row fresh through `ctx.tx` and copy only named,
 * allow-listed fields; neither a refund reason, a provider outcome, nor a
 * failure reason ever reaches a persisted param (T-13-03).
 */

import {
  requireString,
  type EventMapper,
  type MapperGroup,
} from "@/server/services/event-intent-mappers";
import { formatMinorAmount } from "@/server/communications/format-amount";
import { buildCorrelationId } from "@/server/communications/contracts";
import { enrolmentPath, orderPath } from "@/server/communications/links";

/**
 * `enrolment.activated` and `enrolment.approved` share this mapper (D-07):
 * the enrolment row itself is the seat truth, and its optional `order`
 * relation is what distinguishes a paid enrolment (order section, amount
 * label) from a staff-approved one (neither). Returns no intents at all when
 * the enrolment no longer exists — the event still processes with zero rows,
 * never a mapping failure.
 */
const enrolmentConfirmed: EventMapper = async (event, ctx) => {
  const enrolmentId = requireString(event.payload, "enrolmentId");

  const enrolment = await ctx.tx.enrolment.findUnique({
    where: { id: enrolmentId },
    select: {
      id: true,
      userId: true,
      cohort: { select: { title: true } },
      order: { select: { reference: true, amountMinor: true, currency: true } },
    },
  });
  if (!enrolment) return [];

  const cohortTitle = enrolment.cohort.title;
  const orderReference = enrolment.order?.reference;
  const amountLabel = enrolment.order
    ? formatMinorAmount(enrolment.order.amountMinor, enrolment.order.currency)
    : undefined;

  return [
    {
      recipientUserId: enrolment.userId,
      email: {
        template: "enrolment-confirmed",
        params: {
          cohortTitle,
          ...(orderReference ? { orderReference } : {}),
          ...(amountLabel ? { amountLabel } : {}),
          enrolmentPath: enrolmentPath(enrolment.id),
        },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "enrolment.confirmed",
        targetType: "LEARNER_ENROLMENT",
        targetId: enrolment.id,
        params: { cohortTitle },
      },
    },
  ];
};

/**
 * Only the `illegal_transition` reason produces a learner mail (the
 * Pitfall-4 "payment received, finishing up" case, D-07/A-06). Every other
 * reason returns no intents — this mapper is deliberately silent for them,
 * leaving that territory to a later staff-facing plan.
 */
const orderExceptionLearnerMail: EventMapper = async (event, ctx) => {
  const reason = event.payload.reason;
  if (reason !== "illegal_transition") return [];

  const orderId = requireString(event.payload, "orderId");
  const order = await ctx.tx.order.findUnique({
    where: { id: orderId },
    select: {
      reference: true,
      userId: true,
      cohort: { select: { title: true } },
    },
  });
  if (!order) return [];

  return [
    {
      recipientUserId: order.userId,
      email: {
        template: "order-payment-exception",
        params: {
          cohortTitle: order.cohort.title,
          orderReference: order.reference,
          orderPath: orderPath(order.reference),
        },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "order.payment_exception",
        targetType: "LEARNER_ORDER",
        targetId: order.reference,
        params: { orderReference: order.reference },
      },
    },
  ];
};

/**
 * `payment.failed` (D-09) — written by `recordPaymentFailureAsSystem` on the
 * same transaction as the PaymentAttempt's FAILED update. Loads the order
 * fresh through `ctx.tx` (cohort title, reference, owner) — the event
 * payload carries only `orderId`/`paymentAttemptId`/`provider`, never a
 * provider failure reason (T-13-03).
 */
const paymentFailedLearnerMail: EventMapper = async (event, ctx) => {
  const orderId = requireString(event.payload, "orderId");
  const order = await ctx.tx.order.findUnique({
    where: { id: orderId },
    select: {
      reference: true,
      userId: true,
      cohort: { select: { title: true } },
    },
  });
  if (!order) return [];

  return [
    {
      recipientUserId: order.userId,
      email: {
        template: "payment-failed",
        params: {
          cohortTitle: order.cohort.title,
          orderReference: order.reference,
          orderPath: orderPath(order.reference),
        },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "payment.failed",
        targetType: "LEARNER_ORDER",
        targetId: order.reference,
        params: { orderReference: order.reference },
      },
    },
  ];
};

/**
 * `payment.refunded` (D-09) — written by `refund-service.ts` on the same
 * transaction as the Refund/Order completion writes, only for a COMPLETED or
 * RECORDED_MANUALLY status (never FAILED). Loads the Refund fresh through
 * `ctx.tx`, joined to its order/cohort/user, rather than trusting the event
 * payload's own copy of the amount — a refund reason or provider outcome
 * never reaches a persisted param (T-13-03).
 */
const paymentRefundedLearnerMail: EventMapper = async (event, ctx) => {
  const refundId = requireString(event.payload, "refundId");
  const refund = await ctx.tx.refund.findUnique({
    where: { id: refundId },
    select: {
      amountMinor: true,
      currency: true,
      order: {
        select: {
          reference: true,
          userId: true,
          cohort: { select: { title: true } },
        },
      },
    },
  });
  if (!refund) return [];

  const amountLabel = formatMinorAmount(refund.amountMinor, refund.currency);

  return [
    {
      recipientUserId: refund.order.userId,
      email: {
        template: "payment-refunded",
        params: {
          cohortTitle: refund.order.cohort.title,
          orderReference: refund.order.reference,
          amountLabel,
          orderPath: orderPath(refund.order.reference),
        },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "payment.refunded",
        targetType: "LEARNER_ORDER",
        targetId: refund.order.reference,
        params: { orderReference: refund.order.reference, amountLabel },
      },
    },
  ];
};

export function createEnrolmentPaymentMappers(): MapperGroup {
  return {
    "enrolment.activated": enrolmentConfirmed,
    "enrolment.approved": enrolmentConfirmed,
    "order.exception": orderExceptionLearnerMail,
    "payment.failed": paymentFailedLearnerMail,
    "payment.refunded": paymentRefundedLearnerMail,
  };
}
