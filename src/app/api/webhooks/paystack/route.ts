/**
 * Paystack webhook receiver — mirrors `src/app/api/webhooks/stripe/route.ts`'s
 * raw-body-first, verify-then-record-then-settle control flow exactly. This
 * route never writes `Order.status = "PAID"` itself (PAY-10) — it calls the
 * one shared settlement service, exactly like the Stripe route does.
 *
 * The raw body is read as text FIRST and never re-parsed as structured JSON
 * anywhere in this file before signature verification — `verifyPaystackWebhook`
 * recomputes the HMAC over the exact bytes Paystack sent.
 *
 * Declares its own narrow local `VerifiedPaystackEvent` shape rather than
 * importing a Paystack-namespaced type from `providers/paystack/` — this
 * file lives outside that directory, so importing a Paystack-specific type
 * here would put it on the offending side of
 * `tests/checkout-phase-invariants.test.ts`'s generalized provider-isolation
 * scan (PAY-09).
 *
 * The correlation id this route reads is `data.metadata.orderId` — the same
 * value `buildInitializeTransactionRequest` mirrors into the Initialize
 * Transaction request's `metadata`, exactly like the Stripe route correlates
 * a `payment_intent.payment_failed` event through
 * `payment_intent_data.metadata.orderId` rather than through a Checkout
 * Session id that event type does not carry.
 *
 * PAY-07/07-RESEARCH.md Pitfall 1 — after signature verification and
 * idempotency recording, this route independently calls Paystack's Verify
 * Transaction endpoint and settles ONLY when the verified payload's NESTED
 * `data.status` reads `"success"`. The delivered webhook event's own
 * top-level fields are never trusted as the settlement decision on their
 * own — a signature-valid event only proves Paystack sent it, not that the
 * transaction inside it actually succeeded (a `charge.success` event with a
 * stale/replayed body is still just bytes until Verify Transaction confirms
 * it). Every outcome the shared settlement service can resolve — settled,
 * duplicate, exception, no-matching-order, non-success — returns 200, so
 * Paystack stops retrying a payload this application has already decided
 * about. Non-2xx is reserved for signature failure (400) and a genuinely
 * unhandled error (500, via an uncaught throw).
 */

import {
  verifyPaystackWebhook,
  PaystackSignatureError,
} from "@/server/payments/providers/paystack/webhook";
import { verifyTransaction } from "@/server/payments/providers/paystack/client";
import { paystackWebhookSecretKey } from "@/server/payments/settlement-config";
import {
  recordWebhookEventOrSkip,
  markWebhookEventRetryable,
  activateOrderAsSystem,
} from "@/server/services/checkout-webhook-system-service";

type VerifiedPaystackEvent = {
  event: string;
  data: {
    id: number;
    reference: string;
    status: string;
    amount: number;
    currency: string;
    metadata?: { orderId?: string; enrolmentId?: string } | null;
  };
};

export async function POST(req: Request): Promise<Response> {
  const body = await req.text(); // RAW bytes — no other body-read call anywhere in this file

  let secret: string;
  try {
    secret = paystackWebhookSecretKey();
  } catch {
    // Misconfiguration, not an attacker — distinct from an invalid signature.
    return new Response(null, { status: 500 });
  }

  const signature = req.headers.get("x-paystack-signature");

  let event: VerifiedPaystackEvent;
  try {
    event = verifyPaystackWebhook(
      body,
      signature,
      secret,
    ) as VerifiedPaystackEvent;
  } catch (err) {
    if (err instanceof PaystackSignatureError) {
      return new Response(null, { status: 400 }); // PAY-10 — zero writes past this point
    }
    throw err;
  }

  const providerEventId = String(event.data.id);

  const { isNew } = await recordWebhookEventOrSkip({
    provider: "PAYSTACK",
    providerEventId,
    eventType: event.event,
    payload: event as unknown as Record<string, unknown>,
  });
  if (!isNew) {
    // Already recorded (redelivery or a concurrent duplicate) — no
    // reprocessing, and the existing row's PROCESSED status (if it already
    // settled) is left exactly as it is.
    return new Response(null, { status: 200 });
  }

  try {
    const orderId = event.data.metadata?.orderId;

    // Independent Verify Transaction call BEFORE settling (Pitfall 1) — reads
    // the NESTED transaction status, never the delivered event's own fields.
    const verified = await verifyTransaction(event.data.reference);

    if (orderId && verified.status === "success") {
      await activateOrderAsSystem({
        orderId,
        provider: "PAYSTACK",
        providerIntentId: verified.reference,
        amountMinor: verified.amount,
        currency: verified.currency,
        eventId: providerEventId,
      });
    }
  } catch (err) {
    await markWebhookEventRetryable({ provider: "PAYSTACK", providerEventId });
    throw err;
  }
  // Every other outcome (no correlatable orderId, or a verified status other
  // than "success") falls through to 200 below without settling anything —
  // its WebhookEvent row (already written by recordWebhookEventOrSkip above)
  // is what makes an unexpected delivery visible rather than invisible.

  // Every processed and unresolved outcome returns 200 — retrying will not
  // change any of them, and leaving an event unacknowledged just buys three
  // days of pointless Paystack retry traffic.
  return new Response(null, { status: 200 });
}
