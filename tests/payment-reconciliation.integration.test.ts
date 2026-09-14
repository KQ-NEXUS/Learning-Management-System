/**
 * Real-Postgres proof for `payment-reconciliation-service.ts` (PAY-07,
 * PAY-11, PAY-17) — idempotency, null-before-evidence, and variance handling
 * for the idempotent actual-settlement sweep, proven against a real
 * Testcontainers Postgres exactly like `tests/checkout-webhook.integration.test.ts`
 * proves the settlement spine itself.
 *
 * `payment-reconciliation-service.ts`'s own module scope constructs a
 * Prisma-backed `built` singleton at import time (it transitively imports
 * `@/server/db`, `checkout-webhook-system-service.ts`,
 * `domain-event-service.ts` and `audit-service.ts`) — this file therefore
 * takes NO static top-level import of it. It is imported dynamically inside
 * `beforeAll`, AFTER `process.env.DATABASE_URL` is pointed at the
 * Testcontainers instance, so every one of those transitive singletons binds
 * to the same container this file's own seed/assertion `PrismaClient`
 * (`testDb.prisma`) reads from and writes to.
 *
 * The provider lookup is ALWAYS injected (`lookupPaystackActualSettlement`/
 * `lookupStripeActualSettlement`) — no case in this file performs a real
 * Paystack or Stripe network call, per this plan's own instruction.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture } from "./support/cohort-fixtures";
import type {
  createReconcilePayments as CreateReconcilePaymentsFn,
  ActualSettlement,
} from "@/server/services/payment-reconciliation-service";
import type { writeDomainEvent as WriteDomainEventFn } from "@/server/services/domain-event-service";

type ReconcileDeps = Parameters<typeof CreateReconcilePaymentsFn>[0];

let testDb: TestDatabase;
let createReconcilePayments: typeof CreateReconcilePaymentsFn;
let writeDomainEvent: typeof WriteDomainEventFn;
let RECONCILIATION_ROUNDING_TOLERANCE_MINOR: number;

let refCounter = 0;
function uniqRef(): string {
  refCounter += 1;
  return `RECON-REF-${refCounter}`;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  ({ createReconcilePayments, RECONCILIATION_ROUNDING_TOLERANCE_MINOR } = await import(
    "@/server/services/payment-reconciliation-service"
  ));
  ({ writeDomainEvent } = await import("@/server/services/domain-event-service"));
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/**
 * Every case in this file shares ONE Testcontainers Postgres for the whole
 * file (starting a fresh container per `it` would be prohibitively slow).
 * `reconcilePayments`'s candidate query deliberately takes no caller-supplied
 * filter (it is an actorless sweep, by design) — a row a prior case left
 * un-reconciled on purpose (the provider-lookup-failure case) would
 * otherwise leak into a LATER case's candidate set and inflate its
 * `{ reconciled, failed }` counts. A full wipe between cases, in
 * dependency-safe order, is what makes each case's counts deterministic.
 */
afterEach(async () => {
  await testDb.prisma.domainEvent.deleteMany({});
  await testDb.prisma.auditEvent.deleteMany({});
  await testDb.prisma.enrolment.deleteMany({});
  await testDb.prisma.paymentAttempt.deleteMany({});
  await testDb.prisma.order.deleteMany({});
  await testDb.prisma.cohort.deleteMany({});
  await testDb.prisma.course.deleteMany({});
  await testDb.prisma.user.deleteMany({});
});

/** Seeds a Cohort/Order/PaymentAttempt graph shaped like a real settled
 *  checkout: Order.status = PAID, PaymentAttempt.status = SUCCEEDED,
 *  reconciledAt and all four actual-settlement columns NULL — exactly what
 *  `activateOrderAsSystem` leaves behind at webhook time (D-14). */
