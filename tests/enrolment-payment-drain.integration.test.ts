/**
 * Real-Postgres proof that a paid or staff-approved enrolment drains into
 * ONE combined confirmation mail (D-07), and that the "payment received,
 * finishing up" exception mail (A-06) is scoped to exactly the
 * `illegal_transition` reason — properties a JS fake cannot prove (the
 * `FOR UPDATE SKIP LOCKED` claim, `createMany({ skipDuplicates: true })`
 * dedup, and the real relational reads the mapper performs through `ctx.tx`).
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error —
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { startDrainHarness, seedVerifiedLearner, writeEvent } from "./support/drain-harness";
import { seedCohortFixture } from "./support/cohort-fixtures";

let testDb: TestDatabase;
let orderCounter = 0;

function uniqueOrderReference(): string {
  orderCounter += 1;
  return `KQO-ENP-${orderCounter}`;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

afterEach(async () => {
  await testDb.prisma.notification.deleteMany();
  await testDb.prisma.emailPreference.deleteMany();
  await testDb.prisma.emailDispatch.deleteMany();
  await testDb.prisma.domainEvent.deleteMany();
  await testDb.prisma.enrolment.deleteMany({});
  await testDb.prisma.order.deleteMany({});
  await testDb.prisma.cohort.deleteMany({});
  await testDb.prisma.course.deleteMany({});
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@drain-harness.test" } } });
});

async function seedPaidOrderAndEnrolment(): Promise<{
  cohortId: string;
  userId: string;
  orderId: string;
  orderReference: string;
  enrolmentId: string;
}> {
  const { cohortId } = await seedCohortFixture(testDb.prisma, { title: "Enrolment-Payment Drain Cohort" });
  const learner = await seedVerifiedLearner(testDb.prisma);
  const orderReference = uniqueOrderReference();
  const order = await testDb.prisma.order.create({
    data: {
      reference: orderReference,
      userId: learner.id,
      cohortId,
      amountMinor: 500_000,
      currency: "NGN",
      status: "PAID",
      idempotencyKey: `idem-${orderReference}`,
      paidAt: new Date(),
    },
    select: { id: true },
  });
  const enrolment = await testDb.prisma.enrolment.create({
    data: {
      userId: learner.id,
      cohortId,
      orderId: order.id,
      status: "ACTIVE",
      activatedAt: new Date(),
    },
    select: { id: true },
  });
  return { cohortId, userId: learner.id, orderId: order.id, orderReference, enrolmentId: enrolment.id };
}

describe("enrolment-payment drain — order.paid + enrolment.activated combine into one mail (D-07)", () => {
  it("draining order.paid then enrolment.activated for the same order leaves exactly one enrolment-confirmed email and one notification", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const { orderId, orderReference, enrolmentId } = await seedPaidOrderAndEnrolment();

    await writeEvent(
      testDb.prisma,
      "order.paid",
      { orderId, providerIntentId: "pi_1", amountMinor: 500_000, currency: "NGN" },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const activatedEvent = await writeEvent(
      testDb.prisma,
      "enrolment.activated",
      { enrolmentId, cohortId: (await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).cohortId, claimedSeat: true, actorId: null },
      new Date("2026-01-01T00:00:01.000Z"),
    );

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(2);

    const allDispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(allDispatches).toHaveLength(1);
    expect(allDispatches[0]!.template).toBe("enrolment-confirmed");
    expect(allDispatches[0]!.correlationId).toBe(activatedEvent.id);
    expect(allDispatches[0]!.templateParams).toEqual({
      cohortTitle: "Enrolment-Payment Drain Cohort",
      orderReference,
      amountLabel: "NGN 5,000.00",
      enrolmentPath: `/learn/${enrolmentId}`,
    });

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("enrolment.confirmed");
    expect(notifications[0]!.targetType).toBe("LEARNER_ENROLMENT");
    expect(notifications[0]!.targetId).toBe(enrolmentId);
    expect(notifications[0]!.params).toEqual({ cohortTitle: "Enrolment-Payment Drain Cohort" });
  });

  it("an enrolment.activated event whose enrolment no longer exists produces no rows and is still processed", async () => {
    const harness = startDrainHarness(testDb.prisma);
    await writeEvent(
      testDb.prisma,
      "enrolment.activated",
      { enrolmentId: "does-not-exist", cohortId: "cohort-does-not-exist", claimedSeat: true, actorId: null },
    );

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);
    expect(await testDb.prisma.emailDispatch.count()).toBe(0);
    expect(await testDb.prisma.notification.count()).toBe(0);
  });
});

describe("enrolment-payment drain — enrolment.approved (staff approval, no payment) (A-02)", () => {
  it("an enrolment.approved event for an enrolment with no order yields an enrolment-confirmed row with no orderReference and no amountLabel", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const { cohortId } = await seedCohortFixture(testDb.prisma, { title: "Staff Approval Cohort" });
    const learner = await seedVerifiedLearner(testDb.prisma);
    const enrolment = await testDb.prisma.enrolment.create({
      data: { userId: learner.id, cohortId, status: "ACTIVE", activatedAt: new Date() },
      select: { id: true },
    });

    const event = await writeEvent(testDb.prisma, "enrolment.approved", {
      enrolmentId: enrolment.id,
      cohortId,
      claimedSeat: true,
      actorId: "staff-1",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("enrolment-confirmed");
    expect(dispatches[0]!.templateParams).toEqual({
      cohortTitle: "Staff Approval Cohort",
      enrolmentPath: `/learn/${enrolment.id}`,
    });
    expect(dispatches[0]!.templateParams).not.toHaveProperty("orderReference");
    expect(dispatches[0]!.templateParams).not.toHaveProperty("amountLabel");
  });
});

describe("enrolment-payment drain — order.exception learner mail scoped to illegal_transition (A-06)", () => {
  it("duplicate_active_enrolment yields zero learner EmailDispatch rows", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const { orderId } = await seedPaidOrderAndEnrolment();

    await writeEvent(testDb.prisma, "order.exception", {
      orderId,
      providerIntentId: "pi_dup",
      reason: "duplicate_active_enrolment",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);
    expect(await testDb.prisma.emailDispatch.count()).toBe(0);
  });

  it("illegal_transition yields exactly one order-payment-exception row with no other payload key leaked", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const { orderId, orderReference } = await seedPaidOrderAndEnrolment();

    const event = await writeEvent(testDb.prisma, "order.exception", {
      orderId,
      providerIntentId: "pi_illegal",
      reason: "illegal_transition",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("order-payment-exception");
    expect(dispatches[0]!.templateParams).toEqual({
      cohortTitle: "Enrolment-Payment Drain Cohort",
      orderReference,
      orderPath: `/orders/${orderReference}`,
    });
    expect(JSON.stringify(dispatches[0]!.templateParams)).not.toContain("illegal_transition");
    expect(JSON.stringify(dispatches[0]!.templateParams)).not.toContain("pi_illegal");

    const notifications = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("order.payment_exception");
    expect(notifications[0]!.targetType).toBe("LEARNER_ORDER");
    expect(notifications[0]!.targetId).toBe(orderReference);
  });
});
