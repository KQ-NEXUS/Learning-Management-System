/**
 * Real-Postgres proof of the D-08 payment rule in restricted continuity mode
 * (Phase 14, plan 14-13; LIC-05, LIC-08, OQ4, A13, T-14-13-01..06).
 *
 * A licence is activated through the real activation service so that its
 * graceEndsAt R is the restriction instant. The settlement service
 * (`createActivateOrderAsSystem`) is built over the Testcontainers client with
 * `licence` set to a real `createLicenceService` instance whose injected clock
 * stands after R. Orders, enrolments and payment attempts are inserted
 * directly with explicit `createdAt` and `initiatedAt` values so ordering is
 * deterministic.
 *
 * Nothing here touches the configured DATABASE_URL: `process.env.DATABASE_URL`
 * is pointed at the container BEFORE the settlement module is imported
 * dynamically (it constructs the `@/server/db` singleton at load), and every
 * service instance is injected with `testDb.prisma` explicitly.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error:
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, SKEW_TOLERANCE_MS } from "@/server/licence/constants";
import { LicenceWriteBlockedError } from "@/server/licence/errors";
import type { TrustSet } from "@/server/licence/trust-set";
import { calculateCheckoutBreakdown, calculatePlatformFeeMinor, type GatewayFeeScheduleValues } from "@/server/payments/pricing";
import { recordAuditInTransaction } from "@/server/services/audit-service";
import { createLicenceActivationService } from "@/server/services/licence-activation-service";
import { createLicenceService, type LicenceDbClient } from "@/server/services/licence-service";
import { LicenceRestrictedError } from "@/server/permissions/with-permission";
import { assertOrderAccessRevocable, revokeAccessForOrder } from "@/server/services/enrolment-service";
import { createRefundService, type RefundServiceDeps, type RefundTxClient } from "@/server/services/refund-service";
import { createPrismaBackedReconciliationCaseService } from "@/server/services/reconciliation-case-service";
import {
  createFixtureKey,
  FIXTURE_DEPLOYMENT_ID,
  FIXTURE_NOW,
  fixtureTrustSet,
  mintLicence,
} from "./support/licence-fixtures";
import { LICENCE_STATE_ID, resetLicenceTables, setDeploymentId } from "./support/licence-db";
import { seedEnrolmentFixture, seedLearnerFixture, seedPublishedCohortFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

type SettlementModule = typeof import("@/server/services/checkout-webhook-system-service");
type SettlementDeps = import("@/server/services/checkout-webhook-system-service").SettlementDeps;
type SettlementTxClient = import("@/server/services/checkout-webhook-system-service").SettlementTxClient;

let testDb: TestDatabase;
let settlement: SettlementModule;
let activatorId: string;

const key = createFixtureKey("payments-key");
const trustSet: TrustSet = fixtureTrustSet([key]);

const BASE_AMOUNT_MINOR = 45_000_000;
const PLATFORM_FEE_MINOR = calculatePlatformFeeMinor(BASE_AMOUNT_MINOR);
const MANUAL_TOTAL_MINOR = BASE_AMOUNT_MINOR + PLATFORM_FEE_MINOR;

/** R: the restriction instant (graceEndsAt of the default fixture licence). */
const R = new Date(FIXTURE_NOW.getTime() + 104 * DAY_MS);
const at = (offsetMs: number) => new Date(R.getTime() + offsetMs);

