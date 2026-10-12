/**
 * Phase 7 Plan 10 — the Finance payments read service (PAY-06, PAY-12, D-14,
 * D-18): permission gating, the list/detail row shapes, and the discretionary
 * three-state settlement derivation (07-UI-SPEC §7.5).
 *
 * Driven entirely by injected fakes — no Docker, no Postgres.
 */

import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { createTestCollectionAuthorizer } from "./support/collection-harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  createPaymentReadService,
  derivedSettlementState,
  PAYMENT_LIST_MAX_PAGE_SIZE,
  PAYMENT_LIST_PAGE_SIZE,
  type PaymentListPage,
  type PaymentReadServiceDeps,
  type PaymentListOrderRow,
  type PaymentDetailOrderRow,
  type SettlementActuals,
} from "@/server/services/payment-read-service";

// Only the live list binding is replaced (for the page cases at the end);
// createPaymentReadService and everything else stay the real module.
const pageMocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/server/services/payment-read-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/payment-read-service")>()),
  listPaymentsForStaff: pageMocks.list,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/app/staff/payments/PaymentsTable", () => ({
  PaymentsTable: ({ rows, denied, ...rest }: { rows?: unknown[]; denied?: unknown } & Record<string, unknown>) =>
    createElement("div", {
      "data-table": denied ? "denied" : String(rows?.length ?? 0),
      "data-props": JSON.stringify(rest),
    }),
}));

import PaymentsPage from "@/app/staff/payments/page";

// ---------------------------------------------------------------------------
// derivedSettlementState — the three-state table
// ---------------------------------------------------------------------------

function actuals(over: Partial<SettlementActuals> = {}): SettlementActuals {
  return {
    gatewayFeeActualMinor: null,
    schoolSettlementActualMinor: null,
    platformGrossActualMinor: null,
    platformNetActualMinor: null,
    exceptionNote: null,
    ...over,
  };
}

describe("derivedSettlementState — the three-state table (07-UI-SPEC §7.5)", () => {
  it("returns ESTIMATED_ONLY when there is no attempt at all", () => {
    expect(derivedSettlementState(null)).toBe("ESTIMATED_ONLY");
  });

  it("returns ESTIMATED_ONLY when every actual field is null (D-14 — normal for a fresh payment)", () => {
    expect(derivedSettlementState(actuals())).toBe("ESTIMATED_ONLY");
  });

  it("returns RECONCILED when actuals are present and no exceptionNote was written", () => {
    expect(
      derivedSettlementState(
        actuals({
          gatewayFeeActualMinor: 500,
          schoolSettlementActualMinor: 44_500_000,
          platformGrossActualMinor: 675_000,
          platformNetActualMinor: 174_500,
        }),
      ),
    ).toBe("RECONCILED");
  });

  it("returns EXCEPTION when actuals are present and an exceptionNote was written", () => {
    expect(
      derivedSettlementState(
        actuals({
          gatewayFeeActualMinor: 500,
          schoolSettlementActualMinor: 44_000_000,
          platformGrossActualMinor: 675_000,
          platformNetActualMinor: 174_500,
          exceptionNote: "Actual school settlement 44000000 differs from expected 44500000 by more than tolerance.",
        }),
      ),
    ).toBe("EXCEPTION");
  });
});

// ---------------------------------------------------------------------------
// Service harness
// ---------------------------------------------------------------------------

function listRow(over: Partial<PaymentListOrderRow> = {}): PaymentListOrderRow {
  return {
    id: over.id ?? "order-1",
    reference: over.reference ?? "ORD-0001",
    currency: over.currency ?? "NGN",
    amountMinor: over.amountMinor ?? 45_675_000,
    status: over.status ?? "PAID",
    selectedProvider: over.selectedProvider === undefined ? "PAYSTACK" : over.selectedProvider,
    cohort: over.cohort ?? { title: "Cohort A" },
    user: over.user ?? { name: "Ada Lovelace", email: "ada@example.com" },
    paymentAttempts: over.paymentAttempts ?? [],
  };
}

