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
