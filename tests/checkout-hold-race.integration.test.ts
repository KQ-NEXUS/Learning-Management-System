/**
 * Real-Postgres proof for the hold-expiry-sweep-versus-webhook race
 * (06-RESEARCH.md Pitfall 4, T-06-36) — Phase 5's hold-release worker and
 * Phase 6's Stripe webhook are two independent subsystems mutating the same
 * seat with no shared clock. This drives BOTH real subsystems in the real
 * order rather than simulating either one:
 *
 *   1. `startCheckout`/`initiateStripePayment` (real `checkout-service.ts`,
 *      Stripe network call stubbed) takes a real seat hold.
 *   2. `holdExpiresAt` is aged into the past directly, the same way
 *      `tests/hold-release.integration.test.ts` already does.
 *   3. `releaseExpiredHoldsAsSystem` (real `hold-release-system-service.ts`)
 *      sweeps it — cancelling the enrolment and returning the seat — exactly
 *      as `worker/index.ts`'s five-minute cron schedule would.
 *   4. A genuinely signed `checkout.session.completed` event is delivered
 *      through the REAL webhook Route Handler, exactly as
 *      `tests/checkout-webhook.integration.test.ts` does.
 *
 * Every dynamic-import/`DATABASE_URL`-timing discipline in this file mirrors
 * `tests/checkout-webhook.integration.test.ts` exactly — see that file's own
 * header for the full reasoning. This file additionally dynamically imports
 * `hold-release-system-service.ts`, which ALSO binds to the singleton
 * `prisma` client at first import, for the same reason.
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
type HoldReleaseModule = typeof import("@/server/services/hold-release-system-service");

let testDb: TestDatabase;
let checkoutService: ReturnType<CheckoutServiceModule["createCheckoutService"]>;
let POST: RouteModule["POST"];
let releaseExpiredHoldsAsSystem: HoldReleaseModule["releaseExpiredHoldsAsSystem"];

/** Every required-consent field affirmative — plan 06-07's REG-04 gate. */
const FULL_CONSENT = {
  acceptedTerms: true,
  acceptedRefundCancellation: true,
  acceptedMarketing: false,
};

const TEST_WEBHOOK_SECRET = "whsec_test_secret_for_hold_race_integration_only";

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

