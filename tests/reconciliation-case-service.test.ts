import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createWithPermission } from "@/server/permissions/with-permission";
import type { CollectionAuthorization } from "@/server/permissions/collection-scope";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture } from "./support/cohort-fixtures";

type Module = typeof import("@/server/services/reconciliation-case-service");
let moduleUnderTest: Module;
let testDb: TestDatabase;
let counter = 0;

function unique(prefix: string) { counter += 1; return `${prefix}-${counter}`; }

beforeAll(async () => {
  const localUrl = process.env.PLAN_08_02_DATABASE_URL;
  if (localUrl) {
    const prisma = new PrismaClient({ datasources: { db: { url: localUrl } } });
    testDb = { prisma, url: localUrl, stop: () => prisma.$disconnect() };
  } else {
    testDb = await startTestDatabase();
  }
  process.env.DATABASE_URL = testDb.url;
  moduleUnderTest = await import("@/server/services/reconciliation-case-service");
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => { await testDb?.stop(); }, TEST_DB_TIMEOUT_MS);

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

async function seedPayment(args: { provider?: "PAYSTACK" | "STRIPE" | "MANUAL"; currency?: "NGN" | "USD"; cohortId?: string; userId?: string; withEnrolment?: boolean } = {}) {
  const provider = args.provider ?? "PAYSTACK";
  const currency = args.currency ?? "NGN";
  const cohort = args.cohortId ? { cohortId: args.cohortId } : await seedCohortFixture(testDb.prisma, { currency, priceMinor: 100_000 });
  const learner = args.userId ? { userId: args.userId } : await seedLearnerFixture(testDb.prisma);
  const order = await testDb.prisma.order.create({ data: { reference: unique("ORDER"), userId: learner.userId, cohortId: cohort.cohortId, amountMinor: 103_000, currency, status: "PAID", selectedProvider: provider, baseAmountMinor: 100_000, platformFeeMinor: 1_500, gatewayFeeEstimateMinor: provider === "MANUAL" ? 0 : 1_500, schoolSettlementExpectedMinor: 100_000, idempotencyKey: unique("ORDER-IDEM"), correlationId: unique("CORR"), paidAt: new Date("2026-09-15T10:00:00.000Z") } });
  const attempt = await testDb.prisma.paymentAttempt.create({ data: { orderId: order.id, provider, providerRef: unique("PROVIDER"), amountMinor: 103_000, currency, status: "SUCCEEDED", idempotencyKey: unique("ATTEMPT-IDEM"), correlationId: order.correlationId, confirmedAt: new Date("2026-09-15T10:01:00.000Z"), gatewayFeeActualMinor: provider === "MANUAL" ? null : 2_000, schoolSettlementActualMinor: provider === "MANUAL" ? null : 99_000 } });
  const enrolment = args.withEnrolment ? await seedEnrolmentFixture(testDb.prisma, { cohortId: cohort.cohortId, userId: learner.userId, orderId: order.id, status: "ACTIVE" }) : null;
  return { cohortId: cohort.cohortId, userId: learner.userId, order, attempt, enrolmentId: enrolment?.enrolmentId ?? null };
}

function service(scope: CollectionAuthorization["scope"], actorId = "finance-user") {
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: actorId, isStaff: true }),
    loadGrants: async () => [{ permission: "payments.view", scopeType: scope.kind === "GLOBAL" ? "GLOBAL" : "COHORT", scopeId: scope.kind === "GLOBAL" ? null : scope.cohortIds[0], active: true, revokedAt: null, startsAt: null, endsAt: null }],
    audit: async () => undefined,
  });
  return moduleUnderTest.createPrismaBackedReconciliationCaseService(testDb.prisma, withPermission, {
    authorizeCollection: async () => ({ actor: { userId: actorId, isStaff: true }, permission: "payments.view", scope, cohortWhere: {} }),
    loadGrants: async () => [{ permission: "payments.view", scopeType: "GLOBAL", scopeId: null, active: true, revokedAt: null, startsAt: null, endsAt: null }],
    audit: async () => undefined,
  });
}