async function seedSucceededAttempt(args: {
  provider: "PAYSTACK" | "STRIPE";
  providerIntentId: string;
  currency: string;
  amountMinor: number;
  baseAmountMinor: number;
  platformFeeMinor: number;
  gatewayFeeEstimateMinor: number;
  schoolSettlementExpectedMinor: number;
  evidence?: Record<string, unknown>;
  withEnrolment?: boolean;
}): Promise<{ orderId: string; paymentAttemptId: string; enrolmentId: string | null }> {
  const { cohortId } = await seedCohortFixture(testDb.prisma, {
    currency: args.currency,
    priceMinor: args.baseAmountMinor,
  });
  const { userId } = await seedLearnerFixture(testDb.prisma);

  const order = await testDb.prisma.order.create({
    data: {
      reference: uniqRef(),
      userId,
      cohortId,
      amountMinor: args.amountMinor,
      currency: args.currency,
      status: "PAID",
      selectedProvider: args.provider,
      baseAmountMinor: args.baseAmountMinor,
      platformFeeMinor: args.platformFeeMinor,
      gatewayFeeEstimateMinor: args.gatewayFeeEstimateMinor,
      schoolSettlementExpectedMinor: args.schoolSettlementExpectedMinor,
      idempotencyKey: uniqRef(),
      paidAt: new Date(),
    },
    select: { id: true },
  });

  const attempt = await testDb.prisma.paymentAttempt.create({
    data: {
      orderId: order.id,
      provider: args.provider,
      providerIntentId: args.providerIntentId,
      amountMinor: args.amountMinor,
      currency: args.currency,
      status: "SUCCEEDED",
      idempotencyKey: uniqRef(),
      confirmedAt: new Date(),
      evidence: (args.evidence ?? {
        providerIntentId: args.providerIntentId,
        amountMinor: args.amountMinor,
        currency: args.currency,
        status: "paid",
      }) as never,
    },
    select: { id: true },
  });

  let enrolmentId: string | null = null;
  if (args.withEnrolment) {
    const enrolment = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      userId,
      status: "ACTIVE",
      orderId: order.id,
      activatedAt: new Date(),
    });
    enrolmentId = enrolment.enrolmentId;
  }

  return { orderId: order.id, paymentAttemptId: attempt.id, enrolmentId };
}

function buildDeps(overrides: Partial<ReconcileDeps> = {}): {
  deps: ReconcileDeps;
  auditCalls: Array<Record<string, unknown>>;
} {
  const auditCalls: Array<Record<string, unknown>> = [];
  const deps: ReconcileDeps = {
    paymentAttempt: testDb.prisma.paymentAttempt as unknown as ReconcileDeps["paymentAttempt"],
    order: testDb.prisma.order as unknown as ReconcileDeps["order"],
    audit: async (event) => {
      auditCalls.push(event);
    },
    writeEvent: writeDomainEvent,
    runInTransaction: (fn) =>
      testDb.prisma.$transaction((tx) => fn(tx as unknown as Parameters<typeof fn>[0])),
    lookupPaystackActualSettlement: vi.fn(async () => {
      throw new Error("lookupPaystackActualSettlement not stubbed for this test");
    }),
    lookupStripeActualSettlement: vi.fn(async () => {
      throw new Error("lookupStripeActualSettlement not stubbed for this test");
    }),
    ...overrides,
  };
  return { deps, auditCalls };
}

const PAYSTACK_SCHOOL_SETTLEMENT_ACTUAL = 45_000_000;
const PAYSTACK_GATEWAY_FEE_ACTUAL = 875_000;
const PAYSTACK_PLATFORM_GROSS_ACTUAL = 1_550_000; // amount - schoolSettlementActual

