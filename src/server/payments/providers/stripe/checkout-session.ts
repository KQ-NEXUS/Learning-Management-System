/**
 * Pure, testable builder for a Stripe Checkout Session's creation params
 * (D-01, D-03, D-04, PAY-10, PAY-17). No network call happens here — this
 * function only shapes the object `checkout-service.ts` passes to
 * `getStripe().checkout.sessions.create(...)`.
 *
 * `amountMinor` is passed straight through as `unit_amount` — it already
 * arrives in integer minor units from the Order's own D-13 snapshot, and
 * Stripe's own `unit_amount` field expects minor units too, so any
 * multiplication, division or rounding applied to it here would be a bug,
 * not a feature.
 *
 * 07-06/D-04/PAY-17 — this is a Stripe Connect DESTINATION CHARGE: the
 * learner is still charged the full `unit_amount` total on the platform
 * account, but `payment_intent_data.transfer_data` splits off a FIXED
 * transfer of the school's immutable base price to their connected account.
 * `unit_amount` and `transfer_data.amount` are deliberately different
 * values — reducing the transfer by an estimated Stripe fee would break
 * D-04's "the platform account bears Stripe's actual fee": the transfer is
 * pinned to the base price, full stop, and KQ NEXUS absorbs whatever Stripe
 * actually charges out of its own remaining share.
 *
 * `on_behalf_of` (07-01 Task 2, Decision C): deliberately NOT set here.
 * Both the KQ NEXUS Stripe platform account and this deployment's connected
 * account are registered in the United States — the same country — so
 * `on_behalf_of` is not required for this destination charge
 * (07-RESEARCH.md Pitfall 3 / Open Question 2 only requires it for a
 * cross-border platform/connected-account pair). If a future connected
 * account is onboarded from a different country, this decision must be
 * revisited explicitly — do not silently continue omitting it.
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
  /**
   * The school's immutable base price (`order.baseAmountMinor`) — the
   * Connect transfer amount. NEVER the learner's total, and never
   * recomputed or fee-adjusted here (D-04).
   */
  schoolSettlementMinor: number;
  /**
   * `settlement-config.ts`'s `stripeConnectedAccountId()` — the ONLY
   * sanctioned source of the transfer destination. No request field, query
   * parameter, or learner-facing metadata value may ever reach this
   * argument (D-02, PAY-14, T-07-10).
   */
  connectedAccountId: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    payment_method_types: ["card"], // D-03 — card only for v1, no wallet buttons
    client_reference_id: args.orderId, // the webhook's primary lookup key
    metadata: { orderId: args.orderId, enrolmentId: args.enrolmentId }, // belt-and-suspenders
    payment_intent_data: {
      // `payment_intent.payment_failed` events carry the underlying
      // PaymentIntent, not the Checkout Session — that event has no
      // `client_reference_id` of its own. Mirroring the Session-level
      // metadata onto the PaymentIntent (06-06) is what lets the webhook
      // correlate a failed intent back to this Order without a second,
      // OPT-OUT-scoped `checkout.sessions.list` lookup (COVERAGE.md).
      metadata: { orderId: args.orderId, enrolmentId: args.enrolmentId },
      // D-04/PAY-17 — the destination-charge split. `amount` is the
      // school's base-price snapshot (never the learner total, never fee-
      // adjusted); `destination` comes only from deployment configuration,
      // never a request field (D-02, T-07-10).
      transfer_data: {
        destination: args.connectedAccountId,
        amount: args.schoolSettlementMinor,
      },
    },
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
