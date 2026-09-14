/**
 * Real-Postgres proof for component-aware refunds (PAY-05, PAY-13, D-22) —
 * the property the unit test (`tests/refund-service.test.ts`) cannot prove
 * with an in-memory fake `db.$transaction`: that the Order-row lock
 * (`SELECT ... FOR UPDATE`, `RefundTxClient#lockOrder`) genuinely serializes
 * two concurrent refund requests against the SAME Order, so together they
 * never exceed the eligible captured value — and that two SEQUENTIAL partial
 * refunds summing to the learner total are permitted while a third of any
 * positive amount is refused, reading the running total from real committed
 * rows rather than an in-memory array.
 *
 * `recordRefund` is built directly from `createRefundService`/
 * `createPrismaBackedRefundService` against the real Testcontainers Prisma
 * client — the provider network call itself is faked (this file makes no
 * real Paystack/Stripe request, per this plan's own instruction), but every
 * read, lock and write below is real Postgres.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — never a silent
 * pass, never a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedLearnerFixture, seedPaystackNgnFeeScheduleFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import { createRefundService, type RefundServiceDeps, type RefundTxClient } from "@/server/services/refund-service";
import { calculateCheckoutBreakdown, type GatewayFeeScheduleValues } from "@/server/payments/pricing";

let testDb: TestDatabase;

const NGN_SCHEDULE: GatewayFeeScheduleValues = {
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
const BREAKDOWN = calculateCheckoutBreakdown({ baseAmountMinor: BASE_AMOUNT_MINOR, schedule: NGN_SCHEDULE });

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seedPaystackNgnFeeScheduleFixture(testDb.prisma);
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/**
 * Seeds a cohort, a paid Order, and a SUCCEEDED PAYSTACK `PaymentAttempt`
 * directly via the real Prisma client — this file is about the refund cap
 * and lock, not about proving settlement itself (already proven end to end
 * by `tests/paystack-webhook.integration.test.ts` and
 * `tests/manual-payment.integration.test.ts`), so the paid precondition is
 * arranged directly rather than re-run through the full checkout+webhook
 * flow.
 */
async function seedPaidOrder(): Promise<{ orderId: string; attemptId: string }> {
  const { cohortId } = await seedCohortFixture(testDb.prisma, {
    priceNgnMinor: BASE_AMOUNT_MINOR,
    priceUsdMinor: null,
    currency: "NGN",
  });
  const { userId } = await seedLearnerFixture(testDb.prisma);

  const order = await testDb.prisma.order.create({
    data: {
      reference: `ORD-REFUND-${Math.random().toString(36).slice(2)}`,
      userId,
      cohortId,
      amountMinor: BREAKDOWN.totalAmountMinor,
      currency: "NGN",
      status: "PAID",
      selectedProvider: "PAYSTACK",
      baseAmountMinor: BREAKDOWN.baseAmountMinor,
      platformFeeMinor: BREAKDOWN.platformFeeMinor,
      gatewayFeeEstimateMinor: BREAKDOWN.gatewayFeeEstimateMinor,
      schoolSettlementExpectedMinor: BREAKDOWN.baseAmountMinor,
      idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
      paidAt: new Date(),
    },
    select: { id: true },
  });

  const attempt = await testDb.prisma.paymentAttempt.create({
    data: {
      orderId: order.id,
      provider: "PAYSTACK",
      providerIntentId: `PSK-${order.id}`,
      amountMinor: BREAKDOWN.totalAmountMinor,
      currency: "NGN",
      status: "SUCCEEDED",
      idempotencyKey: `pa-idem-${Math.random().toString(36).slice(2)}`,
      confirmedAt: new Date(),
    },
    select: { id: true },
  });

  return { orderId: order.id, attemptId: attempt.id };
}

/**
 * A `createRefundService` instance backed by the REAL Testcontainers Prisma
 * client for order/refund reads, writes and the row lock — provider calls
 * are faked. `actorId` MUST be a real seeded `User` id: `AuditEvent.actorId`
 * carries a real foreign key against `User` in this schema, and
 * `createTestWithPermission`'s own default (`"user-1"`) does not exist as a
 * row here, unlike the in-memory fakes in `tests/refund-service.test.ts`.
 */
