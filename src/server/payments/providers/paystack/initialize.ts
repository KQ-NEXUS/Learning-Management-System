/**
 * Builds and sends a Paystack split Initialize Transaction request (D-02,
 * D-03, PAY-17).
 *
 * `buildInitializeTransactionRequest` mirrors
 * `providers/stripe/checkout-session.ts`'s `buildCheckoutSessionParams`
 * shape exactly: a pure, dependency-free (beyond `settlement-config.ts`)
 * builder that performs no network call, taking flat named arguments rather
 * than a generic snapshot object, so its output can be asserted against the
 * D-25 worked example without a fetch mock.
 *
 * `bearer: "account"` is passed explicitly rather than relied on as
 * Paystack's own default (D-03, 07-RESEARCH.md) — an explicit value survives
 * a future change to Paystack's own default unchanged. `currency: "NGN"` is
 * likewise always explicit (D-07 defense in depth) — Paystack's integration
 * default is never trusted.
 */

import { paystackSubaccountCode } from "@/server/payments/settlement-config";
import { initializeTransaction } from "@/server/payments/providers/paystack/client";

/** Refused before any network call — `initiatePaystackTransaction` never sends a non-NGN request. */
export class NonNgnPaystackInitiationError extends Error {
  readonly currency: string;

  constructor(currency: string) {
    super(`Paystack initiation refused for currency ${JSON.stringify(currency)} — only NGN is supported.`);
    this.name = "NonNgnPaystackInitiationError";
    this.currency = currency;
  }
}

export type PaystackInitiationInput = {
  orderId: string;
  orderReference: string;
  enrolmentId: string;
  learnerEmail: string;
  /** Checked against `"NGN"` before any network call — not narrowed to a
   *  literal type here so a caller's already-validated `SupportedCurrency`
   *  passes straight through without a cast. */
  currency: string;
  /** The learner's total charge (D-13) — Paystack's own `amount` field. */
  amountMinor: number;
  platformFeeMinor: number;
  gatewayFeeEstimateMinor: number;
  callbackUrl: string;
};

/**
 * Pure request-shape builder — no network call. `transaction_charge` is
 * `platformFeeMinor + gatewayFeeEstimateMinor` (D-03): Paystack deducts this
 * flat amount from KQ's own allocation (`bearer: "account"`), leaving the
 * subaccount (the school) the base price untouched.
 */
export function buildInitializeTransactionRequest(input: PaystackInitiationInput): Record<string, unknown> {
  return {
    email: input.learnerEmail,
    amount: input.amountMinor,
    currency: "NGN",
    reference: input.orderReference,
    subaccount: paystackSubaccountCode(),
    transaction_charge: input.platformFeeMinor + input.gatewayFeeEstimateMinor,
    bearer: "account",
    callback_url: input.callbackUrl,
    metadata: { orderId: input.orderId, enrolmentId: input.enrolmentId },
  };
}

/**
 * Refuses a non-NGN input before any network call (D-07 defense in depth —
 * `providerForCurrency` already guarantees this is never reached for USD in
 * production, but this adapter does not trust its caller), then POSTs the
 * built request and returns the provider-neutral
 * `{ redirectUrl, providerIntentId }` shape `payment-provider.ts` declares.
 */
export async function initiatePaystackTransaction(
  input: PaystackInitiationInput,
): Promise<{ redirectUrl: string; providerIntentId: string }> {
  if (input.currency !== "NGN") {
    throw new NonNgnPaystackInitiationError(input.currency);
  }

  const body = buildInitializeTransactionRequest(input);
  const data = await initializeTransaction(body);

  return { redirectUrl: data.authorization_url, providerIntentId: data.reference };
}
