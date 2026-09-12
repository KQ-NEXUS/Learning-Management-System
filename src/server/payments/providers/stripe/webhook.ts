/**
 * The ONLY signature-verification call site in the repository (PAY-10).
 *
 * A hand-rolled comparison against the `Stripe-Signature` header would get
 * the timing-safe compare, the timestamp-tolerance window and the versioned
 * `v1=`/`v0=` signature scheme wrong — this thin wrapper delegates all three
 * to the SDK's own verification call below, which recomputes its HMAC over
 * the exact raw bytes Stripe sent. That is why the caller (the webhook
 * route) must hand this function the untouched request body — never a
 * re-parsed/re-serialized one.
 */

import type Stripe from "stripe";
import { getStripe } from "@/server/payments/providers/stripe/client";

/** Thrown when the signature is missing, malformed, or fails verification. */
export class StripeSignatureError extends Error {
  constructor(message = "Stripe webhook signature verification failed.") {
    super(message);
    this.name = "StripeSignatureError";
  }
}

/**
 * Verifies `rawBody` against `signature` using `secret`, returning the typed
 * Stripe event on success. Never interpolates the underlying SDK error into
 * the thrown message or a log line — a Stripe SDK error can echo request
 * parameters back, the same discipline `brevo-client.ts`'s
 * `describeBrevoFailure` already applies to a different provider's errors.
 */
export function verifyStripeWebhook(
  rawBody: string,
  signature: string | null,
  secret: string | undefined,
): Stripe.Event {
  if (!signature || !secret) {
    throw new StripeSignatureError();
  }

  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new StripeSignatureError();
  }
}
