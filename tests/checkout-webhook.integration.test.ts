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
import { seedCohortFixture, seedLearnerFixture, seedStripeUsdFeeScheduleFixture } from "./support/cohort-fixtures";
import { STRIPE_API_VERSION } from "@/server/payments/providers/stripe/client";
import type { CheckoutTxClient } from "@/server/services/checkout-service";
import { calculateCheckoutBreakdown, type GatewayFeeScheduleValues } from "@/server/payments/pricing";

type CheckoutServiceModule = typeof import("@/server/services/checkout-service");
type RouteModule = typeof import("@/app/api/webhooks/stripe/route");

let testDb: TestDatabase;
let checkoutService: ReturnType<CheckoutServiceModule["createCheckoutService"]>;
let POST: RouteModule["POST"];

/**
 * 07-06 — `initiateStripePayment` now refuses a non-USD Order (D-07) since
 * the Stripe rail is a Connect DESTINATION CHARGE against a real connected
 * account (T-07-29). This file's cohorts moved from the pre-Phase-7 NGN/
 * Stripe pairing (never architecturally valid post-D-07, just never
 * enforced until this plan) to USD/Stripe — mirrors
 * `seedStripeUsdFeeScheduleFixture`'s own values exactly, the same fix
 * 07-04 already applied to `tests/checkout-hold-race.integration.test.ts`.
 *
 * 07-04's original comment about `startCheckout`'s D-13 snapshot (every
 * literal `amount_total` this file's webhook bodies report must be the
 * ACTUAL total a real Order created against this schedule would carry, not
 * the bare base price) still applies verbatim — only the schedule and
 * currency changed.
 */
const STRIPE_USD_SCHEDULE: GatewayFeeScheduleValues = {
  provider: "STRIPE",
  currency: "USD",
  version: 1,
  percentageBps: 290,
  fixedMinor: 30,
  waiverThresholdMinor: null,
  capMinor: null,
  taxBps: 0,
  roundingRule: "HALF_UP",
};
const BASE_AMOUNT_MINOR = 45_000_000;
const EXPECTED_TOTAL_MINOR = calculateCheckoutBreakdown({
  baseAmountMinor: BASE_AMOUNT_MINOR,
  schedule: STRIPE_USD_SCHEDULE,
}).totalAmountMinor;

/** 07-06 — a fixed test-mode connected account id; `initiateStripePayment`
 *  fails closed (`MissingSettlementAccountError`) without one (D-05). */
const TEST_STRIPE_CONNECTED_ACCOUNT_ID = "acct_test_connected_webhook_integration";

