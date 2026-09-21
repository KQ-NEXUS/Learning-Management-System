/**
 * Phase 7 Plan 10 — the Finance payments read service (PAY-06, PAY-12, D-14,
 * D-18): permission gating, the list/detail row shapes, and the discretionary
 * three-state settlement derivation (07-UI-SPEC §7.5).
 *
 * Driven entirely by injected fakes — no Docker, no Postgres.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  createPaymentReadService,
  derivedSettlementState,
  type PaymentReadServiceDeps,
  type PaymentListOrderRow,
  type PaymentDetailOrderRow,
  type SettlementActuals,
} from "@/server/services/payment-read-service";

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
  const listCalls: number[] = [];
  const detailCalls: string[] = [];

  const deps: PaymentReadServiceDeps = {
    order: {
      findMany: async () => {
        listCalls.push(1);
        return opts?.listRows ?? [listRow()];
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
  };

  return { deps, listCalls, detailCalls };
}

// ---------------------------------------------------------------------------
// listPaymentsForStaff — permission gating and row shape
// ---------------------------------------------------------------------------

describe("listPaymentsForStaff — permission gating (RBAC-06)", () => {
  it("refuses a caller without payments.view and performs no read that could confirm a record exists", async () => {
    const h = harness({ grants: [] });
    const service = createPaymentReadService(h.deps);

    await expect(service.listPaymentsForStaff({})).rejects.toBeInstanceOf(AuthorizationError);
    expect(h.listCalls).toHaveLength(0);
  });

  it("returns rows scoped to payments.view when the grant is present", async () => {
    const h = harness({ listRows: [listRow()] });
    const service = createPaymentReadService(h.deps);

    const rows = await service.listPaymentsForStaff({});
    expect(rows).toHaveLength(1);
    expect(h.listCalls).toHaveLength(1);
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
    const [row] = await service.listPaymentsForStaff({});

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
    const [row] = await service.listPaymentsForStaff({});
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
    const [row] = await service.listPaymentsForStaff({});
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
    const [row] = await service.listPaymentsForStaff({});
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