function signedWebhookRequest(rawBody: string): Request {
  const signatureHeader = signingStripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: TEST_WEBHOOK_SECRET,
  });
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
  const holdReleaseModule = await import("@/server/services/hold-release-system-service");
  POST = routeModule.POST;
  releaseExpiredHoldsAsSystem = holdReleaseModule.releaseExpiredHoldsAsSystem;

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
      update: (args: { where: { id: string }; data: Record<string, unknown> }) =>
        testDb.prisma.paymentAttempt.update({ where: args.where, data: args.data as never }),
    } as never,
    user: {
      findUnique: (args: { where: { id: string } }) =>
        testDb.prisma.user.findUnique({
          where: args.where,
          select: { email: true, emailVerified: true },
        }),
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

describe("hold-expiry-sweep-versus-webhook race — real Postgres (Pitfall 4, T-06-36)", () => {
  it("base race: a sweep before the webhook cancels the hold; the late webhook lands EXCEPTION with correct seat arithmetic and an exceptionNote", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "NGN",
      holdMinutes: 30,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });

    const cohortBefore = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    const seatsTakenBeforeCheckout = cohortBefore.seatsTaken;

    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });
    const enrolmentBefore = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });

    // Age the hold into the past, exactly like tests/hold-release.integration.test.ts.
    await testDb.prisma.enrolment.update({
      where: { id: enrolmentBefore.id },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });

    // The real sweep — not a hand-simulated cancellation.
    const sweepResult = await releaseExpiredHoldsAsSystem();
    expect(sweepResult.released).toBeGreaterThanOrEqual(1);

    const enrolmentAfterSweep = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: enrolmentBefore.id },
    });
    expect(enrolmentAfterSweep.status).toBe("CANCELLED");

    // The webhook arrives AFTER the sweep.
    const eventId = `evt_race_base_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 45_000_000,
      currency: "NGN",
    });
    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200); // never a non-2xx — Stripe must not retry this forever

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("EXCEPTION");

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("SUCCEEDED"); // the money genuinely moved
    expect(attemptAfter.confirmedAt).not.toBeNull();
    expect(attemptAfter.exceptionNote).not.toBeNull();

    const enrolmentAfterWebhook = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: enrolmentBefore.id },
    });
    expect(enrolmentAfterWebhook.status).toBe("CANCELLED"); // untouched by the webhook

    const cohortAfter = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    expect(cohortAfter.seatsTaken).toBe(seatsTakenBeforeCheckout); // exact — before checkout == after webhook

    const auditRows = await testDb.prisma.auditEvent.findMany({
      where: { actorId: null, actorType: "SYSTEM" },
      orderBy: { id: "asc" },
    });
    const sweepAudit = auditRows.find(
      (row) => row.targetType === "Enrolment" && row.targetId === enrolmentBefore.id && row.action === "enrolment.hold_expired",
    );
    const webhookAudit = auditRows.find(
      (row) => row.targetType === "Order" && row.targetId === orderId && row.action === "order.exception",
    );
    expect(sweepAudit).toBeDefined();
    expect(webhookAudit).toBeDefined();
    expect(sweepAudit?.action).not.toBe(webhookAudit?.action); // distinguishable by action name
  });

  it("contention variant: a different learner who took the freed seat keeps it — the late webhook does not evict them or oversell the cohort", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 1, // tight — learner B can only take the seat if it was genuinely freed
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "NGN",
      holdMinutes: 30,
    });
    const { userId: userA } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { userId: userB } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });

    const { orderId: orderIdA } = await checkoutService.startCheckout({ userId: userA }, cohortId);
    await checkoutService.initiateStripePayment({ userId: userA }, orderIdA, FULL_CONSENT);
    const attemptA = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: orderIdA } });
    const enrolmentA = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId: orderIdA } });

    await testDb.prisma.enrolment.update({
      where: { id: enrolmentA.id },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    await releaseExpiredHoldsAsSystem();

    const enrolmentAAfterSweep = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentA.id } });
    expect(enrolmentAAfterSweep.status).toBe("CANCELLED");

    // Between the sweep and A's webhook, learner B takes the freed seat.
    const { orderId: orderIdB } = await checkoutService.startCheckout({ userId: userB }, cohortId);
    const enrolmentB = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId: orderIdB } });
    expect(enrolmentB.status).toBe("PENDING_PAYMENT");
    expect(enrolmentB.holdExpiresAt).not.toBeNull();

    const cohortAfterB = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    expect(cohortAfterB.seatsTaken).toBe(1); // B now holds the cohort's only seat

    // A's late webhook arrives.
    const eventId = `evt_race_contention_${orderIdA}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attemptA.providerIntentId!,
      orderId: orderIdA,
      amountTotal: 45_000_000,
      currency: "NGN",
    });
    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const orderA = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderIdA } });
    expect(orderA.status).toBe("EXCEPTION");

    // B's hold survives untouched — not evicted, not double-counted.
    const enrolmentBAfter = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentB.id } });
    expect(enrolmentBAfter.status).toBe("PENDING_PAYMENT");
    expect(enrolmentBAfter.holdExpiresAt).not.toBeNull();

    const cohortFinal = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    expect(cohortFinal.seatsTaken).toBe(1); // still exactly B's seat — never oversold, never re-claimed
  });

  it("control: the same setup with no sweep in between still produces PAID and ACTIVE — the guard discriminates rather than always refusing", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "NGN",
      holdMinutes: 30,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });

    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId);
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_race_control_${orderId}`;
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
    expect(order.status).toBe("PAID");

    const enrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolment.status).toBe("ACTIVE");
  });
});
