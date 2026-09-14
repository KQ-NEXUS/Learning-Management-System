/**
 * Real-Postgres proof for manual payment confirmation (PAY-03, PAY-04,
 * PAY-10) — the property the unit test (`tests/manual-payment-service.test.ts`)
 * cannot prove with a fake `activateOrderAsSystem`: that a REAL settlement
 * transaction produces exactly one Enrolment activation and that this
 * service's own audit row is the ONE actor-attributed row for the
 * confirmation, under a real committed transaction.
 *
 * `checkout-webhook-system-service.ts`'s singleton `activateOrderAsSystem`
 * binds to `@/server/db`'s singleton `PrismaClient`, constructed the FIRST
 * time that module is evaluated — so `manual-payment-service.ts` (which
 * imports it) is dynamically imported here, AFTER `process.env.DATABASE_URL`
 * points at the Testcontainers instance, mirroring
 * `tests/checkout-webhook.integration.test.ts`'s own documented discipline.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — never a silent
 * pass, never a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedLearnerFixture, seedPaystackNgnFeeScheduleFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import { calculatePlatformFeeMinor } from "@/server/payments/pricing";

type ManualPaymentModule = typeof import("@/server/services/manual-payment-service");
type CheckoutServiceModule = typeof import("@/server/services/checkout-service");

let testDb: TestDatabase;
let manualPaymentModule: ManualPaymentModule;
let checkoutServiceModule: CheckoutServiceModule;

const BASE_AMOUNT_MINOR = 45_000_000;

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before any dynamic import below — see file header.
  process.env.DATABASE_URL = testDb.url;

  await seedPaystackNgnFeeScheduleFixture(testDb.prisma);

  manualPaymentModule = await import("@/server/services/manual-payment-service");
  checkoutServiceModule = await import("@/server/services/checkout-service");
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

function serviceWithGrants(actorId: string) {
  const { withPermission } = createTestWithPermission([grant("payments.confirm")], { userId: actorId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return manualPaymentModule.createPrismaBackedManualPaymentService(testDb.prisma as any, withPermission);
}

describe("confirmManualPayment — real Postgres (PAY-03, PAY-04, PAY-10)", () => {
  it("moves a real Order to PAID and the Enrolment to ACTIVE through the shared settlement transition, with exactly one actor-attributed audit row and exactly one enrolment activation", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceNgnMinor: BASE_AMOUNT_MINOR,
      priceUsdMinor: null,
      currency: "NGN",
      holdMinutes: 30,
    });
    const { userId: learnerUserId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { userId: staffUserId } = await seedLearnerFixture(testDb.prisma);

    const { orderId } = await checkoutServiceModule.startCheckout({ userId: learnerUserId }, cohortId, "NGN");

    const platformFeeMinor = calculatePlatformFeeMinor(BASE_AMOUNT_MINOR);
    const expectedTotalMinor = BASE_AMOUNT_MINOR + platformFeeMinor;

    const service = serviceWithGrants(staffUserId);
    const result = await service.confirmManualPayment({
      orderId,
      amountMinor: expectedTotalMinor,
      currency: "NGN",
      manualPaidAt: new Date(),
      manualChannel: "bank_transfer",
      manualReference: `REF-${orderId}`,
      manualEvidenceKey: `evidence/${orderId}.pdf`,
      reason: "Confirmed against the school's bank statement.",
    });

    expect(result).toEqual({ outcome: "ACTIVATED" });

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.selectedProvider).toBe("MANUAL");
    expect(order.amountMinor).toBe(expectedTotalMinor);
    expect(order.gatewayFeeEstimateMinor).toBe(0);

    const enrolments = await testDb.prisma.enrolment.findMany({ where: { orderId } });
    expect(enrolments).toHaveLength(1);
    expect(enrolments[0].status).toBe("ACTIVE");
    expect(enrolments[0].activatedAt).not.toBeNull();

    const attempts = await testDb.prisma.paymentAttempt.findMany({ where: { orderId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("SUCCEEDED");
    expect(attempts[0].provider).toBe("MANUAL");
    expect(attempts[0].confirmedById).toBe(staffUserId);

    // Exactly one audit row naming the confirming actor and the reason —
    // distinct from `activateOrderAsSystem`'s own SYSTEM-attributed rows.
    const actorAudits = await testDb.prisma.auditEvent.findMany({
      where: { actorId: staffUserId, action: "payment.manual_confirmed" },
    });
    expect(actorAudits).toHaveLength(1);
    expect(actorAudits[0].reason).toBe("Confirmed against the school's bank statement.");

    // The settlement transition's own SYSTEM-attributed rows use the
    // `_manual` suffix (07-08's extension to checkout-webhook-system-service.ts).
    const systemAudits = await testDb.prisma.auditEvent.findMany({
      where: { actorId: null, actorType: "SYSTEM", targetId: orderId },
    });
    expect(systemAudits.some((a) => a.action === "order.paid_manual")).toBe(true);
  }, 30_000);

  it("a second confirmation against the now-PAID Order returns ALREADY_PAID and creates no second attempt, no second audit row, and no second enrolment effect", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      priceNgnMinor: BASE_AMOUNT_MINOR,
      priceUsdMinor: null,
      currency: "NGN",
      holdMinutes: 30,
    });
    const { userId: learnerUserId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
    const { userId: staffUserId } = await seedLearnerFixture(testDb.prisma);

    const { orderId } = await checkoutServiceModule.startCheckout({ userId: learnerUserId }, cohortId, "NGN");
    const platformFeeMinor = calculatePlatformFeeMinor(BASE_AMOUNT_MINOR);
    const expectedTotalMinor = BASE_AMOUNT_MINOR + platformFeeMinor;

    const service = serviceWithGrants(staffUserId);
    const confirmInput = {
      orderId,
      amountMinor: expectedTotalMinor,
      currency: "NGN" as const,
      manualPaidAt: new Date(),
      manualChannel: "bank_transfer",
      manualReference: `REF-${orderId}`,
      manualEvidenceKey: `evidence/${orderId}.pdf`,
      reason: "Confirmed against the school's bank statement.",
    };

    const first = await service.confirmManualPayment(confirmInput);
    expect(first).toEqual({ outcome: "ACTIVATED" });

    const second = await service.confirmManualPayment(confirmInput);
    expect(second.outcome).toBe("ALREADY_PAID");

    const attempts = await testDb.prisma.paymentAttempt.findMany({ where: { orderId } });
    expect(attempts).toHaveLength(1);

    const enrolments = await testDb.prisma.enrolment.findMany({ where: { orderId } });
    expect(enrolments).toHaveLength(1);
    expect(enrolments.filter((e) => e.status === "ACTIVE")).toHaveLength(1);

    const actorAudits = await testDb.prisma.auditEvent.findMany({
      where: { actorId: staffUserId, action: "payment.manual_confirmed" },
    });
    expect(actorAudits).toHaveLength(1);
  }, 30_000);
});