function realService(
  actorId: string,
  opts?: { paystackOutcome?: { id: number; status: string; amount: number; currency: string } },
) {
  const { withPermission } = createTestWithPermission([grant("refunds.manage")], { userId: actorId });
  const deps: RefundServiceDeps = {
    db: {
      $transaction: (fn) =>
        testDb.prisma.$transaction(async (tx) => {
          const client: RefundTxClient = {
            lockOrder: async ({ orderId }) => {
              const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
                SELECT "id", "currency", "amountMinor", "baseAmountMinor", "platformFeeMinor", "gatewayFeeEstimateMinor"
                FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
              `;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (rows[0] as any) ?? null;
            },
            paymentAttempt: {
              findFirst: (args) =>
                tx.paymentAttempt.findFirst({
                  where: args.where as never,
                  orderBy: args.orderBy as never,
                  select: { id: true, provider: true, providerIntentId: true },
                }) as never,
            },
            refund: {
              aggregateRefundedMinor: async (orderId) => {
                const rows = await tx.refund.findMany({
                  where: { orderId, status: { not: "FAILED" } },
                  select: { amountMinor: true },
                });
                return rows.reduce((sum, row) => sum + row.amountMinor, 0);
              },
              create: (args) => tx.refund.create({ data: args.data as never, select: { id: true } }),
            },
          };
          return fn(client);
        }),
    },
    refund: {
      update: (args) => testDb.prisma.refund.update({ where: args.where as never, data: args.data as never }),
    },
    order: {
      update: (args) => testDb.prisma.order.update({ where: args.where as never, data: args.data as never }),
    },
    paystackRefund: async () => opts?.paystackOutcome ?? { id: 1, status: "processed", amount: 0, currency: "NGN" },
    stripeRefund: async () => ({ id: "re_test", status: "succeeded", amount: 0, currency: "usd" }),
    orderScope: async () => ({}),
    withPermission,
    audit: async (event) =>
      testDb.prisma.auditEvent
        .create({
          data: {
            actorId: event.actorId,
            actorType: event.actorType ?? "USER",
            action: event.action,
            targetType: event.targetType,
            targetId: event.targetId ?? null,
            reason: event.reason ?? null,
            outcome: event.outcome,
          },
        })
        .then(() => undefined),
  };
  return createRefundService(deps);
}

describe("recordRefund — real Postgres eligible-value cap (PAY-05, D-22)", () => {
  it("permits two sequential partial refunds summing to the learner total, then refuses a third positive amount", async () => {
    const { orderId } = await seedPaidOrder();
    const { userId: staffUserId } = await seedLearnerFixture(testDb.prisma);
    const service = realService(staffUserId);
    const half = Math.floor(BREAKDOWN.totalAmountMinor / 2);
    const remainder = BREAKDOWN.totalAmountMinor - half;

    const first = await service.recordRefund({
      orderId,
      amountMinor: half,
      reason: "First partial refund.",
      accessDecision: "RETAINED",
    });
    expect(first.status).toBe("COMPLETED");

    const second = await service.recordRefund({
      orderId,
      amountMinor: remainder,
      reason: "Second partial refund, exhausts the balance.",
      accessDecision: "RETAINED",
    });
    expect(second.status).toBe("COMPLETED");

    const orderAfter = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter.status).toBe("REFUNDED");

    await expect(
      service.recordRefund({
        orderId,
        amountMinor: 1,
        reason: "A third refund of any positive amount.",
        accessDecision: "RETAINED",
      }),
    ).rejects.toThrow(/exceeds the eligible captured value/);

    const refunds = await testDb.prisma.refund.findMany({ where: { orderId } });
    expect(refunds).toHaveLength(2);
  }, 30_000);

  it("serializes two CONCURRENT refund requests against the same Order — together they never exceed the eligible captured value", async () => {
    const { orderId } = await seedPaidOrder();
    const { userId: staffUserIdA } = await seedLearnerFixture(testDb.prisma);
    const { userId: staffUserIdB } = await seedLearnerFixture(testDb.prisma);
    const serviceA = realService(staffUserIdA);
    const serviceB = realService(staffUserIdB);
    const half = Math.floor(BREAKDOWN.totalAmountMinor / 2) + 1; // two of these together exceed the total by 1

    const outcomes = await Promise.allSettled([
      serviceA.recordRefund({
        orderId,
        amountMinor: half,
        reason: "Concurrent refund request A.",
        accessDecision: "RETAINED",
      }),
      serviceB.recordRefund({
        orderId,
        amountMinor: half,
        reason: "Concurrent refund request B.",
        accessDecision: "RETAINED",
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    // The lock on the Order row serializes the two — exactly one succeeds,
    // the other is refused for exceeding the (now-reduced) eligible value.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const refunds = await testDb.prisma.refund.findMany({ where: { orderId, status: { not: "FAILED" } } });
    const totalRefundedMinor = refunds.reduce((sum, r) => sum + r.amountMinor, 0);
    expect(totalRefundedMinor).toBeLessThanOrEqual(BREAKDOWN.totalAmountMinor);
    expect(totalRefundedMinor).toBe(half);
  }, 30_000);
});

describe("recordRefund — real Postgres component allocation and access decision", () => {
  it("a full refund's components sum exactly to the refunded amount, stored against real Postgres", async () => {
    const { orderId } = await seedPaidOrder();
    const { userId: staffUserId } = await seedLearnerFixture(testDb.prisma);
    const service = realService(staffUserId);

    const result = await service.recordRefund({
      orderId,
      amountMinor: BREAKDOWN.totalAmountMinor,
      reason: "Full refund — cohort cancelled.",
      accessDecision: "REVOKED",
    });

    expect(result.status).toBe("COMPLETED");
    const row = await testDb.prisma.refund.findUniqueOrThrow({ where: { id: result.id } });
    expect(
      (row.baseComponentMinor ?? 0) + (row.platformComponentMinor ?? 0) + (row.gatewayComponentMinor ?? 0),
    ).toBe(BREAKDOWN.totalAmountMinor);
    expect(row.accessDecision).toBe("REVOKED");
    expect(row.status).toBe("COMPLETED");
  }, 30_000);
});
