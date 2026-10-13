/**
 * Real-Postgres proof for the bounded staff payments list (plan 15-09,
 * NFR-02, threats T-15-09-03 and T-15-09-04).
 *
 * 120 orders across two cohorts. listPaymentsForStaff reads at most one page
 * (50 by default, never more than 100), newest first then id, with a total
 * count taken from the same where as the rows. Walking every page returns
 * each in-scope order exactly once and nothing else; a cohort-scoped caller's
 * rows and total cover only their cohort; a page past the end is empty with
 * the correct total.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import { createTestCollectionAuthorizer } from "./support/collection-harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import { createPrismaBackedPaymentReadService } from "@/server/services/payment-read-service";

let testDb: TestDatabase;
let cohortA: string;
let cohortB: string;
/** Every order id in the expected list order: createdAt desc, then id desc. */
let expectedAll: string[] = [];
let expectedA: string[] = [];

beforeAll(async () => {
  testDb = await startTestDatabase();
  cohortA = (await seedCohortFixture(testDb.prisma, { capacity: 5 })).cohortId;
  cohortB = (await seedCohortFixture(testDb.prisma, { capacity: 5 })).cohortId;
  const learnerA = (await seedEnrolmentFixture(testDb.prisma, { cohortId: cohortA, status: "ACTIVE" })).userId;
  const learnerB = (await seedEnrolmentFixture(testDb.prisma, { cohortId: cohortB, status: "ACTIVE" })).userId;
  const base = new Date("2026-09-01T09:00:00.000Z").getTime();

  await testDb.prisma.order.createMany({
    data: Array.from({ length: 120 }, (_, i) => {
      const inB = i % 3 === 0; // 40 orders in cohort B, 80 in cohort A
      return {
        reference: `ORD-PAGE-${String(i).padStart(3, "0")}`,
        userId: inB ? learnerB : learnerA,
        cohortId: inB ? cohortB : cohortA,
        amountMinor: 10_000 + i,
        currency: "NGN",
        status: "PAID" as const,
        idempotencyKey: `idem-page-${i}`,
        // Groups of four share a createdAt, so the id tie-break decides their order.
        createdAt: new Date(base + Math.floor(i / 4) * 60_000),
      };
    }),
  });

  const all = await testDb.prisma.order.findMany({ select: { id: true, cohortId: true, createdAt: true } });
  all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  expectedAll = all.map((o) => o.id);
  expectedA = all.filter((o) => o.cohortId === cohortA).map((o) => o.id);
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

function service(grants: Parameters<typeof createTestCollectionAuthorizer>[0]) {
  const { authorizeCollection } = createTestCollectionAuthorizer(grants);
  const { withPermission } = createTestWithPermission(grants);
  return createPrismaBackedPaymentReadService(testDb.prisma, withPermission, authorizeCollection);
}

async function walk(list: ReturnType<typeof service>, pageSize?: number) {
  const ids: string[] = [];
  const totals: number[] = [];
  const sizes: number[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await list.listPaymentsForStaff({ page, pageSize });
    totals.push(result.total);
    sizes.push(result.rows.length);
    if (result.rows.length === 0) break;
    ids.push(...result.rows.map((row) => row.id));
  }
  return { ids, totals, sizes };
}

describe("listPaymentsForStaff — bounded, ordered, scoped pages on PostgreSQL", () => {
  it("a GLOBAL caller pages 50, 50, 20 newest first, each order exactly once", async () => {
    const { ids, totals, sizes } = await walk(service([grant("payments.view")]));
    expect(sizes).toEqual([50, 50, 20, 0]);
    expect(new Set(totals)).toEqual(new Set([120]));
    expect(ids).toEqual(expectedAll);
  }, TEST_DB_TIMEOUT_MS);

  it("a COHORT-scoped caller sees only their cohort's orders in the rows and the total", async () => {
    const { ids, totals, sizes } = await walk(service([grant("payments.view", "COHORT", cohortA)]));
    expect(sizes).toEqual([50, 30, 0]);
    expect(new Set(totals)).toEqual(new Set([80]));
    expect(ids).toEqual(expectedA);

    const other = await service([grant("payments.view", "COHORT", cohortB)]).listPaymentsForStaff();
    expect(other.total).toBe(40);
    expect(other.rows.every((row) => !expectedA.includes(row.id))).toBe(true);
  }, TEST_DB_TIMEOUT_MS);

  it("a page past the end is empty with the correct total", async () => {
    const result = await service([grant("payments.view")]).listPaymentsForStaff({ page: 7 });
    expect(result).toMatchObject({ rows: [], total: 120, page: 7, pageSize: 50 });
  }, TEST_DB_TIMEOUT_MS);

  it("never reads more than 100 orders, whatever page size is asked for", async () => {
    const result = await service([grant("payments.view")]).listPaymentsForStaff({ pageSize: 10_000 });
    expect(result.pageSize).toBe(100);
    expect(result.rows).toHaveLength(100);
    expect(result.rows.map((row) => row.id)).toEqual(expectedAll.slice(0, 100));
  }, TEST_DB_TIMEOUT_MS);

  it("a caller without payments.view is refused", async () => {
    await expect(service([]).listPaymentsForStaff()).rejects.toBeInstanceOf(AuthorizationError);
  }, TEST_DB_TIMEOUT_MS);
});
