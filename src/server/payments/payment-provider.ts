/**
 * The provider-neutral payment-initiation seam (PAY-09).
 *
 * `checkout-service.ts` depends on this interface's shapes — never on a
 * concrete provider adapter's own request/response types — for the same
 * reason it already depends on `pricing.ts`/`routing.ts` rather than on a
 * Prisma or Stripe/Paystack type: a module outside a provider's own
 * `providers/<name>/` directory that named that provider's SDK/response type
 * would fail the generalized provider-isolation scan
 * (`tests/checkout-phase-invariants.test.ts`) for BOTH providers at once,
 * since this file is imported by both `checkout-service.ts` and (indirectly,
 * through satisfying the shape) every adapter.
 *
 * This module imports no provider SDK and no Prisma type — it only imports
 * `SupportedCurrency` from `routing.ts`, itself a dependency-free module.
 */

import type { SupportedCurrency } from "@/server/payments/routing";

/**
 * The commercial facts a provider adapter needs to initiate a payment,
 * snapshotted once at Order creation (D-13) and never recomputed at
 * initiation time — an adapter reads this, it never derives its own amount,
 * fee, or provider choice.
 */
export type OrderCommercialSnapshot = {
  orderId: string;
  /** The permanent, publicly-shown order reference (D-16/D-17) — the value a
   *  provider's own `reference` field should carry, mirroring Stripe's
   *  `client_reference_id` correlation pattern. */
  orderReference: string;
  enrolmentId: string;
  cohortTitle: string;
  learnerEmail: string;
  currency: SupportedCurrency;
  provider: "PAYSTACK" | "STRIPE";
  /** The administrator-entered base price (D-06) — never the learner total. */
  baseAmountMinor: number;
  /** KQ NEXUS's 1.5% platform fee, computed from the base (D-10). */
  platformFeeMinor: number;
  /** The estimated gateway gross-up (D-12). */
  gatewayFeeEstimateMinor: number;
  /** The learner's total charge — base + platform fee + gateway estimate (D-13). */
  amountMinor: number;
  /** The base price the school is expected to receive net of the split (D-03/D-04). */
  schoolSettlementExpectedMinor: number;
};

export type PaymentInitiationUrls = {
  /** Where the learner's browser returns after a completed (or abandoned) payment. */
  callbackUrl: string;
};

export type PaymentInitiationResult = {
  /** The provider-hosted page the learner's browser is redirected to. */
  redirectUrl: string;
  /** The provider's own correlation id for this attempt — stored as
   *  `PaymentAttempt.providerIntentId`. */
  providerIntentId: string;
};

/**
 * The interface every provider adapter's initiation entry point satisfies.
 * Neither `providers/stripe/` nor `providers/paystack/` needs to literally
 * implement this as a class — a plain function with this call shape
 * satisfies it structurally, exactly like every other structural contract in
 * this codebase (`SeatTxClient`, `DomainEventTxClient`).
 */
export interface PaymentProviderAdapter {
  initiate(
    snapshot: OrderCommercialSnapshot,
    urls: PaymentInitiationUrls,
  ): Promise<PaymentInitiationResult>;
}
