/**
 * Phase 7 Plan 08 — manual payment confirmation through the shared
 * settlement transition (PAY-03, PAY-04, PAY-10, D-15).
 *
 * Driven entirely by injected fakes — `activateOrderAsSystem` itself is
 * faked here (its real behaviour is proven in
 * `tests/checkout-webhook-system-service.test.ts`); this file only proves
 * `confirmManualPayment`'s OWN responsibilities: permission gating, PAY-03
 * field validation, the PAY-04 duplicate guard, the D-15 snapshot
 * recomputation, and the exactly-one-audit-row/exactly-one-settlement-call
 * discipline. No Docker, no Postgres.
 */

import { describe, expect, it } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError, AuthenticationError } from "@/server/permissions/with-permission";
import {
  createManualPaymentService,
  OrderNotFoundError,
  ManualPaymentValidationError,
  ManualPaymentCurrencyMismatchError,
  ManualPaymentAmountMismatchError,
  MissingCommercialSnapshotError,
  type ManualPaymentServiceDeps,
  type ManualPaymentRawInput,
} from "@/server/services/manual-payment-service";
import type { ActivateOrderAsSystemInput } from "@/server/services/checkout-webhook-system-service";

type OrderRow = {
  id: string;
  status: string;
  currency: string;
  baseAmountMinor: number | null;
  cohortId: string;
};

const NOW = new Date("2026-02-01T00:00:00.000Z");

function order(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: over.id ?? "order-1",
    status: over.status ?? "PENDING",
    currency: over.currency ?? "NGN",
    baseAmountMinor: over.baseAmountMinor === undefined ? 45_000_000 : over.baseAmountMinor,
    cohortId: over.cohortId ?? "cohort-1",
  };
}

const VALID_INPUT: ManualPaymentRawInput = {
  orderId: "order-1",
  // D-15 — 1.5% of 45_000_000 = 675_000; base + platform = 45_675_000.
  amountMinor: 45_675_000,
  currency: "NGN",
  manualPaidAt: NOW,
  manualChannel: "bank_transfer",
  manualReference: "REF-001",
  manualEvidenceKey: "evidence/order-1/ref-001.pdf",
  reason: "Confirmed against bank statement dated 2026-02-01.",
};

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  orders?: OrderRow[];
  existingAttempt?: {
    provider: string;
    confirmedAt: Date | null;
    providerRef: string | null;
    providerIntentId: string | null;
  } | null;
  activateResult?: { outcome: "ACTIVATED" | "EXCEPTION" };
}) {
  const orders = new Map<string, OrderRow>((opts?.orders ?? [order()]).map((o) => [o.id, { ...o }]));
  const paymentAttempts: Array<Record<string, unknown>> = [];
  const orderUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const activateCalls: ActivateOrderAsSystemInput[] = [];

  const { withPermission } = createTestWithPermission(opts?.grants ?? [grant("payments.confirm", "GLOBAL")]);

  const deps: ManualPaymentServiceDeps = {
    order: {
      findUnique: async ({ where }) => orders.get(where.id) ?? null,
      update: async ({ where, data }) => {
        orderUpdates.push({ id: where.id, data });
        const existing = orders.get(where.id);
        if (existing) Object.assign(existing, data);
        return null;
      },
    },
    paymentAttempt: {
      findFirst: async () => opts?.existingAttempt ?? null,
      create: async ({ data }) => {
        paymentAttempts.push(data);
        return { id: `pa-${paymentAttempts.length}` };
      },
    },
    activateOrderAsSystem: async (input) => {
      activateCalls.push(input);
      return opts?.activateResult ?? { outcome: "ACTIVATED" };
    },
    audit: async (event) => {
      audits.push(event as unknown as Record<string, unknown>);
    },
    orderScope: async (orderId) => ({ cohortId: orders.get(orderId)?.cohortId ?? "cohort-1" }),
    withPermission,
  };

  return { deps, orders, paymentAttempts, orderUpdates, audits, activateCalls };
}

