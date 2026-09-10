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
