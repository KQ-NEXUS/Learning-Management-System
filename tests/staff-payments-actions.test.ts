/**
 * Phase 7 Plan 10 — `/staff/payments/[orderId]`'s Server Actions (PAY-03,
 * PAY-04, PAY-05, RBAC-06).
 *
 * `confirmManualPaymentAction`/`recordRefundAction` are thin: zod-validate,
 * delegate to `confirmManualPayment`/`recordRefund` (07-08, mocked here —
 * their own behaviour is proven in `tests/manual-payment-service.test.ts`/
 * `tests/refund-service.test.ts`), and map the result/refusal to a
 * discriminated `{ ok }` shape. What THIS file proves is that a direct POST
 * from a caller lacking the permission is refused with zero writes,
 * regardless of what any dialog rendered — the same RBAC-06 guarantee every
 * other Server Action in this codebase carries.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// `vi.mock` factories are hoisted above the module's top-level statements —
// every class/fn a factory closes over must live inside `vi.hoisted` too, or
// it is accessed before its `class`/`const` initializer has run (TDZ).
const mocks = vi.hoisted(() => {
  class AuthorizationError extends Error {
    constructor(message = "denied") {
      super(message);
    }
  }
  class AuthenticationError extends Error {}

  class ManualPaymentValidationError extends Error {}
  class ManualPaymentCurrencyMismatchError extends Error {}
  class ManualPaymentAmountMismatchError extends Error {}
  class MissingCommercialSnapshotError extends Error {}
  class ManualOrderNotFoundError extends Error {}

  class RefundValidationError extends Error {}
  class RefundExceedsEligibleValueError extends Error {}
  class NoCapturedPaymentError extends Error {}
  class MissingProviderReferenceError extends Error {}
  class RefundOrderNotFoundError extends Error {}

  return {
    confirmManualPayment: vi.fn(),
    recordRefund: vi.fn(),
    AuthorizationError,
    AuthenticationError,
    ManualPaymentValidationError,
    ManualPaymentCurrencyMismatchError,
    ManualPaymentAmountMismatchError,
    MissingCommercialSnapshotError,
    ManualOrderNotFoundError,
    RefundValidationError,
    RefundExceedsEligibleValueError,
    NoCapturedPaymentError,
    MissingProviderReferenceError,
    RefundOrderNotFoundError,
  };
});

// Every reference below reads `mocks.*` (a property access evaluated when the
// factory actually runs) rather than a destructured top-level const — `vi.mock`
// factories are hoisted above ALL other top-level statements, including a
// destructuring assignment, so a destructured binding would still be in its
// temporal dead zone when the factory closure is defined.
vi.mock("@/server/permissions", () => ({
  AuthorizationError: mocks.AuthorizationError,
  AuthenticationError: mocks.AuthenticationError,
}));

vi.mock("@/server/services/manual-payment-service", () => ({
  confirmManualPayment: mocks.confirmManualPayment,
  ManualPaymentValidationError: mocks.ManualPaymentValidationError,
  ManualPaymentCurrencyMismatchError: mocks.ManualPaymentCurrencyMismatchError,
  ManualPaymentAmountMismatchError: mocks.ManualPaymentAmountMismatchError,
  MissingCommercialSnapshotError: mocks.MissingCommercialSnapshotError,
  OrderNotFoundError: mocks.ManualOrderNotFoundError,
}));

vi.mock("@/server/services/refund-service", () => ({
  recordRefund: mocks.recordRefund,
  RefundValidationError: mocks.RefundValidationError,
  RefundExceedsEligibleValueError: mocks.RefundExceedsEligibleValueError,
  NoCapturedPaymentError: mocks.NoCapturedPaymentError,
  MissingProviderReferenceError: mocks.MissingProviderReferenceError,
  OrderNotFoundError: mocks.RefundOrderNotFoundError,
}));

import { confirmManualPaymentAction, recordRefundAction } from "@/app/staff/payments/actions";

const {
  AuthorizationError,
  RefundExceedsEligibleValueError,
  ManualPaymentCurrencyMismatchError,
} = mocks;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// confirmManualPaymentAction
// ---------------------------------------------------------------------------

const validManualInput = {
  orderId: "order-1",
  amountMinor: 45_675_000,
  currency: "NGN" as const,
  manualPaidAt: "2026-02-01",
  manualChannel: "bank_transfer",
  manualReference: "REF-1",
  manualEvidenceKey: "evidence-key",
  reason: "Confirmed against bank statement dated 2026-02-01.",
};

describe("confirmManualPaymentAction", () => {
  it("refuses a direct POST from a caller lacking payments.confirm, with zero writes reported", async () => {
    mocks.confirmManualPayment.mockRejectedValue(new AuthorizationError("payments.confirm"));

    const result = await confirmManualPaymentAction(validManualInput);

    expect(result).toEqual({ ok: false, message: "Your role does not permit this action on this order." });
    expect(mocks.confirmManualPayment).toHaveBeenCalledTimes(1);
  });

  it("refuses malformed input (short reason) without ever calling the service", async () => {
    const result = await confirmManualPaymentAction({ ...validManualInput, reason: "short" });

    expect(result.ok).toBe(false);
    expect(mocks.confirmManualPayment).not.toHaveBeenCalled();
  });

  it("refuses an unparseable date without calling the service", async () => {
    const result = await confirmManualPaymentAction({ ...validManualInput, manualPaidAt: "not-a-date" });

    expect(result.ok).toBe(false);
    expect(mocks.confirmManualPayment).not.toHaveBeenCalled();
  });

  it("parses manualPaidAt into a real Date before calling the service", async () => {
    mocks.confirmManualPayment.mockResolvedValue({ outcome: "ACTIVATED" });

    await confirmManualPaymentAction(validManualInput);

    expect(mocks.confirmManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", manualPaidAt: new Date("2026-02-01") }),
    );
  });

  it("surfaces ALREADY_PAID with the existing transaction's provider/date/reference (PAY-04)", async () => {
    mocks.confirmManualPayment.mockResolvedValue({
      outcome: "ALREADY_PAID",
      existingAttempt: {
        provider: "PAYSTACK",
        confirmedAt: new Date("2026-02-01T00:00:00.000Z"),
        providerRef: "PSK-1",
        providerIntentId: "PSK-1",
      },
    });

    const result = await confirmManualPaymentAction(validManualInput);

    expect(result).toEqual({
      ok: true,
      outcome: "ALREADY_PAID",
      existingAttempt: {
        provider: "PAYSTACK",
        confirmedAt: "2026-02-01T00:00:00.000Z",
        providerRef: "PSK-1",
        providerIntentId: "PSK-1",
      },
    });
  });

  it("maps every typed service refusal to its own message rather than throwing", async () => {
    mocks.confirmManualPayment.mockRejectedValue(new ManualPaymentCurrencyMismatchError("Order priced in USD."));
    const result = await confirmManualPaymentAction(validManualInput);
    expect(result).toEqual({ ok: false, message: "Order priced in USD." });
  });

  it("re-throws an unexpected error rather than swallowing it", async () => {
    mocks.confirmManualPayment.mockRejectedValue(new Error("boom"));
    await expect(confirmManualPaymentAction(validManualInput)).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// recordRefundAction
// ---------------------------------------------------------------------------

const validRefundInput = {
  orderId: "order-1",
  amountMinor: 20_000_000,
  reason: "Learner requested a partial refund.",
  accessDecision: "RETAINED" as const,
};

describe("recordRefundAction", () => {
  it("refuses a direct POST from a caller lacking refunds.manage, with zero writes reported", async () => {
    mocks.recordRefund.mockRejectedValue(new AuthorizationError("refunds.manage"));

    const result = await recordRefundAction(validRefundInput);

    expect(result).toEqual({ ok: false, message: "Your role does not permit this action on this order." });
    expect(mocks.recordRefund).toHaveBeenCalledTimes(1);
  });

  it("refuses malformed input (short reason) without ever calling the service", async () => {
    const result = await recordRefundAction({ ...validRefundInput, reason: "short" });

    expect(result.ok).toBe(false);
    expect(mocks.recordRefund).not.toHaveBeenCalled();
  });

  it("names the eligible figure when a refund above the cap is refused (PAY-05, D-22)", async () => {
    mocks.recordRefund.mockRejectedValue(
      new RefundExceedsEligibleValueError(
        "Refund of 30000000 for order order-1 exceeds the eligible captured value of 10000000.",
      ),
    );

    const result = await recordRefundAction(validRefundInput);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("10000000");
  });

  it("returns the refund's resulting status on success", async () => {
    mocks.recordRefund.mockResolvedValue({
      id: "refund-1",
      status: "COMPLETED",
      amountMinor: 20_000_000,
      components: { baseComponentMinor: 0, platformComponentMinor: 0, gatewayComponentMinor: 0, nonRecoverableMinor: 0 },
    });

    const result = await recordRefundAction(validRefundInput);

    expect(result).toEqual({ ok: true, status: "COMPLETED" });
  });

  it("re-throws an unexpected error rather than swallowing it", async () => {
    mocks.recordRefund.mockRejectedValue(new Error("boom"));
    await expect(recordRefundAction(validRefundInput)).rejects.toThrow("boom");
  });
});