function detailRow(over: Partial<PaymentDetailOrderRow> = {}): PaymentDetailOrderRow {
  return {
    id: over.id ?? "order-1",
    reference: over.reference ?? "ORD-0001",
    status: over.status ?? "PAID",
    currency: over.currency ?? "NGN",
    amountMinor: over.amountMinor ?? 45_675_000,
    baseAmountMinor: over.baseAmountMinor === undefined ? 45_000_000 : over.baseAmountMinor,
    platformFeeMinor: over.platformFeeMinor === undefined ? 675_000 : over.platformFeeMinor,
    gatewayFeeEstimateMinor: over.gatewayFeeEstimateMinor === undefined ? 450_000 : over.gatewayFeeEstimateMinor,
    schoolSettlementExpectedMinor:
      over.schoolSettlementExpectedMinor === undefined ? 45_000_000 : over.schoolSettlementExpectedMinor,
    selectedProvider: over.selectedProvider === undefined ? "PAYSTACK" : over.selectedProvider,
    user: over.user ?? { name: "Ada Lovelace", email: "ada@example.com" },
    cohort: over.cohort ?? { title: "Cohort A" },
    paymentAttempts: over.paymentAttempts ?? [],
    refunds: over.refunds ?? [],
  };
}

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  listRows?: PaymentListOrderRow[];
  detailRows?: Map<string, PaymentDetailOrderRow>;
  users?: Array<{ id: string; name: string }>;
}) {
  const { withPermission } = createTestWithPermission(opts?.grants ?? [grant("payments.view", "GLOBAL")]);
  const { authorizeCollection } = createTestCollectionAuthorizer(opts?.grants ?? [grant("payments.view", "GLOBAL")]);
  const listCalls: Array<Parameters<PaymentReadServiceDeps["order"]["findMany"]>[0]> = [];
  const countCalls: Array<Parameters<PaymentReadServiceDeps["order"]["count"]>[0]> = [];
  const statusCountCalls: Array<Parameters<PaymentReadServiceDeps["order"]["countByStatus"]>[0]> = [];
  const detailCalls: string[] = [];
  const all = () => opts?.listRows ?? [listRow()];

  const deps: PaymentReadServiceDeps = {
    order: {
      // Honours skip/take like the database would, so paging is observable.
      findMany: async (args) => {
        listCalls.push(args);
        return all().slice(args.skip, args.skip + args.take);
      },
      count: async (args) => {
        countCalls.push(args);
        return all().length;
      },
      // Counts every row the fake holds: the fake does not apply a where, so a
      // case reads `statusCountCalls` to see which where the service sent.
      countByStatus: async (args) => {
        statusCountCalls.push(args);
        const counts = new Map<string, number>();
        for (const row of all()) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
        return [...counts].map(([status, count]) => ({ status, count }));
      },
      findUnique: async ({ where }) => {
        detailCalls.push(where.id);
        return opts?.detailRows?.get(where.id) ?? null;
      },
    },
    user: {
      findMany: async ({ where }) =>
        (opts?.users ?? []).filter((u) => where.id.in.includes(u.id)),
    },
    orderScope: async (orderId) => ({ cohortId: `cohort-for-${orderId}` }),
    withPermission,
    authorizeCollection,
  };

  return { deps, listCalls, countCalls, statusCountCalls, detailCalls };
}

// ---------------------------------------------------------------------------
// listPaymentsForStaff — permission gating and row shape
// ---------------------------------------------------------------------------

describe("listPaymentsForStaff — permission gating (RBAC-06)", () => {
  it("refuses a caller without payments.view and performs no read that could confirm a record exists", async () => {
    const h = harness({ grants: [] });
    const service = createPaymentReadService(h.deps);

    await expect(service.listPaymentsForStaff()).rejects.toBeInstanceOf(AuthorizationError);
    expect(h.listCalls).toHaveLength(0);
    expect(h.countCalls).toHaveLength(0);
  });

  it("returns rows scoped to payments.view when the grant is present", async () => {
    const h = harness({ listRows: [listRow()] });
    const service = createPaymentReadService(h.deps);

    const { rows, total } = await service.listPaymentsForStaff();
    expect(rows).toHaveLength(1);
    expect(total).toBe(1);
    expect(h.listCalls).toHaveLength(1);
  });

  it("uses the same cohort-scoped where for the rows and the total (T-15-09-03)", async () => {
    const h = harness({ grants: [grant("payments.view", "COHORT", "cohort-a")] });
    const service = createPaymentReadService(h.deps);
    await service.listPaymentsForStaff();

    expect(h.listCalls[0].where).toEqual(h.countCalls[0].where);
    expect(JSON.stringify(h.listCalls[0].where)).toContain("cohort-a");
  });
});