describe("complete reconciliation case service", () => {
  it("applies the grant union before payment/refund filters and keeps provider/currency totals equal to rows", async () => {
    const ngn = await seedPayment({ provider: "PAYSTACK", currency: "NGN" });
    const usd = await seedPayment({ provider: "STRIPE", currency: "USD" });
    const outside = await seedPayment({ provider: "MANUAL", currency: "NGN" });
    const global = service({ kind: "GLOBAL", programmeIds: [], courseIds: [], cohortIds: [] });
    await global.syncEvidenceAsSystem({ subject: "PAYMENT", paymentAttemptId: ngn.attempt.id, risk: "CAPTURED_MONEY", evidence: { issue: "missing enrolment" } });
    const refund = await testDb.prisma.refund.create({ data: { orderId: usd.order.id, paymentAttemptId: usd.attempt.id, amountMinor: 25_000, currency: "USD", provider: "STRIPE", status: "COMPLETED", reason: "Duplicate", accessDecision: "RETAIN_ACCESS" } });
    await global.syncEvidenceAsSystem({ subject: "REFUND", refundId: refund.id, risk: "MISSING_PROVIDER_DATA", evidence: { issue: "missing provider data" } });
    await global.syncEvidenceAsSystem({ subject: "PAYMENT", paymentAttemptId: outside.attempt.id, risk: "SETTLEMENT_VARIANCE", evidence: { issue: "variance" } });

    const scoped = service({ kind: "LIMITED", programmeIds: [], courseIds: [], cohortIds: [ngn.cohortId, usd.cohortId] });
    const stripeRows = await scoped.listCases({ provider: "STRIPE", currency: "USD", subject: "REFUND" });
    const stripeSummary = await scoped.getReconciliationSummary({ provider: "STRIPE", currency: "USD", subject: "REFUND" });
    expect(stripeRows).toHaveLength(1);
    expect(stripeRows[0]).toMatchObject({ subject: "REFUND", provider: "STRIPE", currency: "USD" });
    expect(stripeSummary).toEqual([{ provider: "STRIPE", currency: "USD", subject: "REFUND", count: 1, amountMinor: 25_000 }]);
    const allRows = await scoped.listCases();
    expect(allRows.map((row) => row.risk)).toEqual(["CAPTURED_MONEY", "MISSING_PROVIDER_DATA"]);
    expect(allRows.some((row) => row.provider === "MANUAL")).toBe(false);
  });

  it("assigns one or many only to a permitted staff user and resolves without changing financial or enrolment facts", async () => {
    const payment = await seedPayment({ withEnrolment: true });
    const finance = await testDb.prisma.user.create({ data: { email: unique("finance") + "@example.test", name: "Finance Assignee", passwordHash: "hash", isStaff: true } });
    const actor = await testDb.prisma.user.create({ data: { email: unique("actor") + "@example.test", name: "Finance Actor", passwordHash: "hash", isStaff: true } });
    const svc = service({ kind: "GLOBAL", programmeIds: [], courseIds: [], cohortIds: [] }, actor.id);
    const opened = await svc.syncEvidenceAsSystem({ subject: "PAYMENT", paymentAttemptId: payment.attempt.id, risk: "CAPTURED_MONEY", evidence: { issue: "captured without enrolment" } });
    const [orderBefore, attemptBefore, enrolmentBefore] = await Promise.all([testDb.prisma.order.findUniqueOrThrow({ where: { id: payment.order.id } }), testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: payment.attempt.id } }), testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: payment.enrolmentId! } })]);
    expect(await svc.assignCases({ caseIds: [opened.caseId], assigneeId: finance.id })).toEqual({ changed: 1 });
    await expect(svc.resolveCase({ caseId: opened.caseId, reason: "ACCEPTED_VARIANCE", note: "Provider confirmed the observed evidence." })).resolves.toEqual({ changed: true });
    const [orderAfter, attemptAfter, enrolmentAfter, events] = await Promise.all([testDb.prisma.order.findUniqueOrThrow({ where: { id: payment.order.id } }), testDb.prisma.paymentAttempt.findUniqueOrThrow({ where: { id: payment.attempt.id } }), testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: payment.enrolmentId! } }), testDb.prisma.$queryRaw<Array<{ type: string }>>(Prisma.sql`SELECT type FROM "ReconciliationCaseEvent" WHERE "caseId" = ${opened.caseId} ORDER BY "createdAt", id`)]);
    expect(orderAfter).toEqual(orderBefore);
    expect(attemptAfter).toEqual(attemptBefore);
    expect(enrolmentAfter).toEqual(enrolmentBefore);
    expect(events.map((event) => event.type)).toEqual(["OPENED", "ASSIGNED", "RESOLVED"]);
  });

  it("correlates trusted operational evidence once and reopens a resolved case once under concurrency", async () => {
    const payment = await seedPayment();
    const actor = await testDb.prisma.user.create({ data: { email: unique("actor") + "@example.test", name: "Finance Actor", passwordHash: "hash", isStaff: true } });
    const svc = service({ kind: "GLOBAL", programmeIds: [], courseIds: [], cohortIds: [] }, actor.id);
    const opened = await svc.syncEvidenceAsSystem({ subject: "PAYMENT", paymentAttemptId: payment.attempt.id, risk: "SETTLEMENT_VARIANCE", evidence: { actual: 99_000 } });
    await svc.resolveCase({ caseId: opened.caseId, reason: "ACCEPTED_VARIANCE", note: "Accepted based on provider evidence." });
    await Promise.all(Array.from({ length: 5 }, () => svc.correlateOperationalEvidenceAsSystem({ action: "enrolment.approved", orderId: payment.order.id, enrolmentId: "trusted-enrolment", evidence: { status: "ACTIVE" }, correlationId: payment.order.correlationId })));
    const [current, events] = await Promise.all([testDb.prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT status FROM "ReconciliationCase" WHERE id = ${opened.caseId}`).then((rows) => rows[0]), testDb.prisma.$queryRaw<Array<{ type: string }>>(Prisma.sql`SELECT type FROM "ReconciliationCaseEvent" WHERE "caseId" = ${opened.caseId} ORDER BY "createdAt", id`)]);
    expect(current.status).toBe("REOPENED");
    expect(events.filter((event) => event.type === "REOPENED")).toHaveLength(1);
  });
});