describe("reconcilePayments — real Postgres (PAY-07, PAY-11, PAY-17)", () => {
  it("directly after settlement, all four actual-settlement columns and reconciledAt read NULL", async () => {
    const { paymentAttemptId } = await seedSucceededAttempt({
      provider: "PAYSTACK",
      providerIntentId: uniqRef(),
      currency: "NGN",
      amountMinor: 46_550_000,
      baseAmountMinor: 45_000_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 875_000,
      schoolSettlementExpectedMinor: 45_000_000,
    });

    const attempt = await testDb.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: paymentAttemptId },
    });

    expect(attempt.gatewayFeeActualMinor).toBeNull();
    expect(attempt.schoolSettlementActualMinor).toBeNull();
    expect(attempt.platformGrossActualMinor).toBeNull();
    expect(attempt.platformNetActualMinor).toBeNull();
    expect(attempt.reconciledAt).toBeNull();
  });

  it("a sweep over a SUCCEEDED Paystack attempt with verified evidence writes all four actual columns and reconciledAt, with platformNetActualMinor = gross - fee", async () => {
    const { orderId, paymentAttemptId } = await seedSucceededAttempt({
      provider: "PAYSTACK",
      providerIntentId: uniqRef(),
      currency: "NGN",
      amountMinor: 46_550_000,
      baseAmountMinor: 45_000_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 875_000,
      schoolSettlementExpectedMinor: PAYSTACK_SCHOOL_SETTLEMENT_ACTUAL,
    });

    const actual: ActualSettlement = {
      gatewayFeeActualMinor: PAYSTACK_GATEWAY_FEE_ACTUAL,
      schoolSettlementActualMinor: PAYSTACK_SCHOOL_SETTLEMENT_ACTUAL,
      platformGrossActualMinor: PAYSTACK_PLATFORM_GROSS_ACTUAL,
    };
    const { deps, auditCalls } = buildDeps({
      lookupPaystackActualSettlement: vi.fn(async () => actual),
    });

    const result = await createReconcilePayments(deps).reconcilePayments(10);

    expect(result).toEqual({ reconciled: 1, failed: 0 });

    const attempt = await testDb.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: paymentAttemptId },
    });
    expect(attempt.gatewayFeeActualMinor).toBe(PAYSTACK_GATEWAY_FEE_ACTUAL);
    expect(attempt.schoolSettlementActualMinor).toBe(PAYSTACK_SCHOOL_SETTLEMENT_ACTUAL);
    expect(attempt.platformGrossActualMinor).toBe(PAYSTACK_PLATFORM_GROSS_ACTUAL);
    expect(attempt.platformNetActualMinor).toBe(
      PAYSTACK_PLATFORM_GROSS_ACTUAL - PAYSTACK_GATEWAY_FEE_ACTUAL,
    );
    expect(attempt.reconciledAt).not.toBeNull();
    expect(attempt.exceptionNote).toBeNull();

    // Never touches the Order's own commercial snapshot or its PAID status.
    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.amountMinor).toBe(46_550_000);
    expect(order.baseAmountMinor).toBe(45_000_000);
    expect(order.platformFeeMinor).toBe(675_000);

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ actorId: null, actorType: "SYSTEM", outcome: "SUCCESS" });
  });

  it("a sweep over a SUCCEEDED Stripe attempt with verified evidence writes all four actual columns and reconciledAt", async () => {
    const paymentIntentId = `pi_${uniqRef()}`;
    const sessionId = `cs_${uniqRef()}`; // the Checkout Session id — never the Stripe lookup key
    const { paymentAttemptId } = await seedSucceededAttempt({
      provider: "STRIPE",
      providerIntentId: sessionId,
      currency: "USD",
      amountMinor: 51_330,
      baseAmountMinor: 50_000,
      platformFeeMinor: 750,
      gatewayFeeEstimateMinor: 580,
      schoolSettlementExpectedMinor: 50_000,
      evidence: {
        providerIntentId: sessionId,
        amountMinor: 51_330,
        currency: "USD",
        status: "paid",
        paymentIntentId,
        chargeId: `ch_${uniqRef()}`,
        transferId: `tr_${uniqRef()}`,
        transferDestination: "acct_test_connected",
      },
    });

    // Matches the seeded expected figures exactly (zero variance) — this
    // case proves the Stripe evidence path writes all four columns
    // correctly; the dedicated variance case below (Paystack) exercises the
    // tolerance/exception-note logic.
    const actual: ActualSettlement = {
      gatewayFeeActualMinor: 580,
      schoolSettlementActualMinor: 50_000,
      platformGrossActualMinor: 1_330,
    };
    const lookupStripeActualSettlement = vi.fn(async () => actual);
    const { deps } = buildDeps({ lookupStripeActualSettlement });

    const result = await createReconcilePayments(deps).reconcilePayments(10);

    expect(result).toEqual({ reconciled: 1, failed: 0 });
    expect(lookupStripeActualSettlement).toHaveBeenCalledWith(paymentIntentId);

    const attempt = await testDb.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: paymentAttemptId },
    });
    expect(attempt.gatewayFeeActualMinor).toBe(580);
    expect(attempt.schoolSettlementActualMinor).toBe(50_000);
    expect(attempt.platformGrossActualMinor).toBe(1_330);
    expect(attempt.platformNetActualMinor).toBe(1_330 - 580);
    expect(attempt.reconciledAt).not.toBeNull();
    expect(attempt.exceptionNote).toBeNull();
  });

  it("a second sweep over an already-reconciled attempt writes nothing new, changes no stored value, and emits no second audit event", async () => {
    const { paymentAttemptId } = await seedSucceededAttempt({
      provider: "PAYSTACK",
      providerIntentId: uniqRef(),
      currency: "NGN",
      amountMinor: 46_550_000,
      baseAmountMinor: 45_000_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 875_000,
      schoolSettlementExpectedMinor: PAYSTACK_SCHOOL_SETTLEMENT_ACTUAL,
    });

    const actual: ActualSettlement = {
      gatewayFeeActualMinor: PAYSTACK_GATEWAY_FEE_ACTUAL,
      schoolSettlementActualMinor: PAYSTACK_SCHOOL_SETTLEMENT_ACTUAL,
      platformGrossActualMinor: PAYSTACK_PLATFORM_GROSS_ACTUAL,
    };
    const lookupPaystackActualSettlement = vi.fn(async () => actual);
    const { deps: firstDeps } = buildDeps({ lookupPaystackActualSettlement });
    const firstResult = await createReconcilePayments(firstDeps).reconcilePayments(10);
    expect(firstResult).toEqual({ reconciled: 1, failed: 0 });

    const before = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: paymentAttemptId } });

    // A brand-new sweep instance (mirrors a fresh scheduled-function
    // invocation) — the candidate query itself already excludes a row with
    // reconciledAt set, so the lookup must never even be called again.
    const { deps: secondDeps, auditCalls: secondAuditCalls } = buildDeps({
      lookupPaystackActualSettlement,
    });
    const secondResult = await createReconcilePayments(secondDeps).reconcilePayments(10);
    expect(secondResult).toEqual({ reconciled: 0, failed: 0 });
    expect(lookupPaystackActualSettlement).toHaveBeenCalledTimes(1); // not called again
    expect(secondAuditCalls).toHaveLength(0); // no second audit event

    const after = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: paymentAttemptId } });
    expect(after).toEqual(before); // byte-identical — nothing changed
  });

  it("an attempt whose provider lookup fails is left entirely untouched — reconciledAt stays NULL for the next invocation to retry", async () => {
    const { paymentAttemptId } = await seedSucceededAttempt({
      provider: "PAYSTACK",
      providerIntentId: uniqRef(),
      currency: "NGN",
      amountMinor: 46_550_000,
      baseAmountMinor: 45_000_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 875_000,
      schoolSettlementExpectedMinor: 45_000_000,
    });

    const before = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: paymentAttemptId } });

    const { deps, auditCalls } = buildDeps({
      lookupPaystackActualSettlement: vi.fn(async () => {
        throw new Error("Paystack has not yet reported final settlement figures.");
      }),
    });
    const result = await createReconcilePayments(deps).reconcilePayments(10);

    expect(result).toEqual({ reconciled: 0, failed: 1 });
    expect(auditCalls).toHaveLength(0);

    const after = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: paymentAttemptId } });
    expect(after).toEqual(before);
    expect(after.reconciledAt).toBeNull();
  });

  it("an actual school settlement beyond the rounding tolerance is flagged with an exception note naming both figures, and the Order's commercial columns stay byte-identical; Order.status stays PAID and the Enrolment is untouched", async () => {
    const schoolSettlementExpectedMinor = 45_000_000;
    // Comfortably beyond RECONCILIATION_ROUNDING_TOLERANCE_MINOR (1).
    const schoolSettlementActualMinor = schoolSettlementExpectedMinor - 5_000;

    const { orderId, paymentAttemptId, enrolmentId } = await seedSucceededAttempt({
      provider: "PAYSTACK",
      providerIntentId: uniqRef(),
      currency: "NGN",
      amountMinor: 46_550_000,
      baseAmountMinor: 45_000_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 875_000,
      schoolSettlementExpectedMinor,
      withEnrolment: true,
    });

    const orderBefore = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const enrolmentBefore = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId! } });

    const actual: ActualSettlement = {
      gatewayFeeActualMinor: PAYSTACK_GATEWAY_FEE_ACTUAL,
      schoolSettlementActualMinor,
      platformGrossActualMinor: 46_550_000 - schoolSettlementActualMinor,
    };
    const { deps, auditCalls } = buildDeps({
      lookupPaystackActualSettlement: vi.fn(async () => actual),
    });

    const result = await createReconcilePayments(deps).reconcilePayments(10);
    expect(result).toEqual({ reconciled: 1, failed: 0 });

    const attempt = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: paymentAttemptId } });
    expect(attempt.reconciledAt).not.toBeNull();
    expect(attempt.exceptionNote).not.toBeNull();
    expect(attempt.exceptionNote).toContain(String(schoolSettlementActualMinor));
    expect(attempt.exceptionNote).toContain(String(schoolSettlementExpectedMinor));

    // The historical Order is never rewritten (D-13/D-18) — byte-identical.
    const orderAfter = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter).toEqual(orderBefore);
    expect(orderAfter.status).toBe("PAID");

    // The Enrolment is never touched by a reconciliation variance.
    const enrolmentAfter = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId! } });
    expect(enrolmentAfter).toEqual(enrolmentBefore);

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ action: "payment.reconciliation_exception", outcome: "SUCCESS" });
  });

  it("respects an arbitrary batchLimit and returns {reconciled, failed} counts, leaving the remainder for a later invocation", async () => {
    const seeds = await Promise.all(
      [0, 1, 2].map(() =>
        seedSucceededAttempt({
          provider: "PAYSTACK",
          providerIntentId: uniqRef(),
          currency: "NGN",
          amountMinor: 46_550_000,
          baseAmountMinor: 45_000_000,
          platformFeeMinor: 675_000,
          gatewayFeeEstimateMinor: 875_000,
          schoolSettlementExpectedMinor: PAYSTACK_SCHOOL_SETTLEMENT_ACTUAL,
        }),
      ),
    );

    const actual: ActualSettlement = {
      gatewayFeeActualMinor: PAYSTACK_GATEWAY_FEE_ACTUAL,
      schoolSettlementActualMinor: PAYSTACK_SCHOOL_SETTLEMENT_ACTUAL,
      platformGrossActualMinor: PAYSTACK_PLATFORM_GROSS_ACTUAL,
    };
    const { deps } = buildDeps({ lookupPaystackActualSettlement: vi.fn(async () => actual) });

    const result = await createReconcilePayments(deps).reconcilePayments(2);
    expect(result.reconciled).toBe(2);
    expect(result.failed).toBe(0);

    const rows = await testDb.prisma.paymentAttempt.findMany({
      where: { id: { in: seeds.map((s) => s.paymentAttemptId) } },
      select: { reconciledAt: true },
    });
    const reconciledCount = rows.filter((r) => r.reconciledAt !== null).length;
    expect(reconciledCount).toBe(2); // exactly the batch limit, not all 3
  });

  it("exposes RECONCILIATION_ROUNDING_TOLERANCE_MINOR as a small positive integer", () => {
    expect(RECONCILIATION_ROUNDING_TOLERANCE_MINOR).toBeGreaterThan(0);
    expect(Number.isInteger(RECONCILIATION_ROUNDING_TOLERANCE_MINOR)).toBe(true);
  });
});