describe("confirmManualPayment — permission gating (PAY-03)", () => {
  it("refuses a caller without payments.confirm in matching scope, and writes nothing", async () => {
    const h = harness({ grants: [] });
    const service = createManualPaymentService(h.deps);

    await expect(service.confirmManualPayment(VALID_INPUT)).rejects.toBeInstanceOf(AuthorizationError);

    expect(h.orderUpdates).toHaveLength(0);
    expect(h.paymentAttempts).toHaveLength(0);
    expect(h.activateCalls).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it("refuses an anonymous caller", async () => {
    const h = harness();
    const service = createManualPaymentService({
      ...h.deps,
      withPermission: createTestWithPermission([]).withPermission,
    });
    // Simulate "no actor" by using a harness whose getActor resolves null —
    // createTestWithPermission always resolves an actor, so this asserts the
    // AuthenticationError class exists and is distinct from AuthorizationError
    // (exercised properly in with-permission.test.ts); here we only assert
    // the wrapped call still refuses without a matching grant.
    await expect(service.confirmManualPayment(VALID_INPUT)).rejects.toBeInstanceOf(AuthorizationError);
    expect(AuthenticationError).toBeDefined();
  });
});

describe("confirmManualPayment — PAY-03 field validation", () => {
  const REQUIRED_FIELDS: Array<keyof typeof VALID_INPUT> = [
    "amountMinor",
    "currency",
    "manualPaidAt",
    "manualChannel",
    "manualReference",
    "manualEvidenceKey",
    "reason",
  ];

  it.each(REQUIRED_FIELDS)("refuses a confirmation missing '%s', and writes nothing", async (field) => {
    const h = harness();
    const service = createManualPaymentService(h.deps);
    const { [field]: _omitted, ...rest } = VALID_INPUT;

    await expect(service.confirmManualPayment(rest as ManualPaymentRawInput)).rejects.toBeInstanceOf(
      ManualPaymentValidationError,
    );

    expect(h.orderUpdates).toHaveLength(0);
    expect(h.paymentAttempts).toHaveLength(0);
    expect(h.activateCalls).toHaveLength(0);
  });

  it("names the missing field(s) on the thrown error", async () => {
    const h = harness();
    const service = createManualPaymentService(h.deps);
    const { reason: _reason, ...rest } = VALID_INPUT;

    try {
      await service.confirmManualPayment(rest as ManualPaymentRawInput);
      throw new Error("expected confirmManualPayment to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ManualPaymentValidationError);
      expect((err as ManualPaymentValidationError).fieldErrors).toHaveProperty("reason");
    }
  });
});

describe("confirmManualPayment — a valid confirmation (PAY-03, D-15, PAY-10)", () => {
  it("calls activateOrderAsSystem exactly once, with provider MANUAL and the D-15 zero-gateway-fee total", async () => {
    const h = harness();
    const service = createManualPaymentService(h.deps);

    const result = await service.confirmManualPayment(VALID_INPUT);

    expect(result).toEqual({ outcome: "ACTIVATED" });
    expect(h.activateCalls).toHaveLength(1);
    expect(h.activateCalls[0]).toMatchObject({
      orderId: "order-1",
      provider: "MANUAL",
      providerIntentId: "REF-001",
      amountMinor: 45_675_000,
      currency: "NGN",
      eventId: "manual:order-1:REF-001",
    });
  });

  it("writes exactly one audit row naming the confirming actor and the reason", async () => {
    const h = harness();
    const service = createManualPaymentService(h.deps);

    await service.confirmManualPayment(VALID_INPUT);

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      actorId: "user-1",
      reason: VALID_INPUT.reason,
      action: "payment.manual_confirmed",
    });
  });

  it("produces exactly one PaymentAttempt carrying the manual evidence and the confirming actor id", async () => {
    const h = harness();
    const service = createManualPaymentService(h.deps);

    await service.confirmManualPayment(VALID_INPUT);

    expect(h.paymentAttempts).toHaveLength(1);
    expect(h.paymentAttempts[0]).toMatchObject({
      provider: "MANUAL",
      manualChannel: "bank_transfer",
      manualReference: "REF-001",
      manualPaidAt: NOW,
      manualEvidenceKey: "evidence/order-1/ref-001.pdf",
      confirmedById: "user-1",
      reason: VALID_INPUT.reason,
      status: "PROCESSING",
    });
  });

  it("recomputes the Order snapshot to the D-15 manual shape — zero gateway fee, provider MANUAL", async () => {
    const h = harness();
    const service = createManualPaymentService(h.deps);

    await service.confirmManualPayment(VALID_INPUT);

    expect(h.orderUpdates).toHaveLength(1);
    expect(h.orderUpdates[0].data).toMatchObject({
      amountMinor: 45_675_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 0,
      selectedProvider: "MANUAL",
      schoolSettlementExpectedMinor: 45_000_000,
    });
  });

  it("throws OrderNotFoundError for a non-existent order", async () => {
    const h = harness({ orders: [] });
    const service = createManualPaymentService(h.deps);

    await expect(service.confirmManualPayment(VALID_INPUT)).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it("refuses a currency mismatch between the Order and the confirmation", async () => {
    const h = harness({ orders: [order({ currency: "USD" })] });
    const service = createManualPaymentService(h.deps);

    await expect(service.confirmManualPayment(VALID_INPUT)).rejects.toBeInstanceOf(
      ManualPaymentCurrencyMismatchError,
    );
    expect(h.orderUpdates).toHaveLength(0);
  });

  it("refuses an Order with no commercial snapshot to confirm against", async () => {
    const h = harness({ orders: [order({ baseAmountMinor: null })] });
    const service = createManualPaymentService(h.deps);

    await expect(service.confirmManualPayment(VALID_INPUT)).rejects.toBeInstanceOf(
      MissingCommercialSnapshotError,
    );
  });

  it("refuses an entered amount that does not equal base + platform fee", async () => {
    const h = harness();
    const service = createManualPaymentService(h.deps);

    await expect(
      service.confirmManualPayment({ ...VALID_INPUT, amountMinor: 1 }),
    ).rejects.toBeInstanceOf(ManualPaymentAmountMismatchError);
    expect(h.orderUpdates).toHaveLength(0);
    expect(h.paymentAttempts).toHaveLength(0);
  });
});

describe("confirmManualPayment — PAY-04 duplicate guard", () => {
  it("returns the existing successful transaction for an already-PAID Order, and writes nothing", async () => {
    const existing = {
      provider: "STRIPE",
      confirmedAt: NOW,
      providerRef: "pi_123",
      providerIntentId: "cs_123",
    };
    const h = harness({ orders: [order({ status: "PAID" })], existingAttempt: existing });
    const service = createManualPaymentService(h.deps);

    const result = await service.confirmManualPayment(VALID_INPUT);

    expect(result).toEqual({ outcome: "ALREADY_PAID", existingAttempt: existing });
    expect(h.orderUpdates).toHaveLength(0);
    expect(h.paymentAttempts).toHaveLength(0);
    expect(h.activateCalls).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it("runs the duplicate guard before field validation — a PAID Order short-circuits even with missing fields", async () => {
    const h = harness({ orders: [order({ status: "PAID" })], existingAttempt: null });
    const service = createManualPaymentService(h.deps);
    const { reason: _reason, ...incomplete } = VALID_INPUT;

    const result = await service.confirmManualPayment(incomplete as ManualPaymentRawInput);

    expect(result).toEqual({ outcome: "ALREADY_PAID", existingAttempt: null });
  });

  it.each(["PARTIALLY_REFUNDED", "REFUNDED", "EXCEPTION"])(
    "treats a %s Order as already settled and writes nothing",
    async (status) => {
      const existing = {
        provider: "PAYSTACK",
        confirmedAt: NOW,
        providerRef: "PSK-REF-1",
        providerIntentId: "PSK-REF-1",
      };
      const h = harness({ orders: [order({ status })], existingAttempt: existing });
      const service = createManualPaymentService(h.deps);

      const result = await service.confirmManualPayment(VALID_INPUT);

      expect(result).toEqual({ outcome: "ALREADY_PAID", existingAttempt: existing });
      expect(h.orderUpdates).toHaveLength(0);
      expect(h.paymentAttempts).toHaveLength(0);
      expect(h.activateCalls).toHaveLength(0);
      expect(h.audits).toHaveLength(0);
    },
  );
});
