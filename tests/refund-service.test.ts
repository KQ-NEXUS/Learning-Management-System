/**
 * Phase 7 Plan 08 — component-aware refunds routed to the original provider
 * (PAY-05, PAY-13, D-22, D-23, D-24).
 *
 * Driven entirely by injected fakes — the real Paystack/Stripe network calls
 * are faked here; `providers/paystack/refund.ts`/`providers/stripe/refund.ts`'s
 * own pure builders (`buildPaystackRefundRequest`/`buildStripeRefundRequest`)
 * are exercised directly too, so the exact request shape (including
 * `reverse_transfer`) is asserted by reading a built object, not a comment.
 * No Docker, no Postgres.
 */

import { describe, expect, it } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  createRefundService,
  allocateRefundComponents,
  OrderNotFoundError,
  NoCapturedPaymentError,
  RefundExceedsEligibleValueError,
  RefundValidationError,
  type RefundServiceDeps,
  type RefundRawInput,
  type RefundOrderRow,
  type RefundPaymentAttemptRow,
} from "@/server/services/refund-service";
import { buildPaystackRefundRequest } from "@/server/payments/providers/paystack/refund";
import { buildStripeRefundRequest } from "@/server/payments/providers/stripe/refund";

const NOW = new Date("2026-02-01T00:00:00.000Z");

function order(over: Partial<RefundOrderRow> = {}): RefundOrderRow {
  return {
    id: over.id ?? "order-1",
    currency: over.currency ?? "NGN",
    // D-25 worked example: base 45_000_000, platform 675_000, gateway 200_000 -> total 45_875_000.
    amountMinor: over.amountMinor === undefined ? 45_875_000 : over.amountMinor,
    baseAmountMinor: over.baseAmountMinor === undefined ? 45_000_000 : over.baseAmountMinor,
    platformFeeMinor: over.platformFeeMinor === undefined ? 675_000 : over.platformFeeMinor,
    gatewayFeeEstimateMinor: over.gatewayFeeEstimateMinor === undefined ? 200_000 : over.gatewayFeeEstimateMinor,
  };
}

function attempt(over: Partial<RefundPaymentAttemptRow> = {}): RefundPaymentAttemptRow {
  return {
    id: over.id ?? "pa-1",
    provider: over.provider ?? "PAYSTACK",
    providerIntentId: over.providerIntentId === undefined ? "PSK-TXN-1" : over.providerIntentId,
    evidence: over.evidence === undefined ? null : over.evidence,
  };
}

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  orders?: RefundOrderRow[];
  attempts?: RefundPaymentAttemptRow[];
  alreadyRefundedMinor?: number;
  paystackOutcome?: { id: number; status: string; amount: number; currency: string };
  stripeOutcome?: { id: string; status: string; amount: number; currency: string };
  paystackThrows?: Error;
  stripeThrows?: Error;
}) {
  const orders = new Map<string, RefundOrderRow>((opts?.orders ?? [order()]).map((o) => [o.id, { ...o }]));
  const attempts = opts?.attempts ?? [attempt()];
  const refunds: Array<Record<string, unknown>> = [];
  const orderUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const paystackCalls: Array<Record<string, unknown>> = [];
  const stripeCalls: Array<Record<string, unknown>> = [];

  const { withPermission } = createTestWithPermission(opts?.grants ?? [grant("refunds.manage", "GLOBAL")]);

  // Dynamic — the base offset (`opts.alreadyRefundedMinor`, simulating a
  // refund history this test never itself creates) PLUS whatever this test's
  // own `recordRefund` calls have actually reserved/created so far
  // (including a live PROCESSING reservation) — a second sequential call
  // within the same test correctly sees the first's committed total, exactly
  // as the real `SELECT ... FOR UPDATE`-guarded aggregate would.
  const aggregateRefundedMinor = () =>
    (opts?.alreadyRefundedMinor ?? 0) +
    refunds.filter((r) => r.status !== "FAILED").reduce((sum, r) => sum + (r.amountMinor as number), 0);

  const deps: RefundServiceDeps = {
    db: {
      $transaction: async (fn) =>
        fn({
          lockOrder: async ({ orderId }) => orders.get(orderId) ?? null,
          paymentAttempt: {
            findFirst: async () => attempts[0] ?? null,
          },
          refund: {
            aggregateRefundedMinor: async () => aggregateRefundedMinor(),
            create: async ({ data }) => {
              const id = `refund-${refunds.length + 1}`;
              refunds.push({ id, ...data });
              return { id };
            },
          },
        }),
    },
    refund: {
      update: async ({ where, data }) => {
        const existing = refunds.find((r) => r.id === where.id);
        if (existing) Object.assign(existing, data);
        return null;
      },
    },
    order: {
      update: async ({ where, data }) => {
        orderUpdates.push({ id: where.id, data });
        const existing = orders.get(where.id);
        if (existing) Object.assign(existing, data);
        return null;
      },
    },
    paystackRefund: async (body) => {
      paystackCalls.push(body);
      if (opts?.paystackThrows) throw opts.paystackThrows;
      return opts?.paystackOutcome ?? { id: 999, status: "processed", amount: 45_875_000, currency: "NGN" };
    },
    stripeRefund: async (params) => {
      stripeCalls.push(params);
      if (opts?.stripeThrows) throw opts.stripeThrows;
      return opts?.stripeOutcome ?? { id: "re_123", status: "succeeded", amount: 45_875_000, currency: "usd" };
    },
    orderScope: async () => ({ cohortId: "cohort-1" }),
    withPermission,
    audit: async (event) => {
      audits.push(event as unknown as Record<string, unknown>);
    },
    now: () => NOW,
  };

  return { deps, orders, refunds, orderUpdates, audits, paystackCalls, stripeCalls };
}