describe("listPaymentsForStaff — bounded pages (NFR-02, T-15-09-04)", () => {
  const many = Array.from({ length: 120 }, (_, i) => listRow({ id: `order-${i + 1}`, reference: `ORD-${i + 1}` }));

  it("reads at most 50 orders by default, newest first then id, and returns the total", async () => {
    const h = harness({ listRows: many });
    const service = createPaymentReadService(h.deps);
    const result = await service.listPaymentsForStaff();

    expect(result).toMatchObject({ total: 120, page: 1, pageSize: PAYMENT_LIST_PAGE_SIZE });
    expect(result.rows).toHaveLength(50);
    expect(h.listCalls[0]).toMatchObject({ skip: 0, take: 50 });
    expect(h.listCalls[0].orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("skips to the requested page and returns the remainder on the last page", async () => {
    const h = harness({ listRows: many });
    const service = createPaymentReadService(h.deps);
    const third = await service.listPaymentsForStaff({ page: 3 });

    expect(h.listCalls[0]).toMatchObject({ skip: 100, take: 50 });
    expect(third.rows.map((r) => r.id)).toEqual(many.slice(100).map((r) => r.id));
    expect(third.total).toBe(120);
  });

  it("returns an empty page and the correct total beyond the last page", async () => {
    const h = harness({ listRows: many });
    const service = createPaymentReadService(h.deps);
    const beyond = await service.listPaymentsForStaff({ page: 9 });

    expect(beyond).toMatchObject({ rows: [], total: 120, page: 9 });
  });

  it("clamps the page size to 1..100 and an invalid page to 1", async () => {
    const h = harness({ listRows: many });
    const service = createPaymentReadService(h.deps);

    expect((await service.listPaymentsForStaff({ pageSize: 5_000 })).pageSize).toBe(PAYMENT_LIST_MAX_PAGE_SIZE);
    expect((await service.listPaymentsForStaff({ pageSize: 0 })).pageSize).toBe(1);
    expect((await service.listPaymentsForStaff({ pageSize: 2.5 })).pageSize).toBe(50);
    expect((await service.listPaymentsForStaff({ page: -4 })).page).toBe(1);
    expect((await service.listPaymentsForStaff({ page: Number.NaN })).page).toBe(1);
    for (const call of h.listCalls) expect(call.take).toBeLessThanOrEqual(100);
  });
});

describe("listPaymentsForStaff — filters, search and counts cover every in-scope order (W-12)", () => {
  const mixed = [
    listRow({ id: "o-1", status: "PAID" }),
    listRow({ id: "o-2", status: "PAID" }),
    listRow({ id: "o-3", status: "EXCEPTION" }),
    listRow({ id: "o-4", status: "PENDING" }),
  ];
  const scoped = [grant("payments.view", "COHORT", "cohort-a")];

  it("sends status, provider and search to the database for the rows and the total, inside the caller's scope", async () => {
    const h = harness({ grants: scoped, listRows: mixed });
    const service = createPaymentReadService(h.deps);
    await service.listPaymentsForStaff({ status: "EXCEPTION", provider: "STRIPE", search: "  Ada  " });

    const where = h.listCalls[0].where as Record<string, unknown>;
    expect(where).toEqual(h.countCalls[0].where);
    expect(where.status).toBe("EXCEPTION");
    expect(where.selectedProvider).toBe("STRIPE");
    expect(where.OR).toEqual([
      { reference: { contains: "Ada", mode: "insensitive" } },
      { user: { name: { contains: "Ada", mode: "insensitive" } } },
      { user: { email: { contains: "Ada", mode: "insensitive" } } },
    ]);
    // The scope is never replaced by a filter: it is the same `cohort` condition an unfiltered list sends.
    const plain = harness({ grants: scoped });
    await createPaymentReadService(plain.deps).listPaymentsForStaff();
    expect(where.cohort).toEqual((plain.listCalls[0].where as Record<string, unknown>).cohort);
    expect(JSON.stringify(where.cohort)).toContain("cohort-a");
  });

  it("counts each status over the caller's whole scope, whatever tab, provider or search is active", async () => {
    const h = harness({ grants: scoped, listRows: mixed });
    const service = createPaymentReadService(h.deps);
    const result = await service.listPaymentsForStaff({ status: "EXCEPTION", provider: "STRIPE", search: "ada" });

    expect(h.statusCountCalls).toHaveLength(1);
    const countWhere = h.statusCountCalls[0].where as Record<string, unknown>;
    expect(Object.keys(countWhere)).toEqual(["cohort"]);
    expect(JSON.stringify(countWhere.cohort)).toContain("cohort-a");
    expect(result.statusCounts).toEqual({ PAID: 2, EXCEPTION: 1, PENDING: 1 });
    expect(result.totalAll).toBe(4);
  });

  it("reports the filters it applied", async () => {
    const h = harness({ listRows: mixed });
    const result = await createPaymentReadService(h.deps).listPaymentsForStaff({
      status: "PAID",
      provider: "MANUAL",
      search: " ORD-1 ",
    });
    expect(result.filters).toEqual({ status: "PAID", provider: "MANUAL", search: "ORD-1" });
  });

  it("ignores a status or provider that is not a known one, and a blank search", async () => {
    const h = harness({ listRows: mixed });
    const service = createPaymentReadService(h.deps);
    for (const value of ["paid", "NOPE", "toString", "constructor", "__proto__", ""]) {
      const result = await service.listPaymentsForStaff({ status: value, provider: value, search: "   " });
      expect(result.filters).toEqual({ status: "", provider: "", search: "" });
    }
    for (const call of h.listCalls) expect(Object.keys(call.where)).toEqual(["cohort"]);
    for (const call of h.countCalls) expect(Object.keys(call.where)).toEqual(["cohort"]);
  });

  it("escapes the pattern characters % _ and \\ so they are searched for as typed", async () => {
    const h = harness({ listRows: mixed });
    const result = await createPaymentReadService(h.deps).listPaymentsForStaff({ search: "50%_a\\b" });
    const where = h.listCalls[0].where as { OR: Array<{ reference?: { contains: string } }> };
    expect(where.OR[0].reference?.contains).toBe("50\\%\\_a\\\\b");
    // What is reported back (and shown in the box) is what was typed.
    expect(result.filters.search).toBe("50%_a\\b");
  });

  it("cuts a very long search to 100 characters", async () => {
    const h = harness({ listRows: mixed });
    const result = await createPaymentReadService(h.deps).listPaymentsForStaff({ search: "x".repeat(5_000) });
    expect(result.filters.search).toHaveLength(100);
  });

  it("a caller without payments.view is refused before any filter is read", async () => {
    const h = harness({ grants: [] });
    await expect(
      createPaymentReadService(h.deps).listPaymentsForStaff({ status: "PAID", search: "ada" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(h.listCalls).toHaveLength(0);
    expect(h.countCalls).toHaveLength(0);
    expect(h.statusCountCalls).toHaveLength(0);
  });
});

describe("listPaymentsForStaff — row shape (07-UI-SPEC §7.5)", () => {
  it("maps an Order row to the flat list view-model, with provider as a plain string field (never a status/tone wrapper)", async () => {
    const h = harness({
      listRows: [
        listRow({
          id: "order-1",
          reference: "ORD-0001",
          selectedProvider: "PAYSTACK",
          cohort: { title: "Data Science Cohort" },
          user: { name: "Grace Hopper", email: "grace@example.com" },
        }),
      ],
    });
    const service = createPaymentReadService(h.deps);
    const {
      rows: [row],
    } = await service.listPaymentsForStaff();

    expect(row).toMatchObject({
      id: "order-1",
      reference: "ORD-0001",
      cohortTitle: "Data Science Cohort",
      learnerName: "Grace Hopper",
      learnerEmail: "grace@example.com",
      provider: "PAYSTACK",
    });
    // Provider is a bare string — asserting the type shape here is what makes
    // "renders as plain text, never a StatusPill" true at the data layer; a
    // StatusPill would need a `{ label, tone }` shape, not a raw string.
    expect(typeof row.provider).toBe("string");
  });

  it("derives ESTIMATED_ONLY for a fresh PAID order with no reconciled attempt yet", async () => {
    const h = harness({
      listRows: [listRow({ paymentAttempts: [] })],
    });
    const service = createPaymentReadService(h.deps);
    const {
      rows: [row],
    } = await service.listPaymentsForStaff();
    expect(row.settlementState).toBe("ESTIMATED_ONLY");
  });

  it("derives RECONCILED once the latest SUCCEEDED attempt carries actuals with no exception", async () => {
    const h = harness({
      listRows: [
        listRow({
          paymentAttempts: [
            {
              status: "SUCCEEDED",
              confirmedAt: new Date("2026-02-01T00:00:00Z"),
              gatewayFeeActualMinor: 500,
              schoolSettlementActualMinor: 45_000_000,
              platformGrossActualMinor: 675_000,
              platformNetActualMinor: 174_500,
              exceptionNote: null,
            },
          ],
        }),
      ],
    });
    const service = createPaymentReadService(h.deps);
    const {
      rows: [row],
    } = await service.listPaymentsForStaff();
    expect(row.settlementState).toBe("RECONCILED");
  });

  it("derives EXCEPTION once the latest SUCCEEDED attempt carries an exceptionNote", async () => {
    const h = harness({
      listRows: [
        listRow({
          paymentAttempts: [
            {
              status: "SUCCEEDED",
              confirmedAt: new Date("2026-02-01T00:00:00Z"),
              gatewayFeeActualMinor: 500,
              schoolSettlementActualMinor: 44_000_000,
              platformGrossActualMinor: 675_000,
              platformNetActualMinor: 174_500,
              exceptionNote: "Variance beyond tolerance.",
            },
          ],
        }),
      ],
    });
    const service = createPaymentReadService(h.deps);
    const {
      rows: [row],
    } = await service.listPaymentsForStaff();
    expect(row.settlementState).toBe("EXCEPTION");
  });
});

// ---------------------------------------------------------------------------
// getPaymentDetailForStaff
// ---------------------------------------------------------------------------

describe("getPaymentDetailForStaff — permission gating and shape (D-14, D-18, PAY-04, PAY-05)", () => {
  it("refuses a caller without payments.view in the Order's cohort scope", async () => {
    const h = harness({ grants: [], detailRows: new Map([["order-1", detailRow()]]) });
    const service = createPaymentReadService(h.deps);
    await expect(service.getPaymentDetailForStaff("order-1")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("returns null for a missing Order rather than leaking existence through a different error shape", async () => {
    const h = harness({ detailRows: new Map() });
    const service = createPaymentReadService(h.deps);
    expect(await service.getPaymentDetailForStaff("order-missing")).toBeNull();
  });

  it("renders every unresolved actual field as null, never 0, when no attempt has reconciled yet", async () => {
    const h = harness({
      detailRows: new Map([
        [
          "order-1",
          detailRow({
            paymentAttempts: [
              {
                provider: "PAYSTACK",
                status: "SUCCEEDED",
                confirmedAt: new Date("2026-02-01T00:00:00Z"),
                providerRef: "PSK-1",
                providerIntentId: "PSK-1",
                gatewayFeeActualMinor: null,
                schoolSettlementActualMinor: null,
                platformGrossActualMinor: null,
                platformNetActualMinor: null,
                exceptionNote: null,
              },
            ],
          }),
        ],
      ]),
    });
    const service = createPaymentReadService(h.deps);
    const detail = await service.getPaymentDetailForStaff("order-1");

    expect(detail?.actual).toEqual({
      schoolSettlementActualMinor: null,
      platformGrossActualMinor: null,
      gatewayFeeActualMinor: null,
      platformNetActualMinor: null,
    });
    expect(detail?.settlementState).toBe("ESTIMATED_ONLY");
  });

  it("populates existingAttempt from the latest SUCCEEDED PaymentAttempt for the PAY-04 already-paid banner", async () => {
    const h = harness({
      detailRows: new Map([
        [
          "order-1",
          detailRow({
            status: "PAID",
            paymentAttempts: [
              {
                provider: "PAYSTACK",
                status: "SUCCEEDED",
                confirmedAt: new Date("2026-02-01T00:00:00Z"),
                providerRef: "PSK-1",
                providerIntentId: "PSK-1",
                gatewayFeeActualMinor: null,
                schoolSettlementActualMinor: null,
                platformGrossActualMinor: null,
                platformNetActualMinor: null,
                exceptionNote: null,
              },
            ],
          }),
        ],
      ]),
    });
    const service = createPaymentReadService(h.deps);
    const detail = await service.getPaymentDetailForStaff("order-1");

    expect(detail?.existingAttempt).toEqual({
      provider: "PAYSTACK",
      confirmedAt: new Date("2026-02-01T00:00:00Z"),
      providerRef: "PSK-1",
      providerIntentId: "PSK-1",
    });
  });

  it("caps eligibleRefundMinor at the learner total minus non-FAILED refunds, and never below 0", async () => {
    const h = harness({
      detailRows: new Map([
        [
          "order-1",
          detailRow({
            amountMinor: 45_675_000,
            paymentAttempts: [
              {
                provider: "PAYSTACK",
                status: "SUCCEEDED",
                confirmedAt: new Date("2026-02-01T00:00:00Z"),
                providerRef: "PSK-1",
                providerIntentId: "PSK-1",
                gatewayFeeActualMinor: null,
                schoolSettlementActualMinor: null,
                platformGrossActualMinor: null,
                platformNetActualMinor: null,
                exceptionNote: null,
              },
            ],
            refunds: [
              {
                id: "refund-1",
                providerRef: "re_3Nx92",
                amountMinor: 20_000_000,
                currency: "NGN",
                status: "COMPLETED",
                actorId: "user-1",
                createdAt: new Date("2026-02-05T00:00:00Z"),
              },
              {
                id: "refund-2",
                amountMinor: 5_000_000,
                currency: "NGN",
                status: "FAILED",
                actorId: "user-1",
                createdAt: new Date("2026-02-06T00:00:00Z"),
              },
            ],
          }),
        ],
      ]),
      users: [{ id: "user-1", name: "Finance Officer" }],
    });
    const service = createPaymentReadService(h.deps);
    const detail = await service.getPaymentDetailForStaff("order-1");

    // 45_675_000 - 20_000_000 (COMPLETED only, FAILED excluded) = 25_675_000.
    expect(detail?.eligibleRefundMinor).toBe(25_675_000);
    expect(detail?.refunds).toHaveLength(2);
    expect(detail?.refunds[0]).toMatchObject({ id: "refund-1", actorName: "Finance Officer" });
    // The reference staff see is the provider's own, and it is null (never the database id) until there is one.
    expect(detail?.refunds[0]?.providerRef).toBe("re_3Nx92");
    expect(detail?.refunds[1]?.providerRef).toBeNull();
  });

  it("returns eligibleRefundMinor of 0 when no payment was ever captured, regardless of the learner total", async () => {
    const h = harness({
      detailRows: new Map([["order-1", detailRow({ status: "PENDING", paymentAttempts: [] })]]),
    });
    const service = createPaymentReadService(h.deps);
    const detail = await service.getPaymentDetailForStaff("order-1");
    expect(detail?.eligibleRefundMinor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// /staff/payments — the paged page (NFR-02)
// ---------------------------------------------------------------------------

describe("/staff/payments page — one bounded page with Previous and Next", () => {
  function pageOf(page: number, total: number, pageSize = 50): PaymentListPage {
    const count = Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
    return {
      rows: Array.from({ length: count }, (_, i) => ({ id: `o-${i}` }) as unknown as PaymentListPage["rows"][number]),
      total,
      page,
      pageSize,
      totalAll: 300,
      statusCounts: { PAID: 280, EXCEPTION: 20 },
      filters: { status: "", provider: "", search: "" },
    };
  }

  function tableProps(html: string): Record<string, unknown> {
    const raw = /data-props="([^"]*)"/.exec(html)?.[1] ?? "{}";
    return JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  }

  async function render(searchParams: Record<string, string | string[]>) {
    return renderToStaticMarkup(await PaymentsPage({ searchParams: Promise.resolve(searchParams) }));
  }

  beforeEach(() => {
    pageMocks.list.mockReset();
    pageMocks.list.mockImplementation(async ({ page }: { page: number }) => pageOf(page, 120));
  });

  it("renders 'Showing {n} of {total}.' and only a Next link on the first page", async () => {
    const html = await render({});
    expect(pageMocks.list).toHaveBeenCalledWith({ page: 1 });
    expect(html).toContain("Showing 50 of 120.");
    expect(html).toContain('href="/staff/payments?page=2"');
    expect(html).toContain(">Next<");
    expect(html).not.toContain(">Previous<");
  });

  it("renders both links on a middle page and keeps a known status tab in them", async () => {
    const html = await render({ page: "2", status: "EXCEPTION" });
    expect(pageMocks.list).toHaveBeenCalledWith({ page: 2, status: "EXCEPTION" });
    expect(html).toContain('href="/staff/payments?status=EXCEPTION"');
    expect(html).toContain('href="/staff/payments?status=EXCEPTION&amp;page=3"');
  });

  it("renders only a Previous link on the last page", async () => {
    const html = await render({ page: "3" });
    expect(html).toContain("Showing 20 of 120.");
    expect(html).toContain(">Previous<");
    expect(html).not.toContain(">Next<");
  });

  it("falls back to page 1 for an invalid page parameter", async () => {
    for (const page of ["0", "-2", "abc", "1.5", "1e3", "999999", ""]) {
      pageMocks.list.mockClear();
      await render({ page });
      expect(pageMocks.list).toHaveBeenCalledWith({ page: 1 });
    }
    pageMocks.list.mockClear();
    await render({ page: ["2", "3"] });
    expect(pageMocks.list).toHaveBeenCalledWith({ page: 2 });
  });

  it("shows the last page instead of an empty table for a page past the end", async () => {
    const html = await render({ page: "40" });
    expect(pageMocks.list).toHaveBeenNthCalledWith(1, { page: 40 });
    expect(pageMocks.list).toHaveBeenNthCalledWith(2, { page: 3 });
    expect(html).toContain("Showing 20 of 120.");
  });

  it("renders no paging line when there are no orders, and the denied table on a denial", async () => {
    pageMocks.list.mockImplementation(async () => pageOf(1, 0));
    expect(await render({})).not.toContain("Showing");
    pageMocks.list.mockRejectedValue(new AuthorizationError("payments.view"));
    const denied = await render({});
    expect(denied).toContain('data-table="denied"');
    expect(denied).not.toContain("Showing");
  });

  it("asks the service for the status, provider and search in the address (W-12)", async () => {
    await render({ status: "PAID", provider: "STRIPE", q: " ada " });
    expect(pageMocks.list).toHaveBeenCalledWith({ page: 1, status: "PAID", provider: "STRIPE", search: "ada" });
  });

  it("drops a status or provider that is not a known one and never sends it to the service", async () => {
    await render({ status: "NOPE", provider: "constructor", q: ["a", "b"] });
    expect(pageMocks.list).toHaveBeenCalledWith({ page: 1 });
  });

  it("keeps the status, provider and search in the Previous and Next links", async () => {
    const html = await render({ page: "2", status: "PAID", provider: "STRIPE", q: "ada" });
    expect(html).toContain('href="/staff/payments?status=PAID&amp;provider=STRIPE&amp;q=ada"');
    expect(html).toContain('href="/staff/payments?status=PAID&amp;provider=STRIPE&amp;q=ada&amp;page=3"');
  });

  it("gives the table the counts for every order in scope, not for the rows on the page", async () => {
    const props = tableProps(await render({ status: "EXCEPTION", q: "ada" }));
    expect(props).toMatchObject({
      initialStatus: "EXCEPTION",
      provider: "",
      search: "ada",
      matchingCount: 120,
      totalAll: 300,
      statusCounts: { PAID: 280, EXCEPTION: 20 },
    });
  });

  it("shows the last page when a filter leaves fewer pages than the address asks for", async () => {
    pageMocks.list.mockImplementation(async ({ page }: { page: number }) => pageOf(page, 60));
    const html = await render({ page: "5", status: "PAID" });
    expect(pageMocks.list).toHaveBeenLastCalledWith({ page: 2, status: "PAID" });
    expect(html).toContain("Showing 10 of 60.");
  });
});

// ---------------------------------------------------------------------------
// Staff nav — one new entry, no more
// ---------------------------------------------------------------------------

describe("staff/layout.tsx — nav (07-UI-SPEC §2)", () => {
  it("gains exactly one 'Payments' entry, positioned after 'Enrolments'", () => {
    const source = readFileSync("src/app/staff/layout.tsx", "utf8");
    const matches = source.match(/label:\s*"Payments"/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(source.indexOf('label: "Payments"')).toBeGreaterThan(source.indexOf('label: "Enrolments"'));
  });
});
