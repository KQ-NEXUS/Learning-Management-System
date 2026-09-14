/**
 * Stripe refund adapter (PAY-05, PAY-13, PAY-09) — refunds the original
 * destination charge's PaymentIntent.
 *
 * 07-01's locked Decision A: `reverse_transfer` is passed EXPLICITLY on every
 * call this module makes — `true` for a full refund, `false` for a partial
 * one (never omitted, even when the value would match Stripe's own default).
 * COVERAGE.md records this capability as INTEGRATE precisely so the choice is
 * a recorded decision, not an accident of Stripe's implicit default —
 * `buildStripeRefundRequest` is a pure function specifically so a test can
 * read the built request object and assert the flag is present, rather than
 * trusting a comment.
 */

import type Stripe from "stripe";
import { getStripe } from "@/server/payments/providers/stripe/client";

/** The narrow subset of Stripe's Refund response this codebase reads. */
export type StripeRefundOutcome = {
  id: string;
  status: string;
  amount: number;
  currency: string;
};

/**
 * Pure — no network call. `amountMinor` omitted means a full refund of the
 * PaymentIntent's captured amount (Stripe's own "refund everything" shape).
 * `reverseTransfer` is REQUIRED (not optional) on this input on purpose —
 * there is no default here that would let a future call site forget it.
 */
export function buildStripeRefundRequest(args: {
  paymentIntentId: string;
  amountMinor?: number;
  reverseTransfer: boolean;
  reason: string;
}): Stripe.RefundCreateParams {
  return {
    payment_intent: args.paymentIntentId,
    ...(args.amountMinor !== undefined ? { amount: args.amountMinor } : {}),
    // 07-01 Decision A — explicit on every call, full stop.
    reverse_transfer: args.reverseTransfer,
    metadata: { reason: args.reason },
  };
}

/**
 * `stripe.refunds.create(params)` — `params` is built by
 * `buildStripeRefundRequest`, above; this function performs no shaping of
 * its own.
 */
export async function refundStripeCharge(params: Stripe.RefundCreateParams): Promise<StripeRefundOutcome> {
  const refund = await getStripe().refunds.create(params);
  return {
    id: refund.id,
    status: refund.status ?? "unknown",
    amount: refund.amount,
    currency: refund.currency,
  };
}
