import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { createWithPermission } from "@/server/permissions/with-permission";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture } from "./support/cohort-fixtures";

type ReconciliationModule = typeof import("@/server/services/reconciliation-case-service");

let testDb: TestDatabase;
let createPrismaBackedReconciliationCaseService: ReconciliationModule["createPrismaBackedReconciliationCaseService"];
let referenceCounter = 0;

function unique(prefix: string): string {
  referenceCounter += 1;
  return `${prefix}-${referenceCounter}`;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  ({ createPrismaBackedReconciliationCaseService } = await import(
    "@/server/services/reconciliation-case-service"
  ));
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

afterEach(async () => {
  await testDb.prisma.$executeRawUnsafe('DELETE FROM "ReconciliationCaseEvent"');
  await testDb.prisma.$executeRawUnsafe('DELETE FROM "ReconciliationCase"');
  await testDb.prisma.auditEvent.deleteMany({});
  await testDb.prisma.enrolment.deleteMany({});
  await testDb.prisma.refund.deleteMany({});
  await testDb.prisma.paymentAttempt.deleteMany({});
  await testDb.prisma.order.deleteMany({});
  await testDb.prisma.cohort.deleteMany({});
  await testDb.prisma.course.deleteMany({});
  await testDb.prisma.user.deleteMany({});
});

type GrantInput = {
  permission: "payments.view" | "refunds.manage" | "cohorts.view" | "enrolments.manage";
  scopeType: "GLOBAL" | "COHORT";
  scopeId: string | null;
};

function serviceFor(grants: GrantInput[]) {
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "finance-user", isStaff: true }),
    loadGrants: async () =>
      grants.map((grant) => ({
        ...grant,
        active: true,
        revokedAt: null,
        startsAt: null,
        endsAt: null,
      })),
    audit: async () => undefined,
  });
  return createPrismaBackedReconciliationCaseService(testDb.prisma, withPermission);
}

async function seedPayment(args: {
  provider?: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency?: "NGN" | "USD";
  actualGatewayFeeMinor?: number | null;
  actualSchoolSettlementMinor?: number | null;
  withEnrolment?: boolean;
} = {}) {
  const provider = args.provider ?? "PAYSTACK";
  const currency = args.currency ?? "NGN";
  const { cohortId } = await seedCohortFixture(testDb.prisma, {
    currency,
    priceMinor: 100_000,
  });
  const { userId } = await seedLearnerFixture(testDb.prisma);
  const order = await testDb.prisma.order.create({
    data: {
      reference: unique("ORDER"),
      userId,
      cohortId,
      amountMinor: 103_000,
      currency,
      status: "PAID",
      selectedProvider: provider,
      baseAmountMinor: 100_000,
      platformFeeMinor: 1_500,
      gatewayFeeEstimateMinor: provider === "MANUAL" ? 0 : 1_500,
      schoolSettlementExpectedMinor: 100_000,
      idempotencyKey: unique("ORDER-IDEM"),
      correlationId: unique("CORRELATION"),
      paidAt: new Date("2026-09-15T10:00:00.000Z"),
    },
  });
  const attempt = await testDb.prisma.paymentAttempt.create({
    data: {
      orderId: order.id,
      provider,
      providerRef: unique("PROVIDER"),
      amountMinor: 103_000,
      currency,
      status: "SUCCEEDED",
      idempotencyKey: unique("ATTEMPT-IDEM"),
      correlationId: order.correlationId,
      confirmedAt: new Date("2026-09-15T10:01:00.000Z"),
      gatewayFeeActualMinor: args.actualGatewayFeeMinor ?? null,
      schoolSettlementActualMinor: args.actualSchoolSettlementMinor ?? null,
      platformGrossActualMinor: args.actualSchoolSettlementMinor === undefined ? null : 3_000,
      platformNetActualMinor:
        args.actualGatewayFeeMinor === undefined || args.actualGatewayFeeMinor === null ? null : 3_000 - args.actualGatewayFeeMinor,
      evidence: { status: "verified", apiKey: "must-not-persist" },
      ...(provider === "MANUAL"
        ? {
            manualChannel: "BANK_TRANSFER",
            manualReference: unique("MANUAL"),
            manualPaidAt: new Date("2026-09-15T09:59:00.000Z"),
            reason: "Verified bank statement",
          }
        : {}),
    },
  });
  const enrolment = args.withEnrolment
    ? await seedEnrolmentFixture(testDb.prisma, {
        cohortId,
        userId,
        orderId: order.id,
        status: "ACTIVE",
        activatedAt: new Date("2026-09-15T10:02:00.000Z"),
      })
    : null;
  return { cohortId, userId, order, attempt, enrolmentId: enrolment?.enrolmentId ?? null };
}

