/**
 * Pure, testable builder for a Stripe Checkout Session's creation params
 * (D-01, D-03, PAY-10). No network call happens here — this function only
 * shapes the object `checkout-service.ts` passes to
 * `getStripe().checkout.sessions.create(...)`.
 *
 * `amountMinor` is passed straight through as `unit_amount` — it already
 * arrives in integer minor units from the `Cohort` row, and Stripe's own
 * `unit_amount` field expects minor units too, so any multiplication,
 * division or rounding applied to it here would be a bug, not a feature.
 *
 * Deliberately does NOT attach a Stripe customer, does NOT opt the session
 * into remembering the card for a later charge, and does NOT enable discount
 * codes — none of those are part of the v1 checkout flow (D-01, D-03), and
 * the middle one specifically is what PAY-10 forbids: no card may ever be
 * saved or reused without the learner completing a fresh session each time.
 */

import type Stripe from "stripe";

export function buildCheckoutSessionParams(args: {
  orderId: string;
  enrolmentId: string;
  cohortTitle: string;
  amountMinor: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    payment_method_types: ["card"], // D-03 — card only for v1, no wallet buttons
    client_reference_id: args.orderId, // the webhook's primary lookup key
    metadata: { orderId: args.orderId, enrolmentId: args.enrolmentId }, // belt-and-suspenders
    // `payment_intent.payment_failed` events carry the underlying
    // PaymentIntent, not the Checkout Session — that event has no
    // `client_reference_id` of its own. Mirroring the Session-level
    // metadata onto the PaymentIntent (06-06) is what lets the webhook
    // correlate a failed intent back to this Order without a second,
    // OPT-OUT-scoped `checkout.sessions.list` lookup (COVERAGE.md).
    payment_intent_data: { metadata: { orderId: args.orderId, enrolmentId: args.enrolmentId } },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: args.currency.toLowerCase(), // Stripe expects a lowercase ISO code
          unit_amount: args.amountMinor, // already minor units — no conversion, ever
          product_data: { name: args.cohortTitle },
        },
      },
    ],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
  };
}
