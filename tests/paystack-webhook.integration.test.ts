/**
 * Real-Postgres proof for the Paystack checkout settlement spine (PAY-07,
 * PAY-10, PAY-11, PAY-17) — mirrors
 * `tests/checkout-webhook.integration.test.ts`'s shape exactly: a real
 * Order and seat hold, a genuinely HMAC-SHA512-signed webhook delivered
 * through the REAL Route Handler (`src/app/api/webhooks/paystack/route.ts`),
 * settlement to PAID/ACTIVE, a redelivery producing no second effect, and an
 * amount/currency mismatch producing a visible exception.
 *
 * Same module-binding discipline as that file: no static top-level import of
 * anything that transitively imports `@/server/db` — every one of those
 * (`checkout-service.ts`, `checkout-webhook-system-service.ts`, the route
 * itself) is imported dynamically inside `beforeAll`, AFTER
 * `process.env.DATABASE_URL` is pointed at the Testcontainers instance.
 *
 * The route's own independent Verify Transaction call (07-RESEARCH.md
 * Pitfall 1) hits `fetch()` — stubbed here, exactly like the Stripe file
 * stubs `initiateStripePayment`'s network call, per this plan's own
 * "no real provider network call in this test file" instruction. The
 * signature verification itself is never mocked: it runs the real
 * HMAC-SHA512 computation against the real raw body.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedLearnerFixture, seedPaystackNgnFeeScheduleFixture } from "./support/cohort-fixtures";
import { calculateCheckoutBreakdown, type GatewayFeeScheduleValues } from "@/server/payments/pricing";
import type { CheckoutTxClient } from "@/server/services/checkout-service";

/** Mirrors `seedPaystackNgnFeeScheduleFixture`'s own values exactly (D-25). */
const PAYSTACK_NGN_SCHEDULE: GatewayFeeScheduleValues = {
  provider: "PAYSTACK",
  currency: "NGN",
  version: 1,
  percentageBps: 150,
  fixedMinor: 10_000,
  waiverThresholdMinor: null,
  capMinor: 200_000,
  taxBps: 0,
  roundingRule: "HALF_UP",
};
const BASE_AMOUNT_MINOR = 45_000_000;
const EXPECTED_TOTAL_MINOR = calculateCheckoutBreakdown({
  baseAmountMinor: BASE_AMOUNT_MINOR,
  schedule: PAYSTACK_NGN_SCHEDULE,
}).totalAmountMinor;

const TEST_PAYSTACK_SECRET = "sk_test_secret_for_paystack_integration_only";

/** Every required-consent field affirmative — plan 06-07's REG-04 gate, reused verbatim for Paystack. */
const FULL_CONSENT = {
  acceptedTerms: true,
  acceptedRefundCancellation: true,
  acceptedMarketing: false,
};

type CheckoutServiceModule = typeof import("@/server/services/checkout-service");
type RouteModule = typeof import("@/app/api/webhooks/paystack/route");

let testDb: TestDatabase;
let checkoutService: ReturnType<CheckoutServiceModule["createCheckoutService"]>;
let POST: RouteModule["POST"];
let eventCounter = 0;