const FULL_INPUT: RefundRawInput = {
  orderId: "order-1",
  amountMinor: 45_875_000,
  reason: "Learner cancelled before the cohort started.",
  accessDecision: "REVOKED",
};

describe("allocateRefundComponents — pure, integer-only (D-24)", () => {
  const TABLE: Array<{
    name: string;
    order: Partial<{ baseAmountMinor: number | null; platformFeeMinor: number | null; gatewayFeeEstimateMinor: number | null }>;
    refundAmountMinor: number;
    alreadyRefundedMinor: number;
    expected: { baseComponentMinor: number; platformComponentMinor: number; gatewayComponentMinor: number; nonRecoverableMinor: number };
  }> = [
    {
      name: "a full refund allocates the whole learner total across all three components",
      order: { baseAmountMinor: 45_000_000, platformFeeMinor: 675_000, gatewayFeeEstimateMinor: 200_000 },
      refundAmountMinor: 45_875_000,
      alreadyRefundedMinor: 0,
      expected: { baseComponentMinor: 45_000_000, platformComponentMinor: 675_000, gatewayComponentMinor: 200_000, nonRecoverableMinor: 0 },
    },
    {
      name: "a partial refund smaller than the base component consumes only base",
      order: { baseAmountMinor: 45_000_000, platformFeeMinor: 675_000, gatewayFeeEstimateMinor: 200_000 },
      refundAmountMinor: 10_000_000,
      alreadyRefundedMinor: 0,
      expected: { baseComponentMinor: 10_000_000, platformComponentMinor: 0, gatewayComponentMinor: 0, nonRecoverableMinor: 0 },
    },
    {
      name: "a partial refund exceeding base spills into platform, never touching gateway",
      order: { baseAmountMinor: 45_000_000, platformFeeMinor: 675_000, gatewayFeeEstimateMinor: 200_000 },
      refundAmountMinor: 45_500_000,
      alreadyRefundedMinor: 0,
      expected: { baseComponentMinor: 45_000_000, platformComponentMinor: 500_000, gatewayComponentMinor: 0, nonRecoverableMinor: 0 },
    },
    {
      name: "two partial refunds summing to the learner total — the second call resumes from what the first consumed",
      order: { baseAmountMinor: 45_000_000, platformFeeMinor: 675_000, gatewayFeeEstimateMinor: 200_000 },
      refundAmountMinor: 22_875_000, // the remainder after a first refund of 23_000_000
      alreadyRefundedMinor: 23_000_000,
      expected: { baseComponentMinor: 22_000_000, platformComponentMinor: 675_000, gatewayComponentMinor: 200_000, nonRecoverableMinor: 0 },
    },
    {
      name: "a MANUAL order (zero gateway component) allocates only base and platform",
      order: { baseAmountMinor: 45_000_000, platformFeeMinor: 675_000, gatewayFeeEstimateMinor: 0 },
      refundAmountMinor: 45_675_000,
      alreadyRefundedMinor: 0,
      expected: { baseComponentMinor: 45_000_000, platformComponentMinor: 675_000, gatewayComponentMinor: 0, nonRecoverableMinor: 0 },
    },
    {
      name: "a null Order snapshot (defence in depth) treats every component as zero, everything non-recoverable",
      order: { baseAmountMinor: null, platformFeeMinor: null, gatewayFeeEstimateMinor: null },
      refundAmountMinor: 5_000,
      alreadyRefundedMinor: 0,
      expected: { baseComponentMinor: 0, platformComponentMinor: 0, gatewayComponentMinor: 0, nonRecoverableMinor: 5_000 },
    },
  ];

  it.each(TABLE)("$name", ({ order: orderSnapshot, refundAmountMinor, alreadyRefundedMinor, expected }) => {
    const result = allocateRefundComponents(
      {
        baseAmountMinor: orderSnapshot.baseAmountMinor ?? null,
        platformFeeMinor: orderSnapshot.platformFeeMinor ?? null,
        gatewayFeeEstimateMinor: orderSnapshot.gatewayFeeEstimateMinor ?? null,
      },
      refundAmountMinor,
      alreadyRefundedMinor,
    );
    expect(result).toEqual(expected);
    // Property: the four components always sum EXACTLY to the refunded amount.
    expect(
      result.baseComponentMinor + result.platformComponentMinor + result.gatewayComponentMinor + result.nonRecoverableMinor,
    ).toBe(refundAmountMinor);
  });
});

