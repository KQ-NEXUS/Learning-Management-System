/**
 * Paystack webhook signature verification — HMAC-SHA512, not Stripe's
 * SHA-256-based scheme (07-RESEARCH.md, `github.com/PaystackHQ/documentation`
 * webhooks docs). Mirrors `providers/stripe/webhook.ts`'s raw-body-first,
 * typed-error, never-`===`-compare discipline exactly.
 *
 * The caller (the webhook route) must hand this function the untouched
 * request body read via `req.text()` — never a re-parsed/re-serialized one —
 * because the signature is computed over the exact raw bytes Paystack sent.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Thrown when the signature header is missing, or verification fails. */
export class PaystackSignatureError extends Error {
  constructor(message = "Paystack webhook signature verification failed.") {
    super(message);
    this.name = "PaystackSignatureError";
  }
}

/**
 * Verifies `rawBody` against the `x-paystack-signature` header value using
 * `secret` (the account's Paystack secret key — Paystack signs webhooks with
 * the same key used for API requests, `paystackWebhookSecretKey()`), then
 * parses and returns the JSON body. `crypto.timingSafeEqual` — never `===` —
 * compares the computed and received signatures, after a length check
 * (`timingSafeEqual` throws on a length mismatch rather than returning
 * `false`).
 */
export function verifyPaystackWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
): unknown {
  if (!signatureHeader || !secret) {
    throw new PaystackSignatureError();
  }

  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");

  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new PaystackSignatureError();
  }

  return JSON.parse(rawBody);
}