async function seedRefund(payment: Awaited<ReturnType<typeof seedPayment>>) {
  return testDb.prisma.refund.create({
    data: {
      orderId: payment.order.id,
      paymentAttemptId: payment.attempt.id,
      amountMinor: 25_000,
      currency: payment.order.currency,
      provider: payment.attempt.provider,
      providerRef: unique("REFUND"),
      reason: "Duplicate charge",
      accessDecision: "RETAIN_ACCESS",
      status: "COMPLETED",
      completedAt: new Date("2026-09-15T11:00:00.000Z"),
    },
  });
}

describe("reconciliation case tracer against real PostgreSQL", () => {
  it("concurrent identical payment and refund evidence creates one case and one OPENED event per subject", async () => {
    const payment = await seedPayment();
    const refund = await seedRefund(payment);
    const service = serviceFor([{ permission: "payments.view", scopeType: "GLOBAL", scopeId: null }]);

    await Promise.all(
      Array.from({ length: 6 }, () =>
        service.syncEvidenceAsSystem({
          subject: "PAYMENT",
          paymentAttemptId: payment.attempt.id,
          risk: "SETTLEMENT_VARIANCE",
          evidence: { actualMinor: 99_000, expectedMinor: 100_000, secret: "redact-me" },
          correlationId: payment.order.correlationId,
        }),
      ),
    );
    await Promise.all(
      Array.from({ length: 6 }, () =>
        service.syncEvidenceAsSystem({
          subject: "REFUND",
          refundId: refund.id,
          risk: "MISSING_PROVIDER_DATA",
          evidence: { status: "missing" },
          correlationId: payment.order.correlationId,
        }),
      ),
    );

    const cases = await testDb.prisma.$queryRaw<Array<{ id: string; evidence: unknown }>>(Prisma.sql`
      SELECT id, evidence FROM "ReconciliationCase" ORDER BY "openedAt", id
    `);
    const events = await testDb.prisma.$queryRaw<Array<{ type: string }>>(Prisma.sql`
      SELECT type FROM "ReconciliationCaseEvent" ORDER BY "createdAt", id
    `);
    expect(cases).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(["OPENED", "OPENED"]);
    expect(JSON.stringify(cases[0].evidence)).not.toContain("redact-me");
  });

  it("a changed fingerprint reopens a resolved case without erasing its prior RESOLVED history or touching finance facts", async () => {
    const payment = await seedPayment({ withEnrolment: true });
    const refund = await seedRefund(payment);
    const service = serviceFor([{ permission: "payments.view", scopeType: "GLOBAL", scopeId: null }]);
    const opened = await service.syncEvidenceAsSystem({
      subject: "PAYMENT",
      paymentAttemptId: payment.attempt.id,
      risk: "SETTLEMENT_VARIANCE",
      evidence: { expectedMinor: 100_000, actualMinor: 99_000 },
      correlationId: payment.order.correlationId,
    });
    await testDb.prisma.$executeRaw(Prisma.sql`
      UPDATE "ReconciliationCase"
      SET status = 'RESOLVED', "resolutionReason" = 'ACCEPTED_VARIANCE',
          "resolutionNote" = 'Provider confirmed the variance.',
          "resolvedAt" = ${new Date("2026-09-15T12:00:00.000Z")}, "updatedAt" = NOW()
      WHERE id = ${opened.caseId}
    `);
    await testDb.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ReconciliationCaseEvent" (
        id, "caseId", type, "actorType", "resolutionReason", note, fingerprint
      ) VALUES (
        ${unique("CASE-EVENT")}, ${opened.caseId}, 'RESOLVED', 'USER',
        'ACCEPTED_VARIANCE', 'Provider confirmed the variance.', ${opened.fingerprint}
      )
    `);

    const [orderBefore, attemptBefore, refundBefore, enrolmentBefore] = await Promise.all([
      testDb.prisma.order.findUniqueOrThrow({ where: { id: payment.order.id } }),
      testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: payment.attempt.id } }),
      testDb.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }),
      testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: payment.enrolmentId! } }),
    ]);
    await service.syncEvidenceAsSystem({
      subject: "PAYMENT",
      paymentAttemptId: payment.attempt.id,
      risk: "SETTLEMENT_VARIANCE",
      evidence: { expectedMinor: 100_000, actualMinor: 97_000 },
      correlationId: payment.order.correlationId,
    });
    const [orderAfter, attemptAfter, refundAfter, enrolmentAfter, caseAfter, events] = await Promise.all([
      testDb.prisma.order.findUniqueOrThrow({ where: { id: payment.order.id } }),
      testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: payment.attempt.id } }),
      testDb.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }),
      testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: payment.enrolmentId! } }),
      testDb.prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        SELECT status FROM "ReconciliationCase" WHERE id = ${opened.caseId}
      `).then((rows) => rows[0]),
      testDb.prisma.$queryRaw<Array<{ type: string; note: string | null }>>(Prisma.sql`
        SELECT type, note FROM "ReconciliationCaseEvent"
        WHERE "caseId" = ${opened.caseId} ORDER BY "createdAt", id
      `),
    ]);

    expect(caseAfter.status).toBe("REOPENED");
    expect(events.map((event) => event.type)).toEqual(["OPENED", "RESOLVED", "REOPENED"]);
    expect(events[1].note).toBe("Provider confirmed the variance.");
    expect(orderAfter).toEqual(orderBefore);
    expect(attemptAfter).toEqual(attemptBefore);
    expect(refundAfter).toEqual(refundBefore);
    expect(enrolmentAfter).toEqual(enrolmentBefore);
  });

  it("denies a missing case and an out-of-scope case with the same non-enumerating authorization error", async () => {
    const payment = await seedPayment();
    const globalService = serviceFor([{ permission: "payments.view", scopeType: "GLOBAL", scopeId: null }]);
    const opened = await globalService.syncEvidenceAsSystem({
      subject: "PAYMENT",
      paymentAttemptId: payment.attempt.id,
      risk: "CAPTURED_MONEY",
      evidence: { enrolment: "missing" },
      correlationId: payment.order.correlationId,
    });
    const scopedService = serviceFor([
      { permission: "payments.view", scopeType: "COHORT", scopeId: "another-cohort" },
    ]);

    const outOfScope = await scopedService.getCaseDetail(opened.caseId).catch((error: Error) => error);
    const missing = await scopedService.getCaseDetail("case-does-not-exist").catch((error: Error) => error);
    expect(outOfScope).toMatchObject({
      name: "AuthorizationError",
      message: "You do not have access to perform this action.",
    });
    expect(missing).toMatchObject({
      name: "AuthorizationError",
      message: "You do not have access to perform this action.",
    });
  });

  it("projects honest money states, ordered timelines, correlated history, and only currently authorized corrective links", async () => {
    const online = await seedPayment({ actualGatewayFeeMinor: 0, actualSchoolSettlementMinor: null });
    const service = serviceFor([
      { permission: "payments.view", scopeType: "COHORT", scopeId: online.cohortId },
      { permission: "refunds.manage", scopeType: "COHORT", scopeId: online.cohortId },
      { permission: "cohorts.view", scopeType: "COHORT", scopeId: online.cohortId },
      { permission: "enrolments.manage", scopeType: "COHORT", scopeId: online.cohortId },
    ]);
    const opened = await service.syncEvidenceAsSystem({
      subject: "PAYMENT",
      paymentAttemptId: online.attempt.id,
      risk: "CAPTURED_MONEY",
      evidence: { safeSummary: "Captured payment has no active enrolment" },
      correlationId: online.order.correlationId,
    });
    await testDb.prisma.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        action: "payment.reconciliation_exception",
        targetType: "PaymentAttempt",
        targetId: online.attempt.id,
        outcome: "SUCCESS",
        correlationId: online.order.correlationId,
      },
    });

    const detail = await service.getCaseDetail(opened.caseId);
    expect(detail?.amounts.gatewayFeeActual).toEqual({ kind: "VALUE", minor: 0 });
    expect(detail?.amounts.schoolSettlementActual).toEqual({ kind: "PENDING" });
    expect(detail?.paymentTimeline.map((entry) => entry.kind)).toEqual(["PAYMENT"]);
    expect(detail?.operationalHistory).toHaveLength(1);
    expect(detail?.links).toEqual({
      paymentHref: `/staff/payments/${online.order.id}`,
      refundHref: `/staff/payments/${online.order.id}#refunds`,
      cohortHref: `/staff/cohorts/${online.cohortId}`,
    });

    const viewOnly = serviceFor([
      { permission: "payments.view", scopeType: "COHORT", scopeId: online.cohortId },
    ]);
    expect((await viewOnly.getCaseDetail(opened.caseId))?.links).toEqual({
      paymentHref: `/staff/payments/${online.order.id}`,
      refundHref: null,
      cohortHref: null,
    });

    const manual = await seedPayment({ provider: "MANUAL" });
    const manualCase = await serviceFor([
      { permission: "payments.view", scopeType: "COHORT", scopeId: manual.cohortId },
    ]).syncEvidenceAsSystem({
      subject: "PAYMENT",
      paymentAttemptId: manual.attempt.id,
      risk: "MISSING_PROVIDER_DATA",
      evidence: { manualReference: manual.attempt.manualReference },
      correlationId: manual.order.correlationId,
    });
    const manualDetail = await serviceFor([
      { permission: "payments.view", scopeType: "COHORT", scopeId: manual.cohortId },
    ]).getCaseDetail(manualCase.caseId);
    expect(manualDetail?.amounts.gatewayFeeActual).toEqual({ kind: "NOT_APPLICABLE" });
    expect(manualDetail?.amounts.schoolSettlementActual).toEqual({ kind: "NOT_APPLICABLE" });
  });
});
