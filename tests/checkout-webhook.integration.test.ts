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

    const enrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolment.status).toBe("PENDING_PAYMENT"); // never activated on a mismatch
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
});