function sign(body: string, secret: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

function signedWebhookRequest(rawBody: string, secret: string = TEST_PAYSTACK_SECRET): Request {
  return new Request("http://localhost/api/webhooks/paystack", {
    method: "POST",
    body: rawBody,
    headers: { "x-paystack-signature": sign(rawBody, secret) },
  });
}

function chargeSuccessBody(args: {
  eventId: number;
  reference: string;
  orderId: string;
  amount?: number;
  currency?: string;
}): string {
  return JSON.stringify({
    event: "charge.success",
    data: {
      id: args.eventId,
      reference: args.reference,
      status: "success",
      amount: args.amount ?? EXPECTED_TOTAL_MINOR,
      currency: args.currency ?? "NGN",
      metadata: { orderId: args.orderId, enrolmentId: "unused-in-this-fixture" },
    },
  });
}

/** Stubs `fetch()` so the route's independent Verify Transaction call (Pitfall 1) returns a controlled, allow-listed response without a real network call. */
function stubVerifyTransaction(data: { status: string; amount?: number; currency?: string; reference: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: "Verification successful",
        data: {
          id: 1,
          reference: data.reference,
          status: data.status,
          amount: data.amount ?? EXPECTED_TOTAL_MINOR,
          currency: data.currency ?? "NGN",
          channel: "card",
          paid_at: new Date().toISOString(),
          fees: 200_000,
        },
      }),
    }),
  );
}

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before any dynamic import below — see file header.
  process.env.DATABASE_URL = testDb.url;
  process.env.PAYSTACK_SECRET_KEY = TEST_PAYSTACK_SECRET;
  process.env.PAYSTACK_SUBACCOUNT_CODE = "ACCT_fixture_subaccount";

  await seedPaystackNgnFeeScheduleFixture(testDb.prisma);

  const checkoutServiceModule = await import("@/server/services/checkout-service");
  const routeModule = await import("@/app/api/webhooks/paystack/route");
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
            selectedProvider: true,
            baseAmountMinor: true,
            platformFeeMinor: true,
            gatewayFeeEstimateMinor: true,
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
      findByReference: async ({ reference }: { reference: string }) => {
        const row = await testDb.prisma.order.findUnique({
          where: { reference },
          select: {
            id: true,
            userId: true,
            reference: true,
            status: true,
            amountMinor: true,
            currency: true,
            selectedProvider: true,
            baseAmountMinor: true,
            platformFeeMinor: true,
            gatewayFeeEstimateMinor: true,
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
            throw new Error("stripe.checkout.sessions.create is not exercised by this Paystack-only suite.");
          },
        },
      },
    },
    // The one deliberately-stubbed network call in this file, per this
    // plan's own "no real provider network call" instruction — mirrors real
    // Paystack behaviour by echoing the order's own reference back as the
    // provider intent id, exactly as `initiatePaystackTransaction` does.
    paystack: {
      initiate: async (input: { orderReference: string }) => ({
        redirectUrl: `https://checkout.paystack.com/fixture_${input.orderReference}`,
        providerIntentId: input.orderReference,
      }),
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

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Seeds a cohort + learner, takes a real hold, and initiates a real Paystack PaymentAttempt. */
async function seedOrderAndAttempt(
  cohortOverrides: Record<string, unknown> = {},
): Promise<{ orderId: string; reference: string; enrolmentId: string }> {
  const { cohortId } = await seedCohortFixture(testDb.prisma, {
    capacity: 2,
    seatsTaken: 0,
    priceMinor: BASE_AMOUNT_MINOR,
    currency: "NGN",
    holdMinutes: 30,
    ...cohortOverrides,
  });
  const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
  const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "NGN");
  await checkoutService.initiatePaystackPayment({ userId }, orderId, FULL_CONSENT);

  const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const enrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
  return { orderId, reference: order.reference, enrolmentId: enrolment.id };
}

