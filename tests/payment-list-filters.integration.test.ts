/**
 * Real-Postgres proof that the staff payments list filters, searches and
 * counts over EVERY order the caller may see, not over the 50 rows of the
 * current page (checklist rows H-07 and W-12).
 *
 * 130 orders across two cohorts, with mixed statuses and providers. The
 * interesting orders are the OLDEST ones, so they sit on the last page of the
 * unfiltered list: a filter that only looked at page 1 would never find them.
 *
 * The authorization scope is part of every query: a cohort-scoped caller's
 * rows, total and status counts never include another cohort's orders, and a
 * search for another cohort's learner finds nothing.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED; never a silent pass.
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

beforeAll(async () => {
  testDb = await startTestDatabase();
  cohortA = (await seedCohortFixture(testDb.prisma, { capacity: 5 })).cohortId;
  cohortB = (await seedCohortFixture(testDb.prisma, { capacity: 5 })).cohortId;
  const learnerA = (await seedEnrolmentFixture(testDb.prisma, { cohortId: cohortA, status: "ACTIVE" })).userId;
  const learnerB = (await seedEnrolmentFixture(testDb.prisma, { cohortId: cohortB, status: "ACTIVE" })).userId;
  await testDb.prisma.user.update({
    where: { id: learnerA },
    data: { name: "Adaeze Okonkwo", email: "adaeze.okonkwo@example.com" },
  });
  await testDb.prisma.user.update({
    where: { id: learnerB },
    data: { name: "Bolanle Zubairu", email: "bolanle.zubairu@example.com" },
  });
  const base = new Date("2026-09-01T09:00:00.000Z").getTime();

  // i = 0 is the OLDEST order (the last row of the last page), i = 129 the newest.
  //   cohort B: every 13th order (i = 0, 13, ..., 117)          -> 10 orders
  //   cohort A: the other 120
  //   status:   i < 6 EXCEPTION, 6 <= i < 10 REFUNDED, the rest PAID
  //   provider: i < 8 STRIPE, 8 <= i < 12 MANUAL, the rest PAYSTACK
  await testDb.prisma.order.createMany({
    data: Array.from({ length: 130 }, (_, i) => {
      const inB = i % 13 === 0;
      return {
        reference: `ORD-FLT-${String(i).padStart(3, "0")}`,
        userId: inB ? learnerB : learnerA,
        cohortId: inB ? cohortB : cohortA,
        amountMinor: 10_000 + i,
        currency: "NGN",
        status: i < 6 ? ("EXCEPTION" as const) : i < 10 ? ("REFUNDED" as const) : ("PAID" as const),
        selectedProvider: i < 8 ? ("STRIPE" as const) : i < 12 ? ("MANUAL" as const) : ("PAYSTACK" as const),
        idempotencyKey: `idem-flt-${i}`,
        createdAt: new Date(base + i * 60_000),
      };
    }),
  });
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

function service(grants: Parameters<typeof createTestCollectionAuthorizer>[0]) {
  const { authorizeCollection } = createTestCollectionAuthorizer(grants);
  const { withPermission } = createTestWithPermission(grants);
  return createPrismaBackedPaymentReadService(testDb.prisma, withPermission, authorizeCollection);
}

const global = () => service([grant("payments.view")]);
const scopedA = () => service([grant("payments.view", "COHORT", cohortA)]);
const scopedB = () => service([grant("payments.view", "COHORT", cohortB)]);
const refs = (rows: Array<{ reference: string }>) => rows.map((row) => row.reference);

describe("listPaymentsForStaff — filters, search and counts over every in-scope order", () => {
  it("the oldest orders are not on the first page, so a page-only filter would miss them", async () => {
    const first = await global().listPaymentsForStaff();
    expect(first.rows).toHaveLength(50);
    expect(first.total).toBe(130);
    expect(first.rows.some((row) => row.status !== "PAID")).toBe(false);
  }, TEST_DB_TIMEOUT_MS);

  it("counts each status over all 130 orders while page 1 holds only PAID ones", async () => {
    const first = await global().listPaymentsForStaff();
    expect(first.statusCounts).toEqual({ EXCEPTION: 6, REFUNDED: 4, PAID: 120 });
    expect(first.totalAll).toBe(130);
  }, TEST_DB_TIMEOUT_MS);

  it("the status filter finds orders that sit on the last unfiltered page", async () => {
    const result = await global().listPaymentsForStaff({ status: "EXCEPTION" });
    expect(result.total).toBe(6);
    expect(refs(result.rows)).toEqual([
      "ORD-FLT-005",
      "ORD-FLT-004",
      "ORD-FLT-003",
      "ORD-FLT-002",
      "ORD-FLT-001",
      "ORD-FLT-000",
    ]);
    // The counts still describe the whole scope, not the open tab.
    expect(result.statusCounts).toEqual({ EXCEPTION: 6, REFUNDED: 4, PAID: 120 });
    expect(result.totalAll).toBe(130);
  }, TEST_DB_TIMEOUT_MS);

  it("the provider filter covers every order", async () => {
    const stripe = await global().listPaymentsForStaff({ provider: "STRIPE" });
    expect(stripe.total).toBe(8);
    const manual = await global().listPaymentsForStaff({ provider: "MANUAL" });
    expect(refs(manual.rows)).toEqual(["ORD-FLT-011", "ORD-FLT-010", "ORD-FLT-009", "ORD-FLT-008"]);
    const both = await global().listPaymentsForStaff({ provider: "STRIPE", status: "REFUNDED" });
    expect(refs(both.rows)).toEqual(["ORD-FLT-007", "ORD-FLT-006"]);
  }, TEST_DB_TIMEOUT_MS);

  it("search finds one order by its reference wherever it is in the list, in any letter case", async () => {
    const result = await global().listPaymentsForStaff({ search: "ord-flt-003" });
    expect(refs(result.rows)).toEqual(["ORD-FLT-003"]);
    expect(result.total).toBe(1);
  }, TEST_DB_TIMEOUT_MS);

  it("search matches the learner's name and email across all pages", async () => {
    const byName = await global().listPaymentsForStaff({ search: "zubairu" });
    expect(byName.total).toBe(10);
    expect(byName.rows.every((row) => row.learnerName === "Bolanle Zubairu")).toBe(true);
    const byEmail = await global().listPaymentsForStaff({ search: "ADAEZE.OKONKWO@" });
    expect(byEmail.total).toBe(120);
    expect(byEmail.rows).toHaveLength(50);
  }, TEST_DB_TIMEOUT_MS);

  it("a search result is paged like the list: newest first, each order once", async () => {
    const one = await global().listPaymentsForStaff({ search: "okonkwo", page: 1 });
    const two = await global().listPaymentsForStaff({ search: "okonkwo", page: 2 });
    const three = await global().listPaymentsForStaff({ search: "okonkwo", page: 3 });
    const all = [...refs(one.rows), ...refs(two.rows), ...refs(three.rows)];
    expect([one.rows.length, two.rows.length, three.rows.length]).toEqual([50, 50, 20]);
    expect(new Set(all).size).toBe(120);
    expect(all).toEqual([...all].sort().reverse());
  }, TEST_DB_TIMEOUT_MS);

  it("the characters % and _ are searched for as they are, not as wildcards", async () => {
    expect((await global().listPaymentsForStaff({ search: "%" })).total).toBe(0);
    expect((await global().listPaymentsForStaff({ search: "ORD_FLT" })).total).toBe(0);
  }, TEST_DB_TIMEOUT_MS);

  it("a search that matches nothing returns no rows and keeps the counts", async () => {
    const result = await global().listPaymentsForStaff({ search: "no-such-payment" });
    expect(result).toMatchObject({ rows: [], total: 0, totalAll: 130 });
  }, TEST_DB_TIMEOUT_MS);
});

describe("listPaymentsForStaff — the caller's scope bounds every filter, search and count", () => {
  it("a COHORT-scoped caller's counts cover only their cohort", async () => {
    // Cohort B holds i = 0, 13, 26, ... 117: one EXCEPTION (i = 0) and nine PAID.
    const b = await scopedB().listPaymentsForStaff();
    expect(b.totalAll).toBe(10);
    expect(b.statusCounts).toEqual({ EXCEPTION: 1, PAID: 9 });
    const a = await scopedA().listPaymentsForStaff();
    expect(a.totalAll).toBe(120);
    expect(a.statusCounts).toEqual({ EXCEPTION: 5, REFUNDED: 4, PAID: 111 });
  }, TEST_DB_TIMEOUT_MS);

  it("a status filter returns only the caller's cohort's orders", async () => {
    const b = await scopedB().listPaymentsForStaff({ status: "EXCEPTION" });
    expect(refs(b.rows)).toEqual(["ORD-FLT-000"]);
    expect(b.total).toBe(1);
    const a = await scopedA().listPaymentsForStaff({ status: "EXCEPTION" });
    expect(a.total).toBe(5);
    expect(refs(a.rows)).not.toContain("ORD-FLT-000");
  }, TEST_DB_TIMEOUT_MS);

  it("searching for another cohort's order or learner finds nothing and does not change the counts", async () => {
    for (const search of ["ORD-FLT-000", "zubairu", "bolanle.zubairu@example.com"]) {
      const result = await scopedA().listPaymentsForStaff({ search });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalAll).toBe(120);
    }
    // The same searches do find the orders for a caller who may see them.
    expect((await scopedB().listPaymentsForStaff({ search: "ORD-FLT-000" })).total).toBe(1);
  }, TEST_DB_TIMEOUT_MS);

  it("a search cannot widen the scope: every row a scoped caller gets is in their cohort", async () => {
    const orders = await testDb.prisma.order.findMany({ select: { id: true, cohortId: true } });
    const cohortOf = new Map(orders.map((order) => [order.id, order.cohortId]));
    for (const options of [{ search: "ORD-FLT" }, { search: "example.com" }, { provider: "STRIPE" }, { status: "PAID" }]) {
      const result = await scopedB().listPaymentsForStaff({ ...options, pageSize: 100 });
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.every((row) => cohortOf.get(row.id) === cohortB)).toBe(true);
    }
  }, TEST_DB_TIMEOUT_MS);

  it("a caller without payments.view is refused with a filter or a search, as without one", async () => {
    await expect(service([]).listPaymentsForStaff({ status: "PAID" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service([]).listPaymentsForStaff({ search: "ORD-FLT-000" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  }, TEST_DB_TIMEOUT_MS);
});