describe("recordRefund — permission gating (PAY-05)", () => {
  it("refuses a caller without refunds.manage, and writes nothing", async () => {
    const h = harness({ grants: [] });
    const service = createRefundService(h.deps);

    await expect(service.recordRefund(FULL_INPUT)).rejects.toBeInstanceOf(AuthorizationError);

    expect(h.refunds).toHaveLength(0);
    expect(h.orderUpdates).toHaveLength(0);
    expect(h.paystackCalls).toHaveLength(0);
  });
});

describe("recordRefund — field validation", () => {
  it("refuses a refund missing a required field", async () => {
    const h = harness();
    const service = createRefundService(h.deps);
    const { reason: _reason, ...rest } = FULL_INPUT;

    await expect(service.recordRefund(rest as RefundRawInput)).rejects.toBeInstanceOf(RefundValidationError);
    expect(h.refunds).toHaveLength(0);
  });
});

describe("recordRefund — eligible-value cap (PAY-05, D-22)", () => {
  it("refuses a refund with no captured payment to refund against", async () => {
    const h = harness({ attempts: [] });
    const service = createRefundService(h.deps);

    await expect(service.recordRefund(FULL_INPUT)).rejects.toBeInstanceOf(NoCapturedPaymentError);
  });

  it("refuses an amount exceeding eligible value, naming the eligible figure", async () => {
    const h = harness();
    const service = createRefundService(h.deps);

    try {
      await service.recordRefund({ ...FULL_INPUT, amountMinor: 45_875_001 });
      throw new Error("expected recordRefund to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RefundExceedsEligibleValueError);
      expect((err as RefundExceedsEligibleValueError).eligibleMinor).toBe(45_875_000);
      expect((err as RefundExceedsEligibleValueError).message).toContain("45875000");
    }
    expect(h.refunds).toHaveLength(0);
  });

  it("refuses any positive amount once the eligible value is already fully consumed", async () => {
    const h = harness({ alreadyRefundedMinor: 45_875_000 });
    const service = createRefundService(h.deps);

    await expect(service.recordRefund({ ...FULL_INPUT, amountMinor: 1 })).rejects.toBeInstanceOf(
      RefundExceedsEligibleValueError,
    );
  });

  it("permits a second partial refund that exactly exhausts the remaining eligible value", async () => {
    const h = harness({ alreadyRefundedMinor: 23_000_000 });
    const service = createRefundService(h.deps);

    const result = await service.recordRefund({ ...FULL_INPUT, amountMinor: 22_875_000 });

    expect(result.status).toBe("COMPLETED");
    expect(h.refunds).toHaveLength(1);
  });
});

describe("recordRefund — routes to the original provider", () => {
  it("routes a PAYSTACK-captured order to the Paystack refund adapter", async () => {
    const h = harness({ attempts: [attempt({ provider: "PAYSTACK", providerIntentId: "PSK-TXN-1" })] });
    const service = createRefundService(h.deps);

    const result = await service.recordRefund(FULL_INPUT);

    expect(result.status).toBe("COMPLETED");
    expect(h.paystackCalls).toHaveLength(1);
    expect(h.paystackCalls[0]).toMatchObject({ transaction: "PSK-TXN-1", currency: "NGN" });
    // A full refund omits `amount` entirely (Paystack's own "refund everything" shape).
    expect(h.paystackCalls[0]).not.toHaveProperty("amount");
    expect(h.refunds[0]).toMatchObject({ provider: "PAYSTACK", providerRef: "999" });
  });

  // `providerIntentId` on a real STRIPE attempt holds the Checkout Session id
  // (`cs_...`), captured at order INITIATION — never a PaymentIntent id. Every
  // fixture below models that real shape (never a `pi_...`-shaped
  // `providerIntentId`, which would mask exactly the bug these tests exist to
  // catch) and supplies the real PaymentIntent id separately via
  // `evidence.paymentIntentId`, matching `buildStripeSettlementEvidence`'s
  // actual settlement-time write (checkout-webhook-system-service.ts).
  it("routes a STRIPE-captured order to the Stripe refund adapter using the PaymentIntent id from evidence, not the Checkout Session id, with reverse_transfer explicit", async () => {
    const h = harness({
      orders: [order({ currency: "USD" })],
      attempts: [
        attempt({
          provider: "STRIPE",
          providerIntentId: "cs_test_session_123",
          evidence: { paymentIntentId: "pi_123" },
        }),
      ],
    });
    const service = createRefundService(h.deps);

    const result = await service.recordRefund(FULL_INPUT);

    expect(result.status).toBe("COMPLETED");
    expect(h.stripeCalls).toHaveLength(1);
    expect(h.stripeCalls[0]).toMatchObject({ payment_intent: "pi_123", reverse_transfer: true });
  });

  it("passes reverse_transfer: false for a partial Stripe refund (07-01 Decision A)", async () => {
    const h = harness({
      orders: [order({ currency: "USD" })],
      attempts: [
        attempt({
          provider: "STRIPE",
          providerIntentId: "cs_test_session_123",
          evidence: { paymentIntentId: "pi_123" },
        }),
      ],
    });
    const service = createRefundService(h.deps);

    await service.recordRefund({ ...FULL_INPUT, amountMinor: 10_000_000 });

    expect(h.stripeCalls[0]).toMatchObject({ payment_intent: "pi_123", reverse_transfer: false, amount: 10_000_000 });
  });

  it("falls back to providerIntentId for a Stripe refund when evidence carries no usable PaymentIntent id (older/non-expanded delivery)", async () => {
    const h = harness({
      orders: [order({ currency: "USD" })],
      attempts: [attempt({ provider: "STRIPE", providerIntentId: "pi_legacy_456", evidence: null })],
    });
    const service = createRefundService(h.deps);

    await service.recordRefund(FULL_INPUT);

    expect(h.stripeCalls[0]).toMatchObject({ payment_intent: "pi_legacy_456" });
  });

  it("records a MANUAL payment's refund as RECORDED_MANUALLY without calling any provider", async () => {
    const h = harness({ attempts: [attempt({ provider: "MANUAL", providerIntentId: "manual-ref-1" })] });
    const service = createRefundService(h.deps);

    const result = await service.recordRefund(FULL_INPUT);

    expect(result.status).toBe("RECORDED_MANUALLY");
    expect(h.paystackCalls).toHaveLength(0);
    expect(h.stripeCalls).toHaveLength(0);
  });
});

describe("recordRefund — provider failure is honest, never a fabricated success (D-22)", () => {
  it("leaves the refund FAILED and records the provider's own error, never marking the Order refunded", async () => {
    const h = harness({
      attempts: [attempt({ provider: "PAYSTACK" })],
      paystackThrows: new Error("Paystack: transaction not found"),
    });
    const service = createRefundService(h.deps);

    const result = await service.recordRefund(FULL_INPUT);

    expect(result.status).toBe("FAILED");
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]).toMatchObject({ status: "FAILED", providerOutcome: "Paystack: transaction not found" });
    // A FAILED refund never moves Order.status to REFUNDED/PARTIALLY_REFUNDED.
    expect(h.orderUpdates).toHaveLength(0);
  });
});