/** Every required-consent field affirmative — plan 06-07's REG-04 gate. */
const FULL_CONSENT = {
  acceptedTerms: true,
  acceptedRefundCancellation: true,
  acceptedMarketing: false,
};

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
  /**
   * 07-06 — optional expanded `payment_intent` shape, simulating a
   * deployment whose webhook endpoint is configured to expand
   * `data.object.payment_intent`/`.latest_charge`. Omitted by every
   * pre-existing case (a bare id string is the un-expanded default Stripe
   * shape and is what most of this file's cases still exercise implicitly
   * by never overriding this field).
   */
  paymentIntent?: string | { id?: string; latest_charge?: unknown };
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
        ...(args.paymentIntent !== undefined ? { payment_intent: args.paymentIntent } : {}),
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
  // 07-06 — `initiateStripePayment` fails closed without this (D-05).
  process.env.STRIPE_CONNECTED_ACCOUNT_ID = TEST_STRIPE_CONNECTED_ACCOUNT_ID;

  // 07-04 — `startTestDatabase()` applies migrations only, never
  // `prisma/seed.ts`; `startCheckout` now needs an active STRIPE/USD
  // `GatewayFeeSchedule` row to compute the D-13 snapshot (this file's
  // cohorts are USD — see the module header comment above).
  await seedStripeUsdFeeScheduleFixture(testDb.prisma);

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
    // 07-04 compile-level consequence of `CheckoutServiceDeps` gaining a
    // `paystack` field — this file exercises the Stripe settlement path
    // only; a real Paystack Testcontainers proof lives in
    // tests/paystack-webhook.integration.test.ts (07-04 Task 3).
    paystack: {
      initiate: async () => {
        throw new Error("paystack.initiate is not exercised by this Stripe-only integration suite.");
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
      currency: "USD",
      holdMinutes: 30,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });

    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    const orderBefore = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    const { url } = await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
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

  it("returns 200 and records a reconciliation exception when payment arrives after another ACTIVE enrolment wins", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 3,
      seatsTaken: 0,
      priceMinor: BASE_AMOUNT_MINOR,
      currency: "USD",
      holdMinutes: 30,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });

    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    const orderBefore = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const activeEnrolment = await testDb.prisma.enrolment.create({
      data: {
        userId,
        cohortId,
        status: "ACTIVE",
        activatedAt: new Date(),
        reason: "Concurrent activation fixture",
      },
    });
    await testDb.prisma.cohort.update({
      where: { id: cohortId },
      data: { seatsTaken: 2 },
    });

    const eventId = `evt_test_duplicate_active_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: orderBefore.amountMinor,
      currency: orderBefore.currency,
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const orderAfter = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter.status).toBe("EXCEPTION");

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("SUCCEEDED");
    expect(attemptAfter.exceptionNote).toContain("already has an active enrolment");

    const pendingEnrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(pendingEnrolment.status).toBe("PENDING_PAYMENT");
    expect(await testDb.prisma.enrolment.count({ where: { userId, cohortId, status: "ACTIVE" } })).toBe(1);
    expect(
      await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: activeEnrolment.id } }),
    ).toMatchObject({ status: "ACTIVE" });
    expect((await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })).seatsTaken).toBe(2);

    const webhookEvent = await testDb.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: eventId },
    });
    // The delivery itself was handled successfully. The business exception
    // lives on Order/PaymentAttempt so Stripe does not retry a settled event.
    expect(webhookEvent.status).toBe("PROCESSED");
  });

  it("07-06: a USD destination charge's snapshotted base price and learner total are two distinct values that both survive settlement unchanged (D-04)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: BASE_AMOUNT_MINOR,
      currency: "USD",
      holdMinutes: 30,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });

    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    const orderBefore = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderBefore.baseAmountMinor).toBe(BASE_AMOUNT_MINOR);
    expect(orderBefore.amountMinor).toBe(EXPECTED_TOTAL_MINOR);
    // Two different intentional values, asserted separately — the whole
    // point of a destination charge (D-04).
    expect(orderBefore.baseAmountMinor).not.toBe(orderBefore.amountMinor);

    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_destination_roundtrip_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
    });
    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const orderAfter = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter.status).toBe("PAID");
    // The school's settlement snapshot and the learner's charged total are
    // both untouched by settlement — this route never recomputes either.
    expect(orderAfter.baseAmountMinor).toBe(orderBefore.baseAmountMinor);
    expect(orderAfter.amountMinor).toBe(orderBefore.amountMinor);
  });

  it("07-06: stores Stripe settlement correlation evidence (PaymentIntent id, charge id, transfer id, transfer destination) with no secret-bearing key, and leaves all four actual-settlement columns NULL (D-14, D-21)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: BASE_AMOUNT_MINOR,
      currency: "USD",
      holdMinutes: 30,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    const orderBefore = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_evidence_${orderId}`;
    const paymentIntentId = `pi_test_${orderId}`;
    const chargeId = `ch_test_${orderId}`;
    const transferId = `tr_test_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: orderBefore.amountMinor,
      currency: orderBefore.currency,
      paymentIntent: { id: paymentIntentId, latest_charge: { id: chargeId, transfer: { id: transferId } } },
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    const evidence = attemptAfter.evidence as Record<string, unknown>;
    expect(attemptAfter.providerRef).toBe(chargeId);
    expect(evidence.paymentIntentId).toBe(paymentIntentId);
    expect(evidence.chargeId).toBe(chargeId);
    expect(evidence.transferId).toBe(transferId);
    expect(evidence.transferDestination).toBe(TEST_STRIPE_CONNECTED_ACCOUNT_ID);

    for (const [key, value] of Object.entries(evidence)) {
      expect(key.toLowerCase()).not.toContain("secret");
      if (typeof value === "string") {
        expect(value.toLowerCase()).not.toContain("secret");
      }
    }

    // D-14 — never conflate expected with actual: these four columns stay
    // NULL at webhook time; only 07-07's reconciliation sweep may populate
    // them, from independently verified provider evidence.
    expect(attemptAfter.gatewayFeeActualMinor).toBeNull();
    expect(attemptAfter.schoolSettlementActualMinor).toBeNull();
    expect(attemptAfter.platformGrossActualMinor).toBeNull();
    expect(attemptAfter.platformNetActualMinor).toBeNull();
    expect(attemptAfter.reconciledAt).toBeNull();
  });

  it("07-06: an unexpanded payment_intent (a bare id string, the un-expanded default) still records the PaymentIntent id and destination, with charge/transfer left null rather than fabricated", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: BASE_AMOUNT_MINOR,
      currency: "USD",
      holdMinutes: 30,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    const orderBefore = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_evidence_unexpanded_${orderId}`;
    const paymentIntentId = `pi_test_unexpanded_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: orderBefore.amountMinor,
      currency: orderBefore.currency,
      paymentIntent: paymentIntentId,
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    const evidence = attemptAfter.evidence as Record<string, unknown>;
    expect(attemptAfter.providerRef).toBe(paymentIntentId);
    expect(evidence.paymentIntentId).toBe(paymentIntentId);
    expect(evidence.transferDestination).toBe(TEST_STRIPE_CONNECTED_ACCOUNT_ID);
    expect(evidence.chargeId).toBeNull();
    expect(evidence.transferId).toBeNull();
  });

  it("a tampered signature returns 400 and leaves Order PENDING with zero WebhookEvent rows", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0, currency: "USD" });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_tampered_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
    });

    const response = await POST(signedWebhookRequest(body, { tamper: true }));
    expect(response.status).toBe(400);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING");

    const events = await testDb.prisma.webhookEvent.findMany({ where: { providerEventId: eventId } });
    expect(events).toHaveLength(0);
  });

  it("reading the order after the redirect with no webhook delivered leaves it PENDING — the redirect itself performs no writes", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0, currency: "USD" });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);

    const order = await checkoutService.getOwnOrder({ userId }, orderId);
    expect(order?.status).toBe("PENDING");
  });

  it("a redelivered event.id is a no-op — the second POST returns 200 without reprocessing", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "USD",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_dup_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
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
      currency: "USD",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_mismatch_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: 1_000, // does not match the Order's recorded amountMinor
      currency: "USD",
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200); // acknowledged — retrying changes nothing

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("EXCEPTION");
    expect(order.amountMinor).toBe(EXPECTED_TOTAL_MINOR); // byte-identical to its value before the event

    const enrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolment.status).toBe("PENDING_PAYMENT"); // never activated on a mismatch

    const attemptAfter = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(attemptAfter.status).toBe("PROCESSING"); // never moved to SUCCEEDED on an untrusted mismatch
    expect(attemptAfter.exceptionNote).not.toBeNull();
    expect(attemptAfter.exceptionNote).toContain(String(EXPECTED_TOTAL_MINOR));
  });

  it("a hold already expired by the time the webhook lands (Pitfall 4 race) routes to EXCEPTION, keeps the PaymentAttempt SUCCEEDED with an exceptionNote, and touches no seat count", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "USD",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
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
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
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
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0, currency: "USD" });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_dup_processed_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
    });

    await POST(signedWebhookRequest(body));
    await POST(signedWebhookRequest(body));

    const webhookRow = await testDb.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: eventId },
    });
    expect(webhookRow.status).toBe("PROCESSED");
  });

  it("a payment_intent.payment_failed event moves the PaymentAttempt to FAILED with failedAt and failureReason (PAY-02)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0, currency: "USD" });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);

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
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0, currency: "USD" });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
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
      currency: "USD",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const completedEventId = `evt_ok_before_late_failure_${orderId}`;
    const completedBody = buildCheckoutCompletedEventBody({
      eventId: completedEventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
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

  it("a successful settlement dispatches exactly one confirmation EmailDispatch row to the order's owner", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "USD",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const learner = await testDb.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    const orderBefore = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_email_ok_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: orderBefore.amountMinor,
      currency: orderBefore.currency,
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { userId } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].toEmail).toBe(learner.email);
    expect(dispatches[0].template).toBe("order-confirmation");
  });

  it("a replayed webhook event sends no second confirmation email", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "USD",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_email_replay_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
    });

    const first = await POST(signedWebhookRequest(body));
    expect(first.status).toBe(200);
    const second = await POST(signedWebhookRequest(body));
    expect(second.status).toBe(200);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { userId } });
    expect(dispatches).toHaveLength(1);
  });

  it("a mail-provider outage still leaves the response at 200 and the Order PAID — the FAILED EmailDispatch row is the only trace", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "USD",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_email_provider_outage_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
    });

    // Force the send to fail deterministically regardless of this
    // environment's own Brevo configuration — dispatchBestEffort must still
    // resolve the webhook's own response at 200 and leave the Order PAID.
    const savedKey = process.env.BREVO_API_KEY;
    delete process.env.BREVO_API_KEY;
    let response: Response;
    try {
      response = await POST(signedWebhookRequest(body));
    } finally {
      if (savedKey !== undefined) process.env.BREVO_API_KEY = savedKey;
    }
    expect(response.status).toBe(200);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { userId } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe("FAILED");
  });

  it("the Pitfall-4 exception branch dispatches one EmailDispatch row distinct from the success template", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceMinor: 45_000_000,
      currency: "USD",
    });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });
    const enrolmentBefore = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });

    // Simulate the hold-release worker having already cancelled this hold
    // between initiateStripePayment and the webhook arriving.
    await testDb.prisma.enrolment.update({
      where: { id: enrolmentBefore.id },
      data: { status: "CANCELLED", holdExpiresAt: null, reason: "hold expired" },
    });
    await testDb.prisma.cohort.update({ where: { id: cohortId }, data: { seatsTaken: { decrement: 1 } } });

    const eventId = `evt_email_exception_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
    });

    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { userId } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].template).toBe("order-payment-exception");
  });

  it("a request with no signature header returns 400 with zero WebhookEvent/Order/PaymentAttempt writes", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0, currency: "USD" });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_no_sig_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
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
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0, currency: "USD" });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_bad_sig_body_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
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
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 0, currency: "USD" });
    const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "USD");
    await checkoutService.initiateStripePayment({ userId }, orderId, FULL_CONSENT);
    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });

    const eventId = `evt_no_secret_${orderId}`;
    const body = buildCheckoutCompletedEventBody({
      eventId,
      sessionId: attempt.providerIntentId!,
      orderId,
      amountTotal: EXPECTED_TOTAL_MINOR,
      currency: "USD",
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
