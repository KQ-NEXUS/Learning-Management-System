/**
 * Order states that must never accept a new manual-payment confirmation.
 *
 * Refunded orders are still historically paid orders. EXCEPTION is also
 * fail-closed because it can represent provider-reported money movement that
 * requires review rather than a second payment attempt.
 */
const MANUAL_CONFIRMATION_BLOCKED_STATUSES = new Set([
  "PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "EXCEPTION",
]);

export function isManualPaymentConfirmationBlocked(status: string): boolean {
  return MANUAL_CONFIRMATION_BLOCKED_STATUSES.has(status);
}

/**
 * F-16 — orders whose money has already settled. A late, duplicate or
 * mismatched provider settlement must never downgrade one of these to
 * EXCEPTION: the learner-visible order stays as it is, and the extra money is
 * flagged on its own PaymentAttempt and an `order.exception` event for
 * reconciliation instead.
 */
const SETTLED_ORDER_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);

export function isSettledOrderStatus(status: string): boolean {
  return SETTLED_ORDER_STATUSES.has(status);
}