describe("recordRefund — access decision is a distinct, explicit field (D-23)", () => {
  it("records a refund with access RETAINED", async () => {
    const h = harness();
    const service = createRefundService(h.deps);

    await service.recordRefund({ ...FULL_INPUT, accessDecision: "RETAINED" });

    expect(h.refunds[0]).toMatchObject({ accessDecision: "RETAINED" });
  });

  it("records a refund with access REVOKED", async () => {
    const h = harness();
    const service = createRefundService(h.deps);

    await service.recordRefund({ ...FULL_INPUT, accessDecision: "REVOKED" });

    expect(h.refunds[0]).toMatchObject({ accessDecision: "REVOKED" });
  });
});

describe("recordRefund — Order status transition", () => {
  it("moves the Order to REFUNDED when the refund exhausts the eligible value", async () => {
    const h = harness();
    const service = createRefundService(h.deps);

    await service.recordRefund(FULL_INPUT);

    expect(h.orderUpdates).toHaveLength(1);
    expect(h.orderUpdates[0].data).toEqual({ status: "REFUNDED" });
  });

  it("moves the Order to PARTIALLY_REFUNDED when eligible value remains", async () => {
    const h = harness();
    const service = createRefundService(h.deps);

    await service.recordRefund({ ...FULL_INPUT, amountMinor: 10_000_000 });

    expect(h.orderUpdates[0].data).toEqual({ status: "PARTIALLY_REFUNDED" });
  });
});

