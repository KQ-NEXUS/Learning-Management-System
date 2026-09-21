/**
 * The Stripe SDK singleton (PAY-09).
 *
 * This is the ONLY module in the codebase permitted to construct the Stripe
 * SDK client (`new Stripe(...)`). Provider-specific code stays inside
 * `src/server/payments/providers/stripe/` — every other Stripe call site
 * (Checkout Session creation, webhook verification, and any future Refund
 * work) imports `getStripe()` from here rather than constructing its own
 * client. `tests/*` and CI grep-assert this stays true.
 *
 * `STRIPE_SECRET_KEY` is read from `process.env` at CALL time inside
 * `getStripe()`, never at module/import time — mirroring
 * `src/server/email/brevo-client.ts`'s established shape. The Docker builder
 * runs `next build` with no secrets present; an import-time throw here would
 * break the build the same way `dynamic = "force-dynamic"` exists to prevent
 * elsewhere in the app. Neither `STRIPE_SECRET_KEY` nor `STRIPE_WEBHOOK_SECRET`
 * is ever returned, logged, or placed in an audit/domain-event payload
 * (PAY-14) — this module has no logging of its own and callers must uphold
 * the same discipline.
 */

import Stripe from "stripe";

/**
 * The exact Stripe API version this SDK release (`stripe@22.6.1`) declares as
 * current (`node_modules/stripe/cjs/apiVersion.d.ts`). Passed explicitly to
 * the constructor so a later SDK bump cannot silently change the event
 * payload shapes the webhook route parses.
 */
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-08-26.dahlia";

/** Thrown by `getStripe()` when `STRIPE_SECRET_KEY` is absent or empty. */
export class StripeNotConfiguredError extends Error {
  constructor() {
    super("STRIPE_SECRET_KEY is not set.");
    this.name = "StripeNotConfiguredError";
  }
}

let cachedClient: Stripe | null = null;

/**
 * Lazy memoised Stripe singleton. Construction MUST NOT happen at module
 * scope (see file header) — the first call after a process start reads
 * `process.env.STRIPE_SECRET_KEY`, throws `StripeNotConfiguredError` when it
 * is absent or empty, otherwise constructs the client once and returns the
 * same instance on every subsequent call.
 */
export function getStripe(): Stripe {
  if (cachedClient) return cachedClient;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new StripeNotConfiguredError();
  }

  cachedClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  return cachedClient;
}

/**
 * Convenience accessor mirroring `stripe.<resource>.<method>()` call sites in
 * documentation — resolves to the same lazy singleton as `getStripe()`. Never
 * accessed at import time (each property access calls `getStripe()` fresh),
 * so importing this module with `STRIPE_SECRET_KEY` unset never throws.
 */
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, property, receiver) {
    return Reflect.get(getStripe(), property, receiver);
  },
});

/**
 * Thrown by `fetchActualSettlement` when a figure it needs is not yet
 * resolvable from Stripe's own API — a charge not yet created, a balance
 * transaction not yet settled, or (for a destination charge) a transfer not
 * yet created. Never a partial or zero-filled result (D-14) — the caller
 * (the reconciliation sweep) must treat this as "not yet available" and
 * leave the row untouched for the next scheduled invocation.
 */
export class StripeActualSettlementUnavailableError extends Error {
  constructor(paymentIntentId: string, reason: string) {
    super(`Stripe actual settlement not yet available for PaymentIntent ${paymentIntentId}: ${reason}`);
    this.name = "StripeActualSettlementUnavailableError";
  }
}

/**
 * 07-07 — resolves the actual settlement figures for a completed Stripe
 * Connect destination charge (07-06), read directly from Stripe's own API —
 * never the webhook event body. One `retrieve` call, expanding the
 * PaymentIntent's latest charge plus that charge's balance transaction (for
 * Stripe's own actual processing fee) and its transfer (for the amount
 * actually moved to the connected account), so no second round trip is
 * needed. Narrowed into the provider-neutral `ActualSettlement` shape
 * `payment-reconciliation-service.ts` consumes — no Stripe SDK type crosses
 * out of this directory (PAY-09).
 */
export async function fetchActualSettlement(paymentIntentId: string): Promise<{
  gatewayFeeActualMinor: number;
  schoolSettlementActualMinor: number;
  platformGrossActualMinor: number;
}> {
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction", "latest_charge.transfer"],
  });

  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  if (!charge) {
    throw new StripeActualSettlementUnavailableError(paymentIntentId, "no charge exists on this PaymentIntent yet");
  }

  const balanceTransaction =
    typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
  if (!balanceTransaction) {
    throw new StripeActualSettlementUnavailableError(paymentIntentId, "the charge's balance transaction has not settled yet");
  }

  const transfer = typeof charge.transfer === "object" ? charge.transfer : null;
  if (!transfer) {
    throw new StripeActualSettlementUnavailableError(
      paymentIntentId,
      "the transfer to the connected account has not been created yet",
    );
  }

  const gatewayFeeActualMinor = balanceTransaction.fee;
  const schoolSettlementActualMinor = transfer.amount;

  return {
    gatewayFeeActualMinor,
    schoolSettlementActualMinor,
    platformGrossActualMinor: charge.amount - schoolSettlementActualMinor,
  };
}
