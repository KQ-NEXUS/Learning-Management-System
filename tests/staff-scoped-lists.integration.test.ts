/**
 * Integration warning #1 — scoped staff can find their work.
 *
 * The staff Cohorts, Enrolments and Payments lists used to require a GLOBAL
 * grant, so an instructor scoped to one cohort saw only "Overview". Each list
 * now resolves the caller's collection scope and filters in the query itself:
 * rows outside the scope are never fetched. A GLOBAL grant sees everything,
 * no grant is refused.
 *
 * PREREQUISITE: Docker must be running (Testcontainers Postgres).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import { createTestCollectionAuthorizer } from "./support/collection-harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import { createStaffCohortListService } from "@/server/services/cohort-service";
import { createStaffEnrolmentListService, type StaffEnrolmentStore } from "@/server/services/roster-service";
import { createPrismaBackedPaymentReadService } from "@/server/services/payment-read-service";
import { createStaffOverviewLoader } from "@/server/services/staff-overview-service";
import { collectionScopeFromGrants } from "@/server/permissions/collection-scope";

let testDb: TestDatabase;
let mine: { cohortId: string; enrolmentId: string; orderId: string };
let theirs: { cohortId: string; enrolmentId: string; orderId: string };

async function seedDeliveredCohort() {
  const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
  const { enrolmentId, userId } = await seedEnrolmentFixture(testDb.prisma, { cohortId, status: "ACTIVE" });
  const order = await testDb.prisma.order.create({
    data: {
      reference: `ORD-SCOPE-${Math.random().toString(36).slice(2)}`,
      userId,
      cohortId,
      amountMinor: 10_000,
      currency: "NGN",
      status: "PAID",
      idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
      paidAt: new Date(),
    },
    select: { id: true },
  });
  return { cohortId, enrolmentId, orderId: order.id };
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  mine = await seedDeliveredCohort();
  theirs = await seedDeliveredCohort();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

function lists(grants: Parameters<typeof createTestCollectionAuthorizer>[0]) {
  const { authorizeCollection } = createTestCollectionAuthorizer(grants);
  const { withPermission } = createTestWithPermission(grants);
  return {
    cohorts: createStaffCohortListService({ cohort: testDb.prisma.cohort as never, authorizeCollection }),
    enrolments: createStaffEnrolmentListService({
      store: testDb.prisma.enrolment as unknown as StaffEnrolmentStore,
      authorizeCollection,
    }),
    payments: createPrismaBackedPaymentReadService(testDb.prisma, withPermission, authorizeCollection),
  };
}

describe("integration warning #1 — staff lists follow the caller's scope (real Postgres)", () => {
  it("a COHORT-scoped instructor sees only their cohort, its enrolments and its payments", async () => {
    const l = lists([
      grant("cohorts.view", "COHORT", mine.cohortId),
      grant("enrolments.view", "COHORT", mine.cohortId),
      grant("payments.view", "COHORT", mine.cohortId),
    ]);

    expect((await l.cohorts.listCohortsForStaff()).map((c) => c.id)).toEqual([mine.cohortId]);
    expect((await l.enrolments.loadStaffEnrolments({})).map((e) => e.id)).toEqual([mine.enrolmentId]);
    expect((await l.payments.listPaymentsForStaff()).map((p) => p.id)).toEqual([mine.orderId]);
  }, TEST_DB_TIMEOUT_MS);

  it("a GLOBAL grant sees every cohort, enrolment and payment", async () => {
    const l = lists([grant("cohorts.view"), grant("enrolments.view"), grant("payments.view")]);

    expect((await l.cohorts.listCohortsForStaff()).map((c) => c.id)).toEqual(
      expect.arrayContaining([mine.cohortId, theirs.cohortId]),
    );
    expect((await l.enrolments.loadStaffEnrolments({})).map((e) => e.id)).toEqual(
      expect.arrayContaining([mine.enrolmentId, theirs.enrolmentId]),
    );
    expect((await l.payments.listPaymentsForStaff()).map((p) => p.id)).toEqual(
      expect.arrayContaining([mine.orderId, theirs.orderId]),
    );
  }, TEST_DB_TIMEOUT_MS);

  it("a caller with no grant for the list is refused, not shown an empty list", async () => {
    const l = lists([]);

    await expect(l.cohorts.listCohortsForStaff()).rejects.toBeInstanceOf(AuthorizationError);
    await expect(l.enrolments.loadStaffEnrolments({})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(l.payments.listPaymentsForStaff()).rejects.toBeInstanceOf(AuthorizationError);
  }, TEST_DB_TIMEOUT_MS);
});

describe("integration warning #1 — the Overview counts only what the caller's scope reaches (real Postgres)", () => {
  function overviewFor(grants: Parameters<typeof collectionScopeFromGrants>[0]) {
    return createStaffOverviewLoader({
      db: testDb.prisma as never,
      scopeFor: async (permission) => collectionScopeFromGrants(grants, permission),
    })();
  }

  it("a COHORT-scoped instructor's figures cover only their cohort, and unheld sections are hidden", async () => {
    const scoped = await overviewFor([
      grant("enrolments.view", "COHORT", mine.cohortId),
      grant("payments.view", "COHORT", mine.cohortId),
    ]);
    const global = await overviewFor([grant("enrolments.view"), grant("payments.view")]);

    expect(scoped.figures.enrolments?.thisMonth).toBe(1);
    expect(global.figures.enrolments!.thisMonth).toBeGreaterThanOrEqual(2);
    expect(scoped.figures.revenue).toEqual([{ currency: "NGN", amountMinor: 10_000 }]);
    expect(global.figures.revenue?.find((r) => r.currency === "NGN")?.amountMinor).toBeGreaterThanOrEqual(20_000);

    // No cohorts.view / attendance.view grant — those sections stay hidden.
    expect(scoped.nextSessions).toBeNull();
    expect(scoped.figures.attendance).toBeNull();
  }, TEST_DB_TIMEOUT_MS);
});