describe("recordRefund — exactly one audit row", () => {
  it("writes exactly one audit row per refund", async () => {
    const h = harness();
    const service = createRefundService(h.deps);

    await service.recordRefund(FULL_INPUT);

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ actorId: "user-1", action: "refund.recorded" });
  });
});

describe("provider refund request builders — pure, no network call", () => {
  it("buildPaystackRefundRequest omits amount for a full refund", () => {
    const req = buildPaystackRefundRequest({
      transactionReference: "PSK-TXN-1",
      currency: "NGN",
      note: "Full refund",
    });
    expect(req).toEqual({ transaction: "PSK-TXN-1", currency: "NGN", merchant_note: "Full refund" });
  });

  it("buildPaystackRefundRequest includes amount for a partial refund", () => {
    const req = buildPaystackRefundRequest({
      transactionReference: "PSK-TXN-1",
      amountMinor: 10_000_000,
      currency: "NGN",
      note: "Partial refund",
    });
    expect(req).toMatchObject({ amount: 10_000_000 });
  });

  it("buildStripeRefundRequest passes reverse_transfer explicitly true for a full refund", () => {
    const req = buildStripeRefundRequest({
      paymentIntentId: "pi_123",
      reverseTransfer: true,
      reason: "Full refund",
    });
    expect(req).toMatchObject({ payment_intent: "pi_123", reverse_transfer: true });
    expect(req).not.toHaveProperty("amount");
  });

  it("buildStripeRefundRequest passes reverse_transfer explicitly false for a partial refund", () => {
    const req = buildStripeRefundRequest({
      paymentIntentId: "pi_123",
      amountMinor: 5_000_000,
      reverseTransfer: false,
      reason: "Partial refund",
    });
    expect(req).toMatchObject({ payment_intent: "pi_123", amount: 5_000_000, reverse_transfer: false });
  });
});

describe("recordRefund — Order not found", () => {
  it("throws OrderNotFoundError for a non-existent order", async () => {
    const h = harness({ orders: [] });
    const service = createRefundService(h.deps);

    await expect(service.recordRefund(FULL_INPUT)).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});