beforeAll(async () => {
  testDb = await startTestDatabase();
  // MUST precede the dynamic import below: the settlement module's `@/server/db`
  // singleton reads DATABASE_URL when first evaluated. Every service here is
  // also injected with testDb.prisma, so the singleton is never queried.
  process.env.DATABASE_URL = testDb.url;
  settlement = await import("@/server/services/checkout-webhook-system-service");
  activatorId = (
    await testDb.prisma.user.create({
      data: {
        email: "payments-activator@licence-payments.test",
        name: "Payments Activator",
        status: "ACTIVE",
        emailVerified: new Date(),
        isStaff: true,
      },
    })
  ).id;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

beforeEach(async () => {
  await testDb.prisma
    .$executeRaw`INSERT INTO "DeploymentIdentity" ("id") VALUES ('deployment') ON CONFLICT DO NOTHING`;
  await testDb.prisma
    .$executeRaw`INSERT INTO "LicenceState" ("id", "highWaterAt", "updatedAt") VALUES ('current', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
  await resetLicenceTables(testDb.prisma);
  await setDeploymentId(testDb.prisma, FIXTURE_DEPLOYMENT_ID);
  await testDb.prisma.licenceState.update({
    where: { id: LICENCE_STATE_ID },
    data: { highWaterAt: FIXTURE_NOW },
  });
  await testDb.prisma.auditEvent.deleteMany({ where: { action: { startsWith: "licence." } } });
});

function makeClock(initial: Date) {
  let ms = initial.getTime();
  return {
    now: () => new Date(ms),
    set(next: Date) {
      ms = next.getTime();
    },
  };
}
type Clock = ReturnType<typeof makeClock>;

const silent = () => undefined;

function makeLicenceService(clock: Clock, db: LicenceDbClient = testDb.prisma) {
  return createLicenceService({
    db,
    trustSet: () => trustSet,
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    now: clock.now,
    monotonicNow: () => 0,
    log: silent,
  });
}

/** Activates the default fixture licence (graceEndsAt is R) at FIXTURE_NOW. */
async function activateLicence(): Promise<Date> {
  const minted = mintLicence({ key });
  const clock = makeClock(FIXTURE_NOW);
  const activation = createLicenceActivationService({
    db: testDb.prisma,
    trustSet: () => trustSet,
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    auditInTransaction: (tx, event) => recordAuditInTransaction(tx, event),
    now: clock.now,
  });
  const result = await activation.activateLicence({ actorId: activatorId, raw: minted.raw });
  expect(result.ok).toBe(true);
  const graceEndsAt = new Date((minted.payload as { graceEndsAt: string }).graceEndsAt);
  expect(graceEndsAt.getTime()).toBe(R.getTime());
  return graceEndsAt;
}

let seq = 0;

type SeededOrder = {
  orderId: string;
  cohortId: string;
  enrolmentId: string;
  attemptId: string | null;
  providerIntentId: string;
  seatsBefore: number;
};

/**
 * Inserts a cohort holding one seat, a learner, a PENDING order with an
 * explicit createdAt, its PENDING_PAYMENT enrolment, and (unless `manual`) a
 * PROCESSING PAYSTACK attempt with an explicit initiatedAt.
 */
async function seedPendingOrder(args: {
  orderCreatedAt: Date;
  attemptInitiatedAt?: Date;
  manual?: boolean;
}): Promise<SeededOrder> {
  seq += 1;
  const tag = `${Date.now()}-${seq}`;
  const { cohortId } = await seedPublishedCohortFixture(testDb.prisma, {
    capacity: 2,
    seatsTaken: 1,
    priceMinor: BASE_AMOUNT_MINOR,
    currency: "NGN",
    holdMinutes: 30,
  });
  const { userId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
  const order = await testDb.prisma.order.create({
    data: {
      reference: `KQO-LP-${tag}`,
      userId,
      cohortId,
      amountMinor: args.manual ? MANUAL_TOTAL_MINOR : BASE_AMOUNT_MINOR,
      currency: "NGN",
      status: "PENDING",
      selectedProvider: "PAYSTACK",
      baseAmountMinor: BASE_AMOUNT_MINOR,
      platformFeeMinor: PLATFORM_FEE_MINOR,
      gatewayFeeEstimateMinor: 0,
      schoolSettlementExpectedMinor: BASE_AMOUNT_MINOR,
      idempotencyKey: `idem-lp-${tag}`,
      createdAt: args.orderCreatedAt,
    },
    select: { id: true },
  });
  const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
    cohortId,
    userId,
    status: "PENDING_PAYMENT",
    holdExpiresAt: new Date(Date.now() + 30 * 60_000),
    orderId: order.id,
  });
  const providerIntentId = `PSK-LP-${tag}`;
  let attemptId: string | null = null;
  if (!args.manual) {
    attemptId = (
      await testDb.prisma.paymentAttempt.create({
        data: {
          orderId: order.id,
          provider: "PAYSTACK",
          providerIntentId,
          amountMinor: BASE_AMOUNT_MINOR,
          currency: "NGN",
          status: "PROCESSING",
          idempotencyKey: `pa-idem-lp-${tag}`,
          initiatedAt: args.attemptInitiatedAt ?? args.orderCreatedAt,
        },
        select: { id: true },
      })
    ).id;
  }
  return {
    orderId: order.id,
    cohortId,
    enrolmentId,
    attemptId,
    providerIntentId,
    seatsBefore: 1,
  };
}

/** Settlement deps over the container, with a real licence service on `clock`. */
function buildDeps(licence: SettlementDeps["licence"]): SettlementDeps {
  const reconciliation = createPrismaBackedReconciliationCaseService(
    testDb.prisma,
    (() => () => async () => {
      throw new Error("Request authorization is unavailable in this test.");
    }) as never,
    { audit: (event) => recordAuditInTransaction(testDb.prisma, event) },
  );
  return {
    db: {
      $transaction: (fn, options) =>
        testDb.prisma.$transaction((tx) => fn(tx as unknown as SettlementTxClient), options),
    },
    audit: (event) => recordAuditInTransaction(testDb.prisma, event).then(() => undefined),
    syncOrderReconciliationEvidence: reconciliation.syncOrderEvidenceAsSystem,
    correlateReconciliationEvidence: reconciliation.correlateOperationalEvidenceAsSystem,
    licence,
  };
}

function webhookInput(seeded: SeededOrder, suffix = "") {
  return {
    orderId: seeded.orderId,
    provider: "PAYSTACK" as const,
    providerIntentId: seeded.providerIntentId,
    amountMinor: BASE_AMOUNT_MINOR,
    currency: "NGN",
    eventId: `evt-lp-${seeded.orderId}${suffix}`,
  };
}

function manualInput(seeded: SeededOrder) {
  return {
    orderId: seeded.orderId,
    provider: "MANUAL" as const,
    providerIntentId: `BANK-${seeded.orderId}`,
    providerRef: `BANK-${seeded.orderId}`,
    amountMinor: MANUAL_TOTAL_MINOR,
    currency: "NGN",
    eventId: `manual:${seeded.orderId}:ref`,
    manualConfirmation: {
      confirmedById: activatorId,
      manualChannel: "bank_transfer",
      manualReference: `BANK-${seeded.orderId}`,
      manualPaidAt: new Date("2026-10-01T10:00:00Z"),
      manualEvidenceKey: `evidence/${seeded.orderId}.pdf`,
      reason: "Matched against the school bank statement.",
    },
  };
}

async function orderExceptionEvents(orderId: string) {
  const rows = await testDb.prisma.domainEvent.findMany({ where: { type: "order.exception" } });
  return rows.filter((row) => (row.payload as { orderId?: string }).orderId === orderId);
}

async function expectUntouched(seeded: SeededOrder) {
  const enrolment = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: seeded.enrolmentId } });
  expect(enrolment.status).toBe("PENDING_PAYMENT");
  expect(enrolment.activatedAt).toBeNull();
  const cohort = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: seeded.cohortId } });
  expect(cohort.seatsTaken).toBe(seeded.seatsBefore);
}

describe("Phase 14 D-08 payment rule: before the restriction instant", () => {
  it("before: an attempt initiated two hours before R completes with its entitlement after R (tracer)", async () => {
    const graceEndsAt = await activateLicence();
    const clock = makeClock(at(60 * 60_000));
    const licence = makeLicenceService(clock);

    // The cutoff the settlement reads equals graceEndsAt exactly.
    const cutoff = await licence.getRestrictionCutoff();
    expect(cutoff.restricted).toBe(true);
    expect(cutoff.restrictedAt?.getTime()).toBe(graceEndsAt.getTime());

    const seeded = await seedPendingOrder({
      orderCreatedAt: at(-3 * 60 * 60_000),
      attemptInitiatedAt: at(-2 * 60 * 60_000),
    });
    const result = await settlement.createActivateOrderAsSystem(buildDeps(licence))(webhookInput(seeded));

    expect(result.outcome).toBe("ACTIVATED");
    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: seeded.orderId } });
    expect(order.status).toBe("PAID");
    const enrolment = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: seeded.enrolmentId } });
    expect(enrolment.status).toBe("ACTIVE");
    const attempt = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: seeded.attemptId! } });
    expect(attempt.status).toBe("SUCCEEDED");
    expect(await orderExceptionEvents(seeded.orderId)).toEqual([]);
  }, 60_000);
});

describe("Phase 14 D-08 payment rule: in-flight expiry", () => {
  it("in-flight expiry: an attempt created one minute before R, while the guard still allowed new sessions, settles after R and activates", async () => {
    await activateLicence();
    const clock = makeClock(at(-60_000));
    const licence = makeLicenceService(clock);

    // One minute before R the guard still allows a new checkout session ...
    await expect(licence.assertWriteAllowed({ operation: "checkout.initiate_paystack", actorId: null })).resolves.toBeUndefined();
    const seeded = await seedPendingOrder({
      orderCreatedAt: clock.now(),
      attemptInitiatedAt: clock.now(),
    });

    // ... and after R it refuses a new one, but the in-flight payment completes.
    clock.set(at(5 * 60_000));
    await expect(
      licence.assertWriteAllowed({ operation: "checkout.initiate_paystack", actorId: null }),
    ).rejects.toBeInstanceOf(LicenceWriteBlockedError);

    const result = await settlement.createActivateOrderAsSystem(buildDeps(licence))(webhookInput(seeded));
    expect(result.outcome).toBe("ACTIVATED");
    expect((await testDb.prisma.order.findUniqueOrThrow({ where: { id: seeded.orderId } })).status).toBe("PAID");
    expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: seeded.enrolmentId } })).status).toBe("ACTIVE");
  }, 60_000);
});

describe("Phase 14 D-08 payment rule: tolerance boundary", () => {
  it("tolerance boundary: R plus 10 minutes activates, R plus 10 minutes plus 1 ms becomes the recorded-money exception with nothing else changed", async () => {
    await activateLicence();
    const licence = makeLicenceService(makeClock(at(2 * 60 * 60_000)));
    const run = settlement.createActivateOrderAsSystem(buildDeps(licence));

    const onBoundary = await seedPendingOrder({
      orderCreatedAt: at(-60_000),
      attemptInitiatedAt: at(SKEW_TOLERANCE_MS),
    });
    expect((await run(webhookInput(onBoundary))).outcome).toBe("ACTIVATED");
    expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: onBoundary.enrolmentId } })).status).toBe("ACTIVE");
    expect((await testDb.prisma.order.findUniqueOrThrow({ where: { id: onBoundary.orderId } })).status).toBe("PAID");

    const beyond = await seedPendingOrder({
      orderCreatedAt: at(-60_000),
      attemptInitiatedAt: at(SKEW_TOLERANCE_MS + 1),
    });
    const result = await run(webhookInput(beyond));
    expect(result.outcome).toBe("EXCEPTION");

    // The money is recorded, never lost.
    const attempt = await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: beyond.attemptId! } });
    expect(attempt.status).toBe("SUCCEEDED");
    expect(attempt.confirmedAt).not.toBeNull();
    expect(attempt.exceptionNote).toContain("needs reconciliation");
    expect(attempt.exceptionNote).not.toMatch(/licen[cs]e|restricted|expir/i);
    // The order is flagged and the enrolment and seat counter are untouched.
    expect((await testDb.prisma.order.findUniqueOrThrow({ where: { id: beyond.orderId } })).status).toBe("EXCEPTION");
    await expectUntouched(beyond);
    // Exactly one coded order.exception event, and no order.paid for it.
    const events = await orderExceptionEvents(beyond.orderId);
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { reason?: string }).reason).toBe("payment_after_restriction");
    const paid = await testDb.prisma.domainEvent.findMany({ where: { type: "order.paid" } });
    expect(paid.some((row) => (row.payload as { orderId?: string }).orderId === beyond.orderId)).toBe(false);
    // A reconciliation case is opened with the captured-money risk.
    const cases = await testDb.prisma.reconciliationCase.findMany({ where: { paymentAttemptId: beyond.attemptId! } });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ subject: "PAYMENT", risk: "CAPTURED_MONEY", status: "OPEN" });
    // The SYSTEM audit row for the exception exists.
    const audit = await testDb.prisma.auditEvent.findMany({
      where: { targetType: "Order", targetId: beyond.orderId, action: "order.exception" },
    });
    expect(audit.some((row) => row.actorId === null && row.actorType === "SYSTEM")).toBe(true);
  }, 60_000);

  it("tolerance boundary: a redelivered event for the exception order stays an echo and never activates it", async () => {
    await activateLicence();
    const licence = makeLicenceService(makeClock(at(2 * 60 * 60_000)));
    const run = settlement.createActivateOrderAsSystem(buildDeps(licence));
    const seeded = await seedPendingOrder({
      orderCreatedAt: at(-60_000),
      attemptInitiatedAt: at(SKEW_TOLERANCE_MS + 1),
    });
    expect((await run(webhookInput(seeded))).outcome).toBe("EXCEPTION");
    const second = await run(webhookInput(seeded, "-redelivery"));
    expect(second.outcome).toBe("EXCEPTION");
    await expectUntouched(seeded);
    expect((await testDb.prisma.order.findUniqueOrThrow({ where: { id: seeded.orderId } })).status).toBe("EXCEPTION");
  }, 60_000);
});

describe("Phase 14 D-08 payment rule: manual confirmation (OQ4, A13)", () => {
  it("manual: an order created before R is confirmed and activates; one created at R plus 11 minutes becomes the exception", async () => {
    await activateLicence();
    const licence = makeLicenceService(makeClock(at(2 * 60 * 60_000)));
    const run = settlement.createActivateOrderAsSystem(buildDeps(licence));

    // Old order, fresh manual attempt (created inside the transaction after R).
    const before = await seedPendingOrder({ orderCreatedAt: at(-DAY_MS), manual: true });
    const ok = await run(manualInput(before));
    expect(ok.outcome).toBe("ACTIVATED");
    expect((await testDb.prisma.order.findUniqueOrThrow({ where: { id: before.orderId } })).status).toBe("PAID");
    expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: before.enrolmentId } })).status).toBe("ACTIVE");

    const late = await seedPendingOrder({ orderCreatedAt: at(11 * 60_000), manual: true });
    const result = await run(manualInput(late));
    expect(result.outcome).toBe("EXCEPTION");
    const attempts = await testDb.prisma.paymentAttempt.findMany({ where: { orderId: late.orderId } });
    expect(attempts).toHaveLength(1);
    // The manual evidence fields survive on the SUCCEEDED attempt.
    expect(attempts[0]).toMatchObject({
      provider: "MANUAL",
      status: "SUCCEEDED",
      manualChannel: "bank_transfer",
      manualEvidenceKey: `evidence/${late.orderId}.pdf`,
      confirmedById: activatorId,
    });
    expect((await testDb.prisma.order.findUniqueOrThrow({ where: { id: late.orderId } })).status).toBe("EXCEPTION");
    await expectUntouched(late);
    const events = await orderExceptionEvents(late.orderId);
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { reason?: string }).reason).toBe("payment_after_restriction");
    const audit = await testDb.prisma.auditEvent.findMany({
      where: { targetType: "Order", targetId: late.orderId, action: "order.exception_manual" },
    });
    expect(audit).toHaveLength(1);
  }, 60_000);
});

describe("Phase 14 D-08 payment rule: operational webhooks and refunds", () => {
  it("operational webhooks: events, failures, session expiry and refunds keep working while restricted", async () => {
    await activateLicence();
    const clock = makeClock(at(2 * 60 * 60_000));
    const licence = makeLicenceService(clock);
    // Sanity: the deployment is restricted and a write-effect operation is refused.
    await expect(
      licence.assertWriteAllowed({ operation: "courses.edit", actorId: null }),
    ).rejects.toBeInstanceOf(LicenceWriteBlockedError);

    const cutoffSpy = vi.fn(licence.getRestrictionCutoff);
    const deps = buildDeps({ getRestrictionCutoff: cutoffSpy });

    // recordWebhookEventOrSkip records a new event and skips a duplicate.
    const recordEvent = settlement.createRecordWebhookEventOrSkip({
      webhookEvent: testDb.prisma.webhookEvent as unknown as Parameters<
        typeof settlement.createRecordWebhookEventOrSkip
      >[0]["webhookEvent"],
    });
    const eventInput = {
      provider: "PAYSTACK" as const,
      providerEventId: `evt-op-${Date.now()}`,
      eventType: "charge.success",
      payload: { note: "operational" },
    };
    expect(await recordEvent(eventInput)).toEqual({ isNew: true });
    expect(await recordEvent(eventInput)).toEqual({ isNew: false });
    expect(await testDb.prisma.webhookEvent.count({ where: { providerEventId: eventInput.providerEventId } })).toBe(1);

    // recordPaymentFailureAsSystem still works (Stripe-only entry point).
    const failing = await seedPendingOrder({ orderCreatedAt: at(-DAY_MS) });
    await testDb.prisma.paymentAttempt.update({ where: { id: failing.attemptId! }, data: { provider: "STRIPE" } });
    const failed = await settlement.createRecordPaymentFailureAsSystem(deps)({
      orderId: failing.orderId,
      eventId: `evt-fail-${failing.orderId}`,
      providerIntentId: failing.providerIntentId,
      failureReason: "card_declined",
    });
    expect(failed.outcome).toBe("FAILED");
    expect((await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: failing.attemptId! } })).status).toBe("FAILED");

    // recordSessionExpiredAsSystem still works.
    const expiring = await seedPendingOrder({ orderCreatedAt: at(-DAY_MS) });
    await testDb.prisma.paymentAttempt.update({ where: { id: expiring.attemptId! }, data: { provider: "STRIPE" } });
    const expired = await settlement.createRecordSessionExpiredAsSystem(deps)({
      orderId: expiring.orderId,
      eventId: `evt-expire-${expiring.orderId}`,
      providerIntentId: expiring.providerIntentId,
    });
    expect(expired.outcome).toBe("CANCELLED");
    expect((await testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: expiring.attemptId! } })).status).toBe("CANCELLED");

    // Neither the failure nor the expiry path consulted the licence.
    expect(cutoffSpy).not.toHaveBeenCalled();

    // A refund through the real withPermission with the real licence guard runs
    // (refunds.manage is continuity): the guard is never consulted for it.
    const staffId = (await seedLearnerFixture(testDb.prisma)).userId;
    const guardCalls: string[] = [];
    const realGuard = {
      check: async ({ permission, actorId }: { permission: string; actorId: string }) => {
        guardCalls.push(permission);
        return licence.checkWriteGate({ operation: permission, actorId });
      },
    };
    const { withPermission } = createTestWithPermission(
      [grant("refunds.manage"), grant("courses.edit")],
      { userId: staffId, licence: realGuard as never },
    );
    // The same wrapped guard does refuse a write-effect permission in this state.
    await expect(
      withPermission("courses.edit", async () => ({}))(async () => "ok")({}),
    ).rejects.toBeInstanceOf(LicenceRestrictedError);

    const paid = await seedPaidPaystackOrder();
    const refunds = realRefundService(withPermission);
    guardCalls.length = 0;
    const refund = await refunds.recordRefund({
      orderId: paid.orderId,
      amountMinor: 1_000,
      reason: "Refund while restricted continuity mode is in force.",
      accessDecision: "RETAINED",
    });
    expect(refund.status).toBe("COMPLETED");
    expect(guardCalls).toEqual([]);
    expect(await testDb.prisma.refund.count({ where: { orderId: paid.orderId, status: "COMPLETED" } })).toBe(1);
  }, 120_000);
});

describe("Phase 14 D-08 payment rule: not restricted", () => {
  it("not restricted: an ACTIVE licence settles every date exactly as before", async () => {
    await activateLicence();
    const licence = makeLicenceService(makeClock(new Date(FIXTURE_NOW.getTime() + DAY_MS)));
    expect((await licence.getRestrictionCutoff()).restricted).toBe(false);
    const run = settlement.createActivateOrderAsSystem(buildDeps(licence));

    const farFuture = await seedPendingOrder({
      orderCreatedAt: at(200 * DAY_MS),
      attemptInitiatedAt: at(200 * DAY_MS),
    });
    expect((await run(webhookInput(farFuture))).outcome).toBe("ACTIVATED");
    expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: farFuture.enrolmentId } })).status).toBe("ACTIVE");

    const manual = await seedPendingOrder({ orderCreatedAt: at(200 * DAY_MS), manual: true });
    expect((await run(manualInput(manual))).outcome).toBe("ACTIVATED");
  }, 60_000);

  it("not restricted: a never-activated deployment (OQ1 option-a) settles every date", async () => {
    const licence = makeLicenceService(makeClock(at(10 * DAY_MS)));
    expect((await licence.getRestrictionCutoff()).restricted).toBe(false);
    const run = settlement.createActivateOrderAsSystem(buildDeps(licence));
    const seeded = await seedPendingOrder({
      orderCreatedAt: at(5 * DAY_MS),
      attemptInitiatedAt: at(5 * DAY_MS),
    });
    expect((await run(webhookInput(seeded))).outcome).toBe("ACTIVATED");
  }, 60_000);

  it("T-14-13-03: a failing licence state read fails open and the paid order still activates", async () => {
    await activateLicence();
    const licenceState = new Proxy(testDb.prisma.licenceState, {
      get(target, prop) {
        if (prop === "findUnique") {
          return async () => {
            throw new Error("simulated licence state read failure");
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failingDb = new Proxy(testDb.prisma, {
      get(target, prop) {
        if (prop === "licenceState") return licenceState;
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as LicenceDbClient;
    const licence = makeLicenceService(makeClock(at(2 * 60 * 60_000)), failingDb);
    const seeded = await seedPendingOrder({
      orderCreatedAt: at(DAY_MS),
      attemptInitiatedAt: at(DAY_MS),
    });
    const result = await settlement.createActivateOrderAsSystem(buildDeps(licence))(webhookInput(seeded));
    expect(result.outcome).toBe("ACTIVATED");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Refund helpers (a trimmed copy of tests/refund.integration.test.ts's shape)
// ---------------------------------------------------------------------------

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
const BREAKDOWN = calculateCheckoutBreakdown({ baseAmountMinor: BASE_AMOUNT_MINOR, schedule: NGN_SCHEDULE });

async function seedPaidPaystackOrder(): Promise<{ orderId: string }> {
  seq += 1;
  const { cohortId } = await seedPublishedCohortFixture(testDb.prisma, {
    priceNgnMinor: BASE_AMOUNT_MINOR,
    priceUsdMinor: null,
    currency: "NGN",
  });
  const { userId } = await seedLearnerFixture(testDb.prisma);
  const tag = `${Date.now()}-${seq}`;
  const order = await testDb.prisma.order.create({
    data: {
      reference: `KQO-LP-REFUND-${tag}`,
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
      idempotencyKey: `idem-lp-refund-${tag}`,
      paidAt: new Date(),
    },
    select: { id: true },
  });
  await testDb.prisma.paymentAttempt.create({
    data: {
      orderId: order.id,
      provider: "PAYSTACK",
      providerIntentId: `PSK-REFUND-${tag}`,
      amountMinor: BREAKDOWN.totalAmountMinor,
      currency: "NGN",
      status: "SUCCEEDED",
      idempotencyKey: `pa-idem-lp-refund-${tag}`,
      confirmedAt: new Date(),
    },
  });
  return { orderId: order.id };
}

function realRefundService(withPermission: RefundServiceDeps["withPermission"]) {
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
              update: (args) => tx.refund.update({ where: args.where as never, data: args.data as never }),
            },
            order: {
              update: (args) => tx.order.update({ where: args.where as never, data: args.data as never }),
            },
            access: {
              assertRevocable: (orderId) => assertOrderAccessRevocable(tx as never, orderId),
              revoke: (args) => revokeAccessForOrder(tx as never, args),
            },
            domainEvent: {
              create: (args) => tx.domainEvent.create({ data: args.data as never }) as Promise<unknown>,
            },
          };
          return fn(client);
        }),
    },
    paystackRefund: async () => ({ id: 1, status: "processed", amount: 0, currency: "NGN" }),
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