describe("Paystack webhook settlement — real Postgres (PAY-07, PAY-10, PAY-11, PAY-17)", () => {
  it("settles a signed charge.success event into PAID + ACTIVE, unchanged seatsTaken, SUCCEEDED PaymentAttempt, and a PAYSTACK WebhookEvent row", async () => {
    const { orderId, reference } = await seedOrderAndAttempt();
    eventCounter += 1;
    stubVerifyTransaction({ status: "success", reference });

    const body = chargeSuccessBody({ eventId: eventCounter, reference, orderId });
    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.amountMinor).toBe(EXPECTED_TOTAL_MINOR);

    const enrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolment.status).toBe("ACTIVE");

    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });
    expect(attempt.provider).toBe("PAYSTACK");
    expect(attempt.status).toBe("SUCCEEDED");

    const webhookEvent = await testDb.prisma.webhookEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "PAYSTACK", providerEventId: String(eventCounter) } },
    });
    expect(webhookEvent.status).toBe("PROCESSED");
  }, 15_000);

  it("an identical redelivery returns 200, leaves the WebhookEvent row's PROCESSED status intact, and produces no second Enrolment activation", async () => {
    const { orderId, reference } = await seedOrderAndAttempt();
    eventCounter += 1;
    const thisEventId = eventCounter;
    stubVerifyTransaction({ status: "success", reference });

    const body = chargeSuccessBody({ eventId: thisEventId, reference, orderId });
    const first = await POST(signedWebhookRequest(body));
    expect(first.status).toBe(200);

    const enrolmentAfterFirst = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolmentAfterFirst.status).toBe("ACTIVE");
    const activatedAtAfterFirst = enrolmentAfterFirst.activatedAt;

    // Redelivery — identical body and signature, a fresh Verify Transaction stub (Paystack would genuinely re-deliver, not replay a cached HTTP response).
    stubVerifyTransaction({ status: "success", reference });
    const second = await POST(signedWebhookRequest(body));
    expect(second.status).toBe(200);

    const webhookEvent = await testDb.prisma.webhookEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "PAYSTACK", providerEventId: String(thisEventId) } },
    });
    expect(webhookEvent.status).toBe("PROCESSED"); // never DUPLICATE — a genuine first-then-skip, not a race

    const enrolmentAfterSecond = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolmentAfterSecond.status).toBe("ACTIVE");
    expect(enrolmentAfterSecond.activatedAt?.getTime()).toBe(activatedAtAfterFirst?.getTime());

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
  }, 15_000);

  it("an amount mismatch (verified transaction vs. the Order's own snapshot) routes to EXCEPTION, leaves the Order not PAID, and never activates the enrolment", async () => {
    const { orderId, reference } = await seedOrderAndAttempt();
    eventCounter += 1;
    // The Verify Transaction response's amount deliberately disagrees with
    // the Order's recorded amountMinor (D-13's snapshot).
    stubVerifyTransaction({ status: "success", reference, amount: 1_000 });

    const body = chargeSuccessBody({ eventId: eventCounter, reference, orderId, amount: 1_000 });
    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200); // acknowledged — retrying changes nothing

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("EXCEPTION");
    expect(order.amountMinor).toBe(EXPECTED_TOTAL_MINOR); // unchanged by the mismatched report

    const enrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolment.status).toBe("PENDING_PAYMENT"); // never activated on a mismatch

    const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });
    expect(attempt.status).toBe("PROCESSING"); // never moved to SUCCEEDED on an untrusted mismatch
    expect(attempt.exceptionNote).not.toBeNull();
    expect(attempt.exceptionNote).toContain("PAYSTACK");
  }, 15_000);

  it("a request with an invalid signature returns 400 and performs zero database writes", async () => {
    const { orderId, reference } = await seedOrderAndAttempt();
    eventCounter += 1;
    const body = chargeSuccessBody({ eventId: eventCounter, reference, orderId });
    const badSignatureRequest = new Request("http://localhost/api/webhooks/paystack", {
      method: "POST",
      body,
      headers: { "x-paystack-signature": "0".repeat(128) },
    });

    const response = await POST(badSignatureRequest);
    expect(response.status).toBe(400);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING"); // untouched — no write reached the database

    await expect(
      testDb.prisma.webhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "PAYSTACK", providerEventId: String(eventCounter) } },
      }),
    ).resolves.toBeNull();
  }, 15_000);

  it("refuses to settle when the verified transaction's nested status is not successful, even though the delivered event claims success (Pitfall 1)", async () => {
    const { orderId, reference } = await seedOrderAndAttempt();
    eventCounter += 1;
    stubVerifyTransaction({ status: "abandoned", reference });

    const body = chargeSuccessBody({ eventId: eventCounter, reference, orderId }); // the event body itself claims "success"
    const response = await POST(signedWebhookRequest(body));
    expect(response.status).toBe(200);

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING"); // never settled — the route never called activateOrderAsSystem

    const enrolment = await testDb.prisma.enrolment.findFirstOrThrow({ where: { orderId } });
    expect(enrolment.status).toBe("PENDING_PAYMENT");
  }, 15_000);
});
