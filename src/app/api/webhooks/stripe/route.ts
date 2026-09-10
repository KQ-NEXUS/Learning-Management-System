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
  }
  // Other event types (e.g. checkout.session.expired) fall through to 200 in
  // this plan; plan 06-06 adds their handlers.

  // Every processed, duplicate and exception outcome returns 200 — retrying
  // will not change any of them, and leaving an event unacknowledged just
  // buys three days of pointless Stripe retry traffic.
  return new Response(null, { status: 200 });
}
