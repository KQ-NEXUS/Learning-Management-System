/**
 * Real-Postgres proof for the Stripe checkout settlement spine (REG-03,
 * REG-05, PAY-10, T-06-10..T-06-19) — the phase's highest architectural
 * risk: can an unauthenticated, actorless, server-to-server webhook safely
 * settle money and capacity in a codebase whose every other write path
 * resolves an actor from a session cookie.
 *
 * Drives the REAL webhook Route Handler (`src/app/api/webhooks/stripe/route.ts`)
 * against a throwaway `postgres:16-alpine` (`tests/support/pg.ts`), signing
 * each event body with the Stripe SDK's own `generateTestHeaderString` — the
 * same HMAC math `constructEvent` verifies against, so this proves the real
 * signature-verification code path, not a mocked one.
 *
 * The route's own module graph (`checkout-webhook-system-service.ts`) binds
 * to the singleton `prisma` client exported by `@/server/db`, which is
 * constructed the FIRST time that module is evaluated, reading
 * `process.env.DATABASE_URL` at that instant. This file therefore takes NO
 * static top-level import of anything that transitively imports
 * `@/server/db` (`checkout-service.ts`, `checkout-webhook-system-service.ts`,
 * the route itself) — every one of those is imported dynamically inside
 * `beforeAll`, AFTER `process.env.DATABASE_URL` is pointed at the
 * Testcontainers instance, so the route's writes land in the same container
 * this file's assertions read from.
 *
 * `checkoutService` here is a test-local instance built directly from the
 * exported `createCheckoutService` factory, wired to the real
 * Testcontainers Prisma client for `startCheckout`/`getOwnOrder`, with the
 * Stripe network call stubbed for `initiateStripePayment` — per this plan's
 * own instruction, no real Stripe network call happens in this test file.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedLearnerFixture } from "./support/cohort-fixtures";
import { STRIPE_API_VERSION } from "@/server/payments/providers/stripe/client";
import type { CheckoutTxClient } from "@/server/services/checkout-service";

type CheckoutServiceModule = typeof import("@/server/services/checkout-service");
type RouteModule = typeof import("@/app/api/webhooks/stripe/route");

let testDb: TestDatabase;
let checkoutService: ReturnType<CheckoutServiceModule["createCheckoutService"]>;
let POST: RouteModule["POST"];

const TEST_WEBHOOK_SECRET = "whsec_test_secret_for_integration_only";

// A Stripe client constructed ONLY to compute the same HMAC signature
// `constructEvent` verifies against — no network call, no real API key.
const signingStripe = new Stripe("sk_test_fake_key_for_signing_only", {
  apiVersion: STRIPE_API_VERSION,
});

let sessionCounter = 0;

function buildCheckoutCompletedEventBody(args: {
  eventId: string;
  sessionId: string;
  orderId: string;
  amountTotal: number;
  currency: string;
}): string {
  return JSON.stringify({
    id: args.eventId,
    object: "event",
    type: "checkout.session.completed",
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: args.sessionId,
        object: "checkout.session",
        client_reference_id: args.orderId,
        amount_total: args.amountTotal,
        currency: args.currency.toLowerCase(),
        payment_status: "paid",
        status: "complete",
      },
    },
  });
}

function buildCheckoutExpiredEventBody(args: {
  eventId: string;
  sessionId: string;
  orderId: string;
}): string {
  return JSON.stringify({
    id: args.eventId,
    object: "event",
    type: "checkout.session.expired",
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: args.sessionId,
        object: "checkout.session",
        client_reference_id: args.orderId,
        status: "expired",
      },
    },
  });
}

function buildPaymentIntentFailedEventBody(args: {
  eventId: string;
  intentId: string;
  orderId: string;
  message: string;
}): string {
  return JSON.stringify({
    id: args.eventId,
    object: "event",
    type: "payment_intent.payment_failed",
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: args.intentId,
        object: "payment_intent",
        metadata: { orderId: args.orderId },
        last_payment_error: { message: args.message },
      },
    },
  });
}

function signedWebhookRequest(rawBody: string, opts?: { tamper?: boolean }): Request {
  const header = signingStripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: TEST_WEBHOOK_SECRET,
  });
  const signatureHeader = opts?.tamper
    ? header.replace(/v1=[0-9a-f]+/, `v1=${"0".repeat(64)}`)
    : header;
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: rawBody,
    headers: { "stripe-signature": signatureHeader },
  });
}

function unsignedWebhookRequest(rawBody: string): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: rawBody,
    // Deliberately no `stripe-signature` header at all.
  });
}

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before any dynamic import below — see file header.
  process.env.DATABASE_URL = testDb.url;
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  // getStripe() needs a non-empty key to CONSTRUCT the client at all; the
  // key itself is never used by webhooks.constructEvent's signature math.
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_getstripe_construction_only";

  const checkoutServiceModule = await import("@/server/services/checkout-service");
  const routeModule = await import("@/app/api/webhooks/stripe/route");
  POST = routeModule.POST;

  checkoutService = checkoutServiceModule.createCheckoutService({
    db: {
      $transaction: (fn) =>
        testDb.prisma.$transaction((tx) => fn(tx as unknown as CheckoutTxClient)),
    },
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = await testDb.prisma.order.findUnique({
          where,
          select: {
            id: true,
            userId: true,
            reference: true,
            status: true,
            amountMinor: true,
            currency: true,
            cohort: {
              select: { id: true, title: true, startsAt: true, endsAt: true, deliveryMode: true },
            },
            enrolments: { select: { id: true, status: true, holdExpiresAt: true } },
          },
        });
        if (!row) return null;
        const { enrolments, ...rest } = row;
        return { ...rest, enrolment: enrolments[0] ?? null };
      },
      update: (args: { where: { id: string }; data: Record<string, unknown> }) =>
        testDb.prisma.order.update({ where: args.where, data: args.data }),
    } as never,
    paymentAttempt: {
      create: (args: { data: Record<string, unknown>; select: { id: true } }) =>
        testDb.prisma.paymentAttempt.create({ data: args.data as never, select: args.select }),
      update: (args: { where: { id: string }; data: Record<string, unknown> }) =>
        testDb.prisma.paymentAttempt.update({ where: args.where, data: args.data as never }),
    } as never,
    stripe: {
      checkout: {
        sessions: {
          create: async () => {
            sessionCounter += 1;
            const id = `cs_test_stub_${sessionCounter}`;
            return { id, url: `https://checkout.stripe.com/pay/${id}` };
          },
        },
      },
    },
    audit: (event) =>
      testDb.prisma.auditEvent
        .create({
          data: {
            actorId: event.actorId,
            actorType: event.actorType ?? "USER",
            action: event.action,
            targetType: event.targetType,
            targetId: event.targetId ?? null,
            outcome: event.outcome,
          },
        })
        .then(() => undefined),
    baseUrl: () => "http://localhost:3000",
  });
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("Stripe webhook settlement — real Postgres (PAY-10, REG-03, REG-05)", () => {
  it("settles a signed checkout.session.completed into PAID + ACTIVE, unchanged seatsTaken, SUCCEEDED PaymentAttempt, an order.paid outbox row, and a SYSTEM audit row", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "NGN",
      holdMinutes: 30,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);

    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    const orderBefore = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    const { url } = await checkoutService.initiateStripePayment({ userId }, orderId);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\/pay\//);

    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });
    const eventId = `evt_test_ok_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: orderBefore.amountMinor,
      currency: orderBefore.currency,
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.paidAt).not.toBeNull();

    const enrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolment.status).toBe("ACTIVE");
    expect(enrolment.holdExpiresAt).toBeNull();

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    expect(cohort.seatsTaken).toBe(1); // unchanged — the hold already counted the seat

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("SUCCEEDED");

    const outboxRows = await testDb.prisma.domainEvent.findMany({ where: { type: "order.paid" } });
    expect(outboxRows.some((row) => (row.payload as { orderId?: string }).orderId === orderId)).toBe(true);

    const auditRows = await testDb.prisma.auditEvent.findMany({
      where: { targetType: "Order", targetId: orderId },
    });
    expect(auditRows.some((row) => row.actorId === null && row.actorType === "SYSTEM")).toBe(true);

    const webhookEventRow = await testDb.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: eventId },
    });
    expect(webhookEventRow.status).toBe("PROCESSED");
  });

  it("a tampered signature returns 400 and leaves Order PENDING with zero WebhookEvent rows", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_tampered_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 45_000_000,
      currency: "NGN",
    });

    const response = await POST(signedWebhookRequest(body, { tamper: true }));
    expect(response.status).toBe(400);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING");

    const events = await testDb.prisma.webhookEvent.findMany({ where: { providerEventId: eventId } });
    expect(events).toHaveLength(0);
  });

  it("reading the order after the redirect with no webhook delivered leaves it PENDING — the redirect itself performs no writes", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);

    const order = await checkoutService.getOwnOrder({ userId }, orderId);
    expect(order?.status).toBe("PENDING");
  });

  it("a redelivered event.id is a no-op — the second POST returns 200 without reprocessing", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_dup_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 45_000_000,
      currency: "NGN",
    });

    const first = await POST(signedWebhookRequest(body));
    expect(first.status).toBe(200);
    const second = await POST(signedWebhookRequest(body));
    expect(second.status).toBe(200);

    const auditRows = await testDb.prisma.auditEvent.findMany({
      where: { targetType: "Order", targetId: orderId, action: "order.paid" },
    });
    expect(auditRows).toHaveLength(1);

    const webhookRows = await testDb.prisma.webhookEvent.findMany({
      where: { providerEventId: eventId },
    });
    expect(webhookRows).toHaveLength(1);
  });

  it("an amount/currency mismatch is recorded as an EXCEPTION and never activates the enrolment (REG-03)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "NGN",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_mismatch_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 1_000, // does not match the Order's recorded amountMinor
      currency: "NGN",
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200); // acknowledged — retrying changes nothing

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("EXCEPTION");
    expect(order.amountMinor).toBe(45_000_000); // byte-identical to its value before the event

    const enrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolment.status).toBe("PENDING_PAYMENT"); // never activated on a mismatch

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("PROCESSING"); // never moved to SUCCEEDED on an untrusted mismatch
    expect(attemptAfter.exceptionNote).not.toBeNull();
    expect(attemptAfter.exceptionNote).toContain("45000000");
  });

  it("a hold already expired by the time the webhook lands (Pitfall 4 race) routes to EXCEPTION, keeps the PaymentAttempt SUCCEEDED with an exceptionNote, and touches no seat count", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "NGN",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });
    const enrolmentBefore = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });

    // Simulate the hold-release worker having already cancelled this hold
    // between initiateStripePayment and the webhook arriving.
    await testDb.prisma.enrolment.update({
      where: { id: enrolmentBefore.id },
      data: { status: "CANCELLED", holdExpiresAt: null, reason: "hold expired" },
    });
    await testDb.prisma.cohort.update({ where: { id: cohortId }, data: { seatsTaken: { decrement: 1 } } });

    const eventId = `evt_race_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 45_000_000,
      currency: "NGN",
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("EXCEPTION");

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("SUCCEEDED"); // the money genuinely moved
    expect(attemptAfter.exceptionNote).not.toBeNull();

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    expect(cohort.seatsTaken).toBe(0); // untouched by settlement
  });

  it("a redelivered event.id after successful settlement leaves the WebhookEvent row PROCESSED, not overwritten to DUPLICATE", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_dup_processed_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 45_000_000,
      currency: "NGN",
    });

    await POST(signedWebhookRequest(body));
    await POST(signedWebhookRequest(body));

    const webhookRow = await testDb.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: eventId },
    });
    expect(webhookRow.status).toBe("PROCESSED");
  });

  it("a payment_intent.payment_failed event moves the PaymentAttempt to FAILED with failedAt and failureReason (PAY-02)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);

    const eventId = `evt_failed_${orderId}`;
    const body = buildPaymentIntentFailedEventBody({
      eventId,
      intentId: `pi_test_${orderId}`,
      orderId,
      message: "Your card was declined.",
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const attemptAfter = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });
    expect(attemptAfter.status).toBe("FAILED");
    expect(attemptAfter.failedAt).not.toBeNull();
    expect(attemptAfter.failureReason).toBe("Your card was declined.");
    expect(attemptAfter.confirmedAt).toBeNull();

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING"); // failure is PaymentAttempt-level bookkeeping only
  });

  it("a checkout.session.expired event moves the PaymentAttempt to CANCELLED with neither confirmedAt nor failedAt set (PAY-02)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_expired_${orderId}`;
    const body = buildCheckoutExpiredEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("CANCELLED");
    expect(attemptAfter.confirmedAt).toBeNull();
    expect(attemptAfter.failedAt).toBeNull();
  });

  it("a failure event against an already-SUCCEEDED PaymentAttempt is a no-op — the attempt is left exactly as it is (terminal-state guard)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "NGN",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const completedEventId = `evt_ok_before_late_failure_${orderId}`;
    const completedBody = buildCheckoutCompletedEventBody({
      eventId: completedEventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 45_000_000,
      currency: "NGN",
    });
    const completedResponse = await POST(signedWebhookRequest(completedBody));
    expect(completedResponse.status).toBe(200);

    const succeededAttempt = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(succeededAttempt.status).toBe("SUCCEEDED");
    const confirmedAtBefore = succeededAttempt.confirmedAt;

    // A late/out-of-order payment_intent.payment_failed arrives for the same
    // Order after settlement already succeeded.
    const failedEventId = `evt_late_failure_${orderId}`;
    const failedBody = buildPaymentIntentFailedEventBody({
      eventId: failedEventId,
      intentId: `pi_late_${orderId}`,
      orderId,
      message: "Late decline notification.",
    });
    const failedResponse = await POST(signedWebhookRequest(failedBody));
    expect(failedResponse.status).toBe(200); // acknowledged — retrying changes nothing

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("SUCCEEDED"); // never moved to FAILED
    expect(attemptAfter.confirmedAt?.getTime()).toBe(confirmedAtBefore?.getTime());

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID"); // the already-correct settlement is not disturbed
  });

  it("a request with no signature header returns 400 with zero WebhookEvent/Order/PaymentAttempt writes", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_no_sig_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 45_000_000,
      currency: "NGN",
    });

    const response = await POST(unsignedWebhookRequest(body));
    expect(response.status).toBe(400);

    const events = await testDb.prisma.webhookEvent.findMany({ where: { providerEventId: eventId } });
    expect(events).toHaveLength(0);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING");

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("PROCESSING");
  });

  it("a signature computed over a different body returns 400 with zero WebhookEvent/Order/PaymentAttempt writes", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_bad_sig_body_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 45_000_000,
      currency: "NGN",
    });

    const response = await POST(signedWebhookRequest(body, { tamper: true }));
    expect(response.status).toBe(400);

    const events = await testDb.prisma.webhookEvent.findMany({ where: { providerEventId: eventId } });
    expect(events).toHaveLength(0);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING");

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("PROCESSING");
  });

  it("a request arriving when the signing secret is unset returns 500, distinguishable from a signature failure, with zero writes", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_no_secret_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 45_000_000,
      currency: "NGN",
    });

    const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    let response: Response;
    try {
      response = await POST(signedWebhookRequest(body));
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
    }
    expect(response.status).toBe(500);

    const events = await testDb.prisma.webhookEvent.findMany({ where: { providerEventId: eventId } });
    expect(events).toHaveLength(0);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING");

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("PROCESSING");
  });
});
