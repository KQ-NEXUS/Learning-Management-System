/**
 * Stripe webhook receiver — the ONLY writer of `Order.status = "PAID"`
 * (PAY-10). The `success_url` redirect a learner's browser follows back from
 * Stripe never marks anything paid; only a signature-verified event reaching
 * this route does.
 *
 * Order of operations is load-bearing: the raw body is read as text FIRST
 * and never re-parsed as structured JSON anywhere in this file — signature
 * verification recomputes the HMAC over the exact bytes Stripe sent, and any
 * re-parse breaks it with a misleading "no signatures found" error on
 * completely legitimate traffic.
 *
 * This file imports no Prisma client type — it calls the webhook system
 * service, exactly like every other route in this codebase calls a service.
 */

import type Stripe from "stripe";
import { verifyStripeWebhook, StripeSignatureError } from "@/server/payments/providers/stripe/webhook";
import {
  recordWebhookEventOrSkip,
  activateOrderAsSystem,
  recordPaymentFailureAsSystem,
  recordSessionExpiredAsSystem,
} from "@/server/services/checkout-webhook-system-service";

export async function POST(req: Request): Promise<Response> {
  const body = await req.text(); // RAW bytes — no other body-read call anywhere in this file
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    // Misconfiguration, not an attacker — distinct from an invalid signature.
    return new Response(null, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(body, signature, secret);
  } catch (err) {
    if (err instanceof StripeSignatureError) {
      return new Response(null, { status: 400 }); // PAY-10 — zero writes past this point
    }
    throw err;
  }

  const { isNew } = await recordWebhookEventOrSkip({
    provider: "STRIPE",
    providerEventId: event.id,
    eventType: event.type,
    payload: event as unknown as Record<string, unknown>,
  });
  if (!isNew) {
    // Already recorded (redelivery or a concurrent duplicate) — no reprocessing.
    return new Response(null, { status: 200 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.client_reference_id;
    if (orderId) {
      await activateOrderAsSystem({
        orderId,
        providerIntentId: session.id,
        amountMinor: session.amount_total ?? 0,
        currency: session.currency ?? "ngn",
        eventId: event.id,
      });
    }
  } else if (event.type === "checkout.session.expired") {
    // PAY-02 bookkeeping only — D-04's inline retry is handled entirely on
    // Stripe's own hosted page; this event fires only once the Session
    // itself is truly gone (Stripe's own timeout, not a decline).
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.client_reference_id;
    if (orderId) {
      await recordSessionExpiredAsSystem({
        orderId,
        providerIntentId: session.id,
        eventId: event.id,
      });
    }
  } else if (event.type === "payment_intent.payment_failed") {
    // PAY-02 bookkeeping only. A PaymentIntent carries no
    // `client_reference_id` of its own (that is a Checkout-Session-only
    // field) — correlation relies on the `orderId` mirrored into
    // `payment_intent_data.metadata` at Session-creation time
    // (`checkout-session.ts`), not on `providerIntentId` matching.
    const intent = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata?.orderId;
    if (orderId) {
      await recordPaymentFailureAsSystem({
        orderId,
        eventId: event.id,
        failureReason: intent.last_payment_error?.message ?? "Stripe reported a payment failure.",
      });
    }
  }
  // Every other event type falls through to 200 below without processing —
  // its WebhookEvent row (already written by recordWebhookEventOrSkip above)
  // is what makes an unexpected delivery visible rather than invisible.

  // Every processed, duplicate and exception outcome returns 200 — retrying
  // will not change any of them, and leaving an event unacknowledged just
  // buys three days of pointless Stripe retry traffic.
  return new Response(null, { status: 200 });
}
