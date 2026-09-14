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

import {
  verifyStripeWebhook,
  StripeSignatureError,
} from "@/server/payments/providers/stripe/webhook";
import {
  recordWebhookEventOrSkip,
  markWebhookEventRetryable,
  activateOrderAsSystem,
  recordPaymentFailureAsSystem,
  recordSessionExpiredAsSystem,
} from "@/server/services/checkout-webhook-system-service";
import { stripeConnectedAccountId } from "@/server/payments/settlement-config";

/**
 * Structural shapes for the exact fields this route reads off a verified
 * Stripe event — deliberately NOT the SDK's own `Stripe.Event` /
 * `Stripe.Checkout.Session` / `Stripe.PaymentIntent` types (PAY-09). This
 * file lives outside `src/server/payments/providers/stripe/`, so naming a
 * Stripe-namespaced type here — even for read-only field access — would put
 * it on the offending side of tests/checkout-phase-invariants.test.ts's
 * provider-isolation scan. `verifyStripeWebhook` still returns the SDK's own
 * typed event internally; this route only ever holds it through this
 * narrower, provider-agnostic shape.
 */
type VerifiedWebhookEvent = {
  id: string;
  type: string;
  data: { object: unknown };
};

/**
 * 07-06 — the shape `session.payment_intent` arrives in: a bare id string by
 * default, or an expanded object when this deployment's webhook endpoint is
 * configured (Stripe dashboard/API, outside this codebase) to expand
 * `data.object.payment_intent` and `data.object.payment_intent.latest_charge`.
 * Deliberately NOT any Stripe SDK type (PAY-09) — this route lives outside
 * `src/server/payments/providers/stripe/`.
 */
type PaymentIntentSettlementFacts = {
  id?: string;
  latest_charge?:
    string | { id?: string; transfer?: string | { id?: string } | null } | null;
};

type CheckoutSessionFacts = {
  id: string;
  client_reference_id: string | null;
  amount_total: number | null;
  currency: string | null;
  payment_intent?: string | PaymentIntentSettlementFacts | null;
};

type PaymentIntentFacts = {
  metadata?: { orderId?: string } | null;
  last_payment_error?: { message?: string } | null;
};

/**
 * 07-06/07-07 — narrows whatever `session.payment_intent` carries into the
 * four correlation identifiers a later reconciliation sweep will need to
 * look up the real Stripe fee: the PaymentIntent id, the latest charge id,
 * the transfer id, and the transfer destination. Fields the delivered event
 * does not carry (no expansion configured) are `null`, never fabricated —
 * D-14's "expected and actual are never conflated" discipline applies here
 * too: a null chargeId/transferId honestly means "no expanded evidence in
 * this delivery," not a guess.
 *
 * `transferDestination` is read from `settlement-config.ts`, never from the
 * event payload — every USD Checkout Session this deployment creates
 * carries the SAME configured destination (D-02), so this only records what
 * the deployment was configured to expect, exactly like `checkout-session.ts`
 * sources it at Session-creation time.
 */
function buildStripeSettlementEvidence(session: CheckoutSessionFacts): {
  paymentIntentId: string | null;
  chargeId: string | null;
  transferId: string | null;
  transferDestination: string | null;
} {
  const pi = session.payment_intent;
  const paymentIntentId = typeof pi === "string" ? pi : (pi?.id ?? null);

  const latestCharge =
    typeof pi === "object" && pi !== null ? pi.latest_charge : undefined;
  const chargeId =
    typeof latestCharge === "string"
      ? latestCharge
      : (latestCharge?.id ?? null);

  const transfer =
    typeof latestCharge === "object" && latestCharge !== null
      ? latestCharge.transfer
      : undefined;
  const transferId =
    typeof transfer === "string" ? transfer : (transfer?.id ?? null);

  let transferDestination: string | null = null;
  try {
    transferDestination = stripeConnectedAccountId();
  } catch {
    // D-05 already fails checkout closed before a Session can exist without
    // a configured connected account — reachable only if this deployment's
    // env changed AFTER the Session that produced this event was created.
    transferDestination = null;
  }

  return { paymentIntentId, chargeId, transferId, transferDestination };
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text(); // RAW bytes — no other body-read call anywhere in this file
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    // Misconfiguration, not an attacker — distinct from an invalid signature.
    return new Response(null, { status: 500 });
  }

  let event: VerifiedWebhookEvent;
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

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as CheckoutSessionFacts;
      const orderId = session.client_reference_id;
      if (orderId) {
        await activateOrderAsSystem({
          orderId,
          provider: "STRIPE",
          providerIntentId: session.id,
          amountMinor: session.amount_total ?? 0,
          currency: session.currency ?? "ngn",
          eventId: event.id,
          // 07-06/07-07 — correlation identifiers for the later reconciliation
          // sweep; never the four "actual settlement" columns themselves (D-14).
          settlementEvidence: buildStripeSettlementEvidence(session),
        });
      }
    } else if (event.type === "checkout.session.expired") {
      // PAY-02 bookkeeping only — D-04's inline retry is handled entirely on
      // Stripe's own hosted page; this event fires only once the Session
      // itself is truly gone (Stripe's own timeout, not a decline).
      const session = event.data.object as CheckoutSessionFacts;
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
      const intent = event.data.object as PaymentIntentFacts;
      const orderId = intent.metadata?.orderId;
      if (orderId) {
        await recordPaymentFailureAsSystem({
          orderId,
          eventId: event.id,
          failureReason:
            intent.last_payment_error?.message ??
            "Stripe reported a payment failure.",
        });
      }
    }
  } catch (err) {
    await markWebhookEventRetryable({
      provider: "STRIPE",
      providerEventId: event.id,
    });
    throw err;
  }
  // Every other event type falls through to 200 below without processing —
  // its WebhookEvent row (already written by recordWebhookEventOrSkip above)
  // is what makes an unexpected delivery visible rather than invisible.

  // Every processed, duplicate and exception outcome returns 200 — retrying
  // will not change any of them, and leaving an event unacknowledged just
  // buys three days of pointless Stripe retry traffic.
  return new Response(null, { status: 200 });
}
