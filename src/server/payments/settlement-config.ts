/**
 * The single server-side reader for provider secrets and school settlement
 * identifiers (D-02, PAY-14).
 *
 * Every value here is read from `process.env` lazily, inside each accessor,
 * never at module/import time — mirroring
 * `src/server/payments/providers/stripe/client.ts`'s established shape, so
 * importing this module during `next build` (no secrets present) never
 * throws.
 *
 * This module imports nothing from `stripe`, `@prisma/client`, or any path
 * under `src/server/payments/providers/` — it sits ABOVE both provider
 * directories and is imported by both, so any provider-namespaced import
 * here would break the PAY-09 isolation scan the moment a later plan
 * generalizes it to cover Paystack.
 *
 * `on_behalf_of` (07-01 Task 2, Decision C): the KQ NEXUS platform account
 * and the deployment's Stripe connected account are both registered in the
 * United States — the same country — so `payment_intent_data.on_behalf_of`
 * is NOT required on the Connect destination charge (07-RESEARCH.md
 * Pitfall 3 / Open Question 2 only requires it for cross-border pairs).
 */

/** Thrown when a required provider secret or school settlement identifier is absent or blank. */
export class MissingSettlementAccountError extends Error {
  constructor(variableName: string) {
    super(`${variableName} is not set in this deployment's environment. Checkout fails closed instead of settling to an unconfigured account — see deployment configuration.`);
    this.name = "MissingSettlementAccountError";
  }
}

function readRequired(variableName: string): string {
  const raw = process.env[variableName];
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new MissingSettlementAccountError(variableName);
  }
  return trimmed;
}

/** The KQ NEXUS Paystack main-account test/live secret key. */
export function paystackSecretKey(): string {
  return readRequired("PAYSTACK_SECRET_KEY");
}

/**
 * Paystack signs webhook payloads with the same secret key used to
 * authenticate API requests — there is no separate webhook-signing secret to
 * configure, so this aliases `paystackSecretKey()` rather than introducing a
 * second environment variable.
 */
export function paystackWebhookSecretKey(): string {
  return paystackSecretKey();
}

/** This deployment's one school's Paystack subaccount code (D-02, D-03, D-05). */
export function paystackSubaccountCode(): string {
  return readRequired("PAYSTACK_SUBACCOUNT_CODE");
}

/** This deployment's one school's Stripe Connect connected account id (D-02, D-04, D-05). */
export function stripeConnectedAccountId(): string {
  return readRequired("STRIPE_CONNECTED_ACCOUNT_ID");
}

/**
 * True when this deployment's Paystack subaccount identifier is configured
 * (D-02/D-05) — the NGN online rail is enabled for this deployment. Unlike
 * `paystackSubaccountCode()`, this is a presence check only and never throws;
 * it exists so a caller (Cohort readiness, D-08) can ask "is this rail
 * enabled at all" without needing to catch `MissingSettlementAccountError`.
 */
export function isPaystackRailEnabled(): boolean {
  return Boolean(process.env.PAYSTACK_SUBACCOUNT_CODE?.trim());
}

/** Same presence-check contract as `isPaystackRailEnabled`, for the USD/Stripe rail (D-02/D-05). */
export function isStripeRailEnabled(): boolean {
  return Boolean(process.env.STRIPE_CONNECTED_ACCOUNT_ID?.trim());
}
