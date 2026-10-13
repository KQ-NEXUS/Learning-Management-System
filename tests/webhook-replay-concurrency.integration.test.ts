/**
 * Real-Postgres proof that a Paystack webhook delivered many times at once
 * settles exactly once (plan 15-12, NFR-03).
 *
 * Paystack (like every provider) may deliver the same signed event several
 * times, and those deliveries can overlap. The guards are the
 * `WebhookEvent @@unique([provider, providerEventId])` key, which
 * `recordWebhookEventOrSkip` turns into "already recorded, skip", and the
 * `FOR UPDATE` row lock on the Order in `activateOrderAsSystem`. The existing
 * `tests/paystack-webhook.integration.test.ts` proves a SEQUENTIAL redelivery;
 * this file fires the same signed `charge.success` event ten times with
 * `Promise.all` through the real Route Handler and proves one payment success
 * transition, one enrolment activation, one PROCESSED WebhookEvent row, and
 * nine deliveries that took the duplicate path (no second provider
 * verification call, no second `order.paid` event).
 *
 * Same module-binding discipline as the sequential file: nothing that imports
 * `@/server/db` is imported statically; the route and checkout service are
 * imported inside `beforeAll` after `DATABASE_URL` names the container. The
 * route's Verify Transaction call is the one stubbed network call; the
 * HMAC-SHA512 signature check runs for real.
 *
 * SAFETY: the only database here is a disposable Testcontainers instance from
 * `startTestDatabase()`. No real provider is contacted.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED, never a silent pass.
 */

import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import {
  seedLearnerFixture,
  seedPaystackNgnFeeScheduleFixture,
  seedPublishedCohortFixture,
} from "./support/cohort-fixtures";
import { calculateCheckoutBreakdown, type GatewayFeeScheduleValues } from "@/server/payments/pricing";
import type { CheckoutTxClient } from "@/server/services/checkout-service";

/** Mirrors `seedPaystackNgnFeeScheduleFixture`'s values (D-25). */
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

const TEST_PAYSTACK_SECRET = "sk_test_secret_for_webhook_replay_concurrency_only";
const DELIVERIES = 10;

const FULL_CONSENT = { acceptedTerms: true, acceptedRefundCancellation: true, acceptedMarketing: false };

type CheckoutServiceModule = typeof import("@/server/services/checkout-service");
type RouteModule = typeof import("@/app/api/webhooks/paystack/route");

let testDb: TestDatabase;
let checkoutService: ReturnType<CheckoutServiceModule["createCheckoutService"]>;
let POST: RouteModule["POST"];

function signedWebhookRequest(rawBody: string): Request {
  return new Request("http://localhost/api/webhooks/paystack", {
    method: "POST",
    body: rawBody,
    headers: { "x-paystack-signature": createHmac("sha512", TEST_PAYSTACK_SECRET).update(rawBody).digest("hex") },
  });
}

