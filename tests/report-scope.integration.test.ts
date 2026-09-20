import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, AuthenticationError } from "@/server/permissions";
import {
  createCollectionAuthorizer,
  type CollectionAuthorizationDeps,
} from "@/server/permissions/collection-scope";
import type { RawGrant } from "@/server/permissions/with-permission";
import {
  createReportQueryService,
  type ReportQueryStore,
} from "@/server/services/report-query-service";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function grant(
  permission: RawGrant["permission"],
  scopeType: RawGrant["scopeType"],
  scopeId: string | null,
  overrides: Partial<RawGrant> = {},
): RawGrant {
  return {
    permission,
    scopeType,
    scopeId,
    active: true,
    revokedAt: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

function harness(grants: RawGrant[], actor: { userId: string } | null = { userId: "staff-1" }) {
  const audit = vi.fn(async () => {});
  const deps: CollectionAuthorizationDeps = {
    getActor: vi.fn(async () => actor),
    loadGrants: vi.fn(async () => grants),
    audit,
    now: () => NOW,
  };
  return { authorize: createCollectionAuthorizer(deps), deps, audit };
}

describe("collection report authorization", () => {
  it("requires an authenticated actor", async () => {
    const { authorize, audit } = harness([], null);
    await expect(authorize("reports.view")).rejects.toBeInstanceOf(AuthenticationError);
    expect(audit).toHaveBeenCalledOnce();
  });

  it("denies empty grants before any report query can run", async () => {
    const { authorize, audit } = harness([]);
    await expect(authorize("reports.view")).rejects.toBeInstanceOf(AuthorizationError);
    expect(audit).toHaveBeenCalledOnce();
  });

  it("turns a valid GLOBAL grant into an unrestricted trusted cohort predicate", async () => {
    const { authorize } = harness([grant("reports.view", "GLOBAL", null)]);
    await expect(authorize("reports.view")).resolves.toMatchObject({
      actor: { userId: "staff-1" },
      scope: { kind: "GLOBAL", programmeIds: [], courseIds: [], cohortIds: [] },
      cohortWhere: {},
    });
  });

  it("unions adjacent and overlapping Programme, Course, and Cohort grants deterministically", async () => {
    const { authorize } = harness([
      grant("reports.view", "COHORT", "cohort-b"),
      grant("reports.view", "PROGRAMME", "programme-a"),
      grant("reports.view", "COURSE", "course-a"),
      grant("reports.view", "COHORT", "cohort-a"),
      grant("reports.view", "COURSE", "course-a"),
      grant("payments.view", "GLOBAL", null),
    ]);

    const result = await authorize("reports.view");
    expect(result.scope).toEqual({
      kind: "LIMITED",
      programmeIds: ["programme-a"],
      courseIds: ["course-a"],
      cohortIds: ["cohort-a", "cohort-b"],
    });
    expect(result.cohortWhere).toEqual({
      OR: [
        { id: { in: ["cohort-a", "cohort-b"] } },
        { programmeId: { in: ["programme-a"] } },
        { courseId: { in: ["course-a"] } },
        { cohortCourses: { some: { courseId: { in: ["course-a"] } } } },
      ],
    });
  });

  it("drops inactive grants and rejects malformed trusted scope rows", async () => {
    const malformedGlobal = grant("reports.view", "GLOBAL", "must-be-null");
    const malformedScoped = grant("reports.view", "COHORT", null);
    const expired = grant("reports.view", "COHORT", "expired", {
      endsAt: new Date("2026-09-14T00:00:00Z"),
    });
    const { authorize } = harness([malformedGlobal, malformedScoped, expired]);
    await expect(authorize("reports.view")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("returns the same projection under repeated and concurrent reads without mutating grants", async () => {
    const grants = [
      grant("reports.view", "PROGRAMME", "programme-b"),
      grant("reports.view", "PROGRAMME", "programme-a"),
    ];
    const snapshot = structuredClone(grants);
    const { authorize } = harness(grants);
    const [first, second, third] = await Promise.all([
      authorize("reports.view"),
      authorize("reports.view"),
      authorize("reports.view"),
    ]);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(grants).toEqual(snapshot);
  });
});

const LIMITED_AUTHORIZATION = {
  actor: { userId: "staff-1" },
  permission: "reports.view" as const,
  scope: {
    kind: "LIMITED" as const,
    programmeIds: ["programme-a"],
    courseIds: [],
    cohortIds: ["cohort-a"],
  },
  cohortWhere: {
    OR: [
      { id: { in: ["cohort-a"] } },
      { programmeId: { in: ["programme-a"] } },
    ],
  },
};

function queryHarness() {
  const orderCount = vi.fn(async (args: Record<string, unknown>) => {
    void args;
    return 7;
  });
  const orderGroupBy = vi.fn(
    async (args: Record<string, unknown>): Promise<
      Array<{ currency: string; _sum: { amountMinor: number | null } }>
    > => {
      void args;
      return [
        { currency: "NGN", _sum: { amountMinor: 12_345_600 } },
        { currency: "USD", _sum: { amountMinor: 987_600 } },
      ];
    },
  );
  const enrolmentCount = vi.fn(async (args: Record<string, unknown>) => {
    void args;
    return 5;
  });
  const reconciliationCount = vi.fn(async (args: Record<string, unknown>) => {
    void args;
    return 2;
  });
  const cohortFindMany = vi.fn(async (args: Record<string, unknown>) => {
    void args;
    return [
      {
        id: "cohort-a",
        title: "Authorised cohort",
        programme: { id: "programme-a", title: "Authorised programme" },
        course: null,
      },
    ];
  });
  const store: ReportQueryStore = {
    order: { count: orderCount, groupBy: orderGroupBy },
    enrolment: { count: enrolmentCount },
    reconciliationCase: { count: reconciliationCount },
    cohort: { findMany: cohortFindMany },
  };
  const authorizeCollection = vi.fn(async () => LIMITED_AUTHORIZATION);
  const service = createReportQueryService({
    store,
    authorizeCollection,
    now: () => new Date("2026-09-15T12:34:56.000Z"),
  });
  return {
    service,
    authorizeCollection,
    orderCount,
    orderGroupBy,
    enrolmentCount,
    reconciliationCount,
    cohortFindMany,
  };
}

describe("scoped report query service", () => {
  it("normalizes one request with registry version, validated filters, scope, and one as-of", async () => {
    const { service } = queryHarness();
    const overview = await service.getHubOverview({
      from: "2026-09-01",
      to: "2026-09-30",
      programmeId: "programme-a",
      cohortId: "cohort-a",
    });

    expect(overview.request).toMatchObject({
      dataset: "registrations",
      version: "1.0",
      filters: {
        from: "2026-09-01",
        to: "2026-09-30",
        programmeId: "programme-a",
        cohortId: "cohort-a",
      },
      scope: LIMITED_AUTHORIZATION.scope,
      asOf: new Date("2026-09-15T12:34:56.000Z"),
    });
  });

  it("applies the authorized cohort predicate and identical cutoff before every aggregate", async () => {
    const {
      service,
      orderCount,
      orderGroupBy,
      enrolmentCount,
      reconciliationCount,
    } = queryHarness();
    await service.getHubOverview({ from: "2026-09-01", cohortId: "cohort-a" });

    const calls = [
      orderCount.mock.calls[0][0],
      orderGroupBy.mock.calls[0][0],
      enrolmentCount.mock.calls[0][0],
      reconciliationCount.mock.calls[0][0],
    ];
    for (const call of calls) {
      expect(JSON.stringify(call)).toContain(JSON.stringify(LIMITED_AUTHORIZATION.cohortWhere));
      expect(JSON.stringify(call)).toContain("2026-09-15T12:34:56.000Z");
      expect(JSON.stringify(call)).not.toContain("out-of-scope");
    }
  });

  it("keeps NGN and USD learner totals separate and preserves an explicit null sum", async () => {
    const { service, orderGroupBy } = queryHarness();
    orderGroupBy.mockResolvedValueOnce([
      { currency: "NGN", _sum: { amountMinor: null } },
      { currency: "USD", _sum: { amountMinor: 987_600 } },
    ]);
    const overview = await service.getHubOverview({});
    expect(overview.headlines.paymentTotals).toEqual({ NGN: null, USD: 987_600 });
    expect(overview.headlines).not.toHaveProperty("paymentTotal");
  });

  it("returns checked zero counts and zero absent currency groups only after available queries run", async () => {
    const { service, orderCount, orderGroupBy, enrolmentCount, reconciliationCount } = queryHarness();
    orderCount.mockResolvedValueOnce(0);
    orderGroupBy.mockResolvedValueOnce([]);
    enrolmentCount.mockResolvedValueOnce(0);
    reconciliationCount.mockResolvedValueOnce(0);
    const overview = await service.getHubOverview({});
    expect(overview.headlines).toEqual({
      registrations: 0,
      activeEnrolments: 0,
      unresolvedPaymentExceptions: 0,
      paymentTotals: { NGN: 0, USD: 0 },
    });
  });

  it("scope-filters option identifiers and labels and orders them deterministically", async () => {
    const { service, cohortFindMany } = queryHarness();
    const options = await service.getScopedFilterOptions({ programmeId: "programme-a" });
    expect(options).toEqual({
      programmes: [{ id: "programme-a", label: "Authorised programme" }],
      cohorts: [{ id: "cohort-a", label: "Authorised cohort" }],
    });
    expect(cohortFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: expect.arrayContaining([LIMITED_AUTHORIZATION.cohortWhere]) }),
        orderBy: [{ title: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("rejects invalid filters before querying and is side-effect free under concurrent reads", async () => {
    const { service, orderCount } = queryHarness();
    await expect(service.getHubOverview({ from: "not-a-date" })).rejects.toThrow(/filters/i);
    expect(orderCount).not.toHaveBeenCalled();

    const results = await Promise.all([
      service.getHubOverview({ cohortId: "cohort-a" }),
      service.getHubOverview({ cohortId: "cohort-a" }),
      service.getHubOverview({ cohortId: "cohort-a" }),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("uses inclusive Africa/Lagos business-day edges and derives registration metrics from the complete row projection", async () => {
    const registrationRows = [
      {
        id: "registration-a",
        reference: "REG-A",
        createdAt: new Date("2026-08-31T23:00:00.000Z"),
        user: { name: "Ada Learner", status: "ACTIVE" },
        cohort: { id: "cohort-a", title: "Authorised cohort" },
      },
      {
        id: "registration-b",
        reference: "REG-B",
        createdAt: new Date("2026-09-01T22:59:59.999Z"),
        user: { name: "Bola Learner", status: "PENDING_VERIFICATION" },
        cohort: { id: "cohort-a", title: "Authorised cohort" },
      },
    ];
    const store = {
      order: {
        count: vi.fn(async () => 0),
        groupBy: vi.fn(async () => []),
        findMany: vi.fn(async () => registrationRows),
      },
      enrolment: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
      reconciliationCase: { count: vi.fn(async () => 0) },
      cohort: { findMany: vi.fn(async () => []) },
      scheduledSession: { findMany: vi.fn(async () => []) },
      refund: { findMany: vi.fn(async () => []) },
    };
    const service = createReportQueryService({
      store: store as unknown as ReportQueryStore,
      authorizeCollection: vi.fn(async () => LIMITED_AUTHORIZATION),
      now: () => new Date("2026-09-16T00:00:00.000Z"),
    });

    const report = await service.getDatasetReport("registrations", {
      from: "2026-09-01",
      to: "2026-09-01",
    });

    expect(report.available).toBe(true);
    if (!report.available) throw new Error("Expected an available report.");
    expect(report.metrics.map(({ id, value }) => [id, value])).toEqual([
      ["total", 2],
      ["verified", 1],
      ["awaiting-verification", 1],
    ]);
    expect(report.rows.map((row) => row.id)).toEqual(["registration-a", "registration-b"]);
    expect(store.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2026-08-31T23:00:00.000Z"),
            lte: new Date("2026-09-01T22:59:59.999Z"),
          },
        }),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("projects every PAY-12 payment component without merging currencies or replacing pending actuals with zero", async () => {
    const store = {
      order: {
        count: vi.fn(async () => 0),
        groupBy: vi.fn(async () => []),
        findMany: vi.fn(async () => [
          {
            id: "order-ngn",
            reference: "ORD-NGN",
            paidAt: new Date("2026-09-10T10:00:00.000Z"),
            status: "PAID",
            selectedProvider: "PAYSTACK",
            currency: "NGN",
            amountMinor: 1_250_000,
            baseAmountMinor: 1_000_000,
            platformFeeMinor: 100_000,
            gatewayFeeEstimateMinor: 25_000,
            schoolSettlementExpectedMinor: 1_150_000,
            user: { name: "Ada Learner" },
            cohort: { id: "cohort-a", title: "Authorised cohort" },
            paymentAttempts: [{
              id: "attempt-ngn",
              provider: "PAYSTACK",
              status: "SUCCEEDED",
              confirmedAt: new Date("2026-09-10T10:00:00.000Z"),
              providerRef: "provider-ref",
              manualReference: null,
              confirmedById: null,
              gatewayFeeActualMinor: null,
              schoolSettlementActualMinor: null,
              platformGrossActualMinor: null,
              platformNetActualMinor: null,
              exceptionNote: "Awaiting settlement evidence",
            }],
            refunds: [{ id: "refund-a", amountMinor: 50_000, status: "COMPLETED", providerRef: "refund-ref" }],
            reconciliationCases: [{ id: "case-a", status: "OPEN", risk: "SETTLEMENT_DIFFERENCE" }],
          },
          {
            id: "order-usd",
            reference: "ORD-USD",
            paidAt: new Date("2026-09-11T10:00:00.000Z"),
            status: "PAID",
            selectedProvider: "STRIPE",
            currency: "USD",
            amountMinor: 25_000,
            baseAmountMinor: 20_000,
            platformFeeMinor: 2_000,
            gatewayFeeEstimateMinor: 750,
            schoolSettlementExpectedMinor: 23_000,
            user: { name: "Bola Learner" },
            cohort: { id: "cohort-a", title: "Authorised cohort" },
            paymentAttempts: [],
            refunds: [],
            reconciliationCases: [],
          },
        ]),
      },
      enrolment: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
      reconciliationCase: { count: vi.fn(async () => 0) },
      cohort: { findMany: vi.fn(async () => []) },
      scheduledSession: { findMany: vi.fn(async () => []) },
      refund: { findMany: vi.fn(async () => []) },
    };
    const service = createReportQueryService({
      store: store as unknown as ReportQueryStore,
      authorizeCollection: vi.fn(async () => LIMITED_AUTHORIZATION),
      now: () => new Date("2026-09-16T00:00:00.000Z"),
    });

    const report = await service.getDatasetReport("payments", {});
    if (!report.available) throw new Error("Expected an available report.");
    const ngn = report.rows.find((row) => row.id === "order-ngn");
    expect(ngn).toMatchObject({
      kind: "payments",
      provider: "PAYSTACK",
      currency: "NGN",
      baseAmountMinor: 1_000_000,
      platformFeeMinor: 100_000,
      gatewayFeeEstimateMinor: 25_000,
      gatewayFeeActualMinor: null,
      learnerTotalMinor: 1_250_000,
      schoolSettlementExpectedMinor: 1_150_000,
      schoolSettlementActualMinor: null,
      platformGrossActualMinor: null,
      platformNetActualMinor: null,
      refundAmountMinor: 50_000,
      exceptionContext: "Awaiting settlement evidence",
    });
    expect(report.metrics.filter((metric) => metric.format === "MONEY").map((metric) => [metric.currency, metric.value])).toEqual([
      ["NGN", 1_250_000],
      ["USD", 25_000],
    ]);
  });

  it("uses one scoped refund-row predicate for provider, currency, date and status export filters", async () => {
    const findMany = vi.fn(async () => [{
      id: "refund-a", orderId: "order-a", paymentAttemptId: "attempt-a",
      provider: "PAYSTACK" as const, currency: "NGN", amountMinor: 2_500,
      status: "COMPLETED", providerRef: "refund-ref", createdAt: new Date("2026-09-01T08:00:00.000Z"),
      completedAt: new Date("2026-09-02T08:00:00.000Z"),
      order: { reference: "ORD-A", cohort: { id: "cohort-a" } },
      paymentAttempt: { exceptionNote: "Safe variance context" }, reconciliationCases: [],
    }]);
    const store = {
      order: { count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
      enrolment: { count: vi.fn(async () => 0) },
      reconciliationCase: { count: vi.fn(async () => 0) },
      cohort: { findMany: vi.fn(async () => []) }, refund: { findMany },
    };
    const authorize = vi.fn(async (permission: string) => ({ ...LIMITED_AUTHORIZATION, permission }));
    const service = createReportQueryService({
      store: store as unknown as ReportQueryStore,
      authorizeCollection: authorize as never,
      now: () => new Date("2026-09-16T00:00:00.000Z"),
    });
    const rows = await service.getReconciliationRefundRows({
      from: "2026-09-01", to: "2026-09-01", provider: "PAYSTACK", currency: "NGN", status: "COMPLETED",
    });
    expect(rows).toEqual([{ id: "refund-a", orderId: "order-a", orderReference: "ORD-A", paymentAttemptId: "attempt-a", provider: "PAYSTACK", currency: "NGN", amountMinor: 2_500, status: "COMPLETED", providerReference: "refund-ref", businessDate: new Date("2026-09-01T08:00:00.000Z"), exceptionContext: "Safe variance context" }]);
    expect(authorize).toHaveBeenCalledWith("payments.view");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        order: { cohort: { AND: [LIMITED_AUTHORIZATION.cohortWhere, {}, {}] } },
        createdAt: { gte: new Date("2026-08-31T23:00:00.000Z"), lte: new Date("2026-09-01T22:59:59.999Z") },
        provider: "PAYSTACK", currency: "NGN", status: "COMPLETED",
      },
    }));
  });

  it("paginates stable registration rows without changing complete-row metrics", async () => {
    const findMany = vi.fn(async () => ["c", "a", "b"].map((id) => ({
      id, reference: `REG-${id}`, createdAt: new Date("2026-09-01T10:00:00.000Z"),
      user: { name: id, status: "ACTIVE" }, cohort: { id: "cohort-a", title: "Cohort A" },
    })));
    const store = {
      order: { count: vi.fn(async () => 0), groupBy: vi.fn(async () => []), findMany },
      enrolment: { count: vi.fn(async () => 0) },
      reconciliationCase: { count: vi.fn(async () => 0) }, cohort: { findMany: vi.fn(async () => []) },
    };
    const service = createReportQueryService({
      store: store as unknown as ReportQueryStore,
      authorizeCollection: vi.fn(async () => LIMITED_AUTHORIZATION),
      now: () => new Date("2026-09-16T00:00:00.000Z"),
    });
    const report = await service.getDatasetReport("registrations", { page: 2, pageSize: 2 });
    if (!report.available) throw new Error("Expected available report.");
    expect(report.totalRows).toBe(3);
    expect(report.metrics[0].value).toBe(3);
    expect(report.rows.map((row) => row.id)).toEqual(["c"]);
  });

  it("keeps successful rows and metrics visible when scoped filter options fail", async () => {
    const store = {
      order: {
        count: vi.fn(async () => 0), groupBy: vi.fn(async () => []),
        findMany: vi.fn(async () => [{ id: "one", reference: "REG-ONE", createdAt: NOW, user: { name: "Ada", status: "ACTIVE" }, cohort: { id: "cohort-a", title: "A" } }]),
      },
      enrolment: { count: vi.fn(async () => 0) },
      reconciliationCase: { count: vi.fn(async () => 0) },
      cohort: { findMany: vi.fn(async () => { throw new Error("options unavailable"); }) },
    };
    const service = createReportQueryService({
      store: store as unknown as ReportQueryStore,
      authorizeCollection: vi.fn(async () => LIMITED_AUTHORIZATION),
      now: () => new Date("2026-09-16T00:00:00.000Z"),
    });
    const report = await service.getDatasetReport("registrations", {});
    if (!report.available) throw new Error("Expected available report.");
    expect(report.metrics[0].value).toBe(1);
    expect(report.rows).toHaveLength(1);
    expect(report.sectionErrors).toEqual(["filters"]);
  });
});