/** Stubs the route's Verify Transaction `fetch()` and returns the spy so the test can count verifications. */
function stubVerifyTransaction(reference: string) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      status: true,
      message: "Verification successful",
      data: {
        id: 1,
        reference,
        status: "success",
        amount: EXPECTED_TOTAL_MINOR,
        currency: "NGN",
        channel: "card",
        paid_at: new Date().toISOString(),
        fees: 200_000,
      },
    }),
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const orderSelect = {
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
  cohort: { select: { id: true, title: true, startsAt: true, endsAt: true, deliveryMode: true } },
  enrolments: { select: { id: true, status: true, holdExpiresAt: true } },
} as const;

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before any dynamic import below (see file header).
  process.env.DATABASE_URL = testDb.url;
  process.env.PAYSTACK_SECRET_KEY = TEST_PAYSTACK_SECRET;
  process.env.PAYSTACK_SUBACCOUNT_CODE = "ACCT_fixture_subaccount";

  await seedPaystackNgnFeeScheduleFixture(testDb.prisma);

  const checkoutServiceModule = await import("@/server/services/checkout-service");
  POST = (await import("@/app/api/webhooks/paystack/route")).POST;

  checkoutService = checkoutServiceModule.createCheckoutService({
    db: {
      $transaction: (fn) => testDb.prisma.$transaction((tx) => fn(tx as unknown as CheckoutTxClient)),
    },
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = await testDb.prisma.order.findUnique({ where, select: orderSelect });
        if (!row) return null;
        const { enrolments, ...rest } = row;
        return { ...rest, enrolment: enrolments[0] ?? null };
      },
      findByReference: async ({ reference }: { reference: string }) => {
        const row = await testDb.prisma.order.findUnique({ where: { reference }, select: orderSelect });
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
      findMany: (args: { where: Record<string, unknown> }) =>
        testDb.prisma.paymentAttempt.findMany({
          where: args.where as never,
          select: { id: true, provider: true, providerIntentId: true, status: true },
        }),
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
        testDb.prisma.paymentAttempt.updateMany({ where: args.where as never, data: args.data as never }),
    } as never,
    user: {
      findUnique: (args: { where: { id: string } }) =>
        testDb.prisma.user.findUnique({ where: args.where, select: { email: true, emailVerified: true } }),
    } as never,
    stripe: {
      checkout: {
        sessions: {
          expire: async (id: string) => ({ id, status: "expired" }),
          create: async () => {
            throw new Error("Stripe is not exercised by this Paystack-only suite.");
          },
        },
      },
    },
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

/** A real seat hold and a real Paystack PaymentAttempt, ready for its charge.success event. */
async function seedOrderAndAttempt() {
  const { cohortId } = await seedPublishedCohortFixture(testDb.prisma, {
    capacity: 2,
    seatsTaken: 0,
    priceMinor: BASE_AMOUNT_MINOR,
    currency: "NGN",
    holdMinutes: 30,
  });
  const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
  const { orderId } = await checkoutService.startCheckout({ userId }, cohortId, "NGN");
  await checkoutService.initiatePaystackPayment({ userId }, orderId, FULL_CONSENT);
  const attempt = await testDb.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId, provider: "PAYSTACK" } });
  return { orderId, cohortId, reference: attempt.providerIntentId! };
}

describe("Paystack charge.success delivered ten times at once (NFR-03)", () => {
  it(
    "settles once: one SUCCEEDED attempt, one ACTIVE enrolment, one PROCESSED WebhookEvent, nine duplicates skipped",
    async () => {
      const { orderId, cohortId, reference } = await seedOrderAndAttempt();
      const seatsBefore = (await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })).seatsTaken;
      const verifySpy = stubVerifyTransaction(reference);
      const eventId = 9_150_012;
      const body = JSON.stringify({
        event: "charge.success",
        data: {
          id: eventId,
          reference,
          status: "success",
          amount: EXPECTED_TOTAL_MINOR,
          currency: "NGN",
          metadata: { orderId, enrolmentId: "unused-in-this-fixture" },
        },
      });

      const responses = await Promise.all(
        Array.from({ length: DELIVERIES }, () => POST(signedWebhookRequest(body))),
      );
      expect(responses.map((r) => r.status)).toEqual(Array(DELIVERIES).fill(200));

      // One WebhookEvent row for the event (the unique key), and it ends PROCESSED.
      const webhookRows = await testDb.prisma.webhookEvent.findMany({
        where: { provider: "PAYSTACK", providerEventId: String(eventId) },
      });
      expect(webhookRows).toHaveLength(1);
      expect(webhookRows[0].status).toBe("PROCESSED");

      // Only the first delivery reached processing; the other nine took the
      // duplicate path, which never calls the provider again.
      expect(verifySpy).toHaveBeenCalledTimes(1);

      const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe("PAID");

      const attempts = await testDb.prisma.paymentAttempt.findMany({ where: { orderId } });
      expect(attempts.filter((a) => a.status === "SUCCEEDED")).toHaveLength(1);

      const enrolments = await testDb.prisma.enrolment.findMany({ where: { orderId } });
      expect(enrolments).toHaveLength(1);
      expect(enrolments[0].status).toBe("ACTIVE");

      const paidEvents = (await testDb.prisma.domainEvent.findMany({ where: { type: "order.paid" } })).filter(
        (e) => (e.payload as Record<string, unknown>).orderId === orderId,
      );
      expect(paidEvents).toHaveLength(1);

      // The held seat converts to the enrolment; replays never take another seat.
      const seatsAfter = (await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })).seatsTaken;
      expect(seatsAfter).toBe(seatsBefore);
    },
    120_000,
  );
});
