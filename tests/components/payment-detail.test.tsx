/**
 * Phase 7 Plan 10 — the Finance payment detail page (`/staff/payments/[orderId]`,
 * PAY-04, PAY-07, D-14, D-18, 07-UI-SPEC §7.6) and the two purpose-built
 * dialogs it wires (`ManualPaymentDialog`/`RefundDialog`, PAY-03, PAY-05).
 *
 * The page is a Server Component; invoked directly and its returned element
 * rendered with Testing Library, matching
 * `tests/components/order-confirmation.test.tsx`'s established pattern for
 * exercising an async `page.tsx` outside the real Next.js runtime.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPaymentDetailForStaff: vi.fn(),
  can: vi.fn(),
  confirmManualPaymentAction: vi.fn(),
  recordRefundAction: vi.fn(),
  refresh: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/server/permissions", () => ({
  can: mocks.can,
  AuthenticationError: class extends Error {},
  AuthorizationError: class extends Error {},
}));
vi.mock("@/server/services/payment-read-service", () => ({
  getPaymentDetailForStaff: mocks.getPaymentDetailForStaff,
}));
vi.mock("@/server/services/cohort-scope", () => ({ orderCohortScope: async () => ({ cohortId: "cohort-1" }) }));
vi.mock("@/app/staff/payments/actions", () => ({
  confirmManualPaymentAction: mocks.confirmManualPaymentAction,
  recordRefundAction: mocks.recordRefundAction,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import PaymentDetailPage from "@/app/staff/payments/[orderId]/page";
import { ManualPaymentDialog } from "@/app/staff/payments/ManualPaymentDialog";
import { RefundDialog } from "@/app/staff/payments/RefundDialog";
import { AuthorizationError } from "@/server/permissions";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function run(orderId = "order-1") {
  return PaymentDetailPage({ params: Promise.resolve({ orderId }) });
}

type DetailOverrides = Partial<{
  id: string;
  reference: string;
  status: string;
  provider: string | null;
  currency: string;
  cohortTitle: string;
  learnerName: string;
  learnerEmail: string;
  baseAmountMinor: number | null;
  platformFeeMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
  amountMinor: number;
  schoolSettlementExpectedMinor: number | null;
  settlementState: "ESTIMATED_ONLY" | "RECONCILED" | "EXCEPTION";
  actual: {
    schoolSettlementActualMinor: number | null;
    platformGrossActualMinor: number | null;
    gatewayFeeActualMinor: number | null;
    platformNetActualMinor: number | null;
  };
  existingAttempt: {
    provider: string;
    confirmedAt: Date | null;
    providerRef: string | null;
    providerIntentId: string | null;
  } | null;
  eligibleRefundMinor: number;
  refunds: Array<{
    id: string;
    amountMinor: number;
    currency: string;
    status: string;
    actorName: string | null;
    createdAt: Date;
  }>;
}>;

function detail(overrides: DetailOverrides = {}) {
  return {
    id: "order-1",
    reference: "ORD-0001",
    status: "PENDING",
    provider: "PAYSTACK",
    currency: "NGN",
    cohortTitle: "Cohort A",
    learnerName: "Ada Lovelace",
    learnerEmail: "ada@example.com",
    baseAmountMinor: 45_000_000,
    platformFeeMinor: 675_000,
    gatewayFeeEstimateMinor: 450_000,
    amountMinor: 45_675_000,
    schoolSettlementExpectedMinor: 45_000_000,
    settlementState: "ESTIMATED_ONLY" as const,
    actual: {
      schoolSettlementActualMinor: null,
      platformGrossActualMinor: null,
      gatewayFeeActualMinor: null,
      platformNetActualMinor: null,
    },
    existingAttempt: null,
    eligibleRefundMinor: 0,
    refunds: [],
    ...overrides,
  };
}

describe("PaymentDetailPage — RBAC-06", () => {
  it("renders the denied panel with no facts for a caller without payments.view", async () => {
    mocks.getPaymentDetailForStaff.mockRejectedValue(new AuthorizationError("payments.view"));

    render(await run());

    expect(screen.getByText("You do not have access to this record")).toBeTruthy();
    expect(screen.queryByText("Learner charge")).toBeNull();
  });

  it("calls notFound() for a missing Order", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("throws rather than silently rendering when the D-13 commercial snapshot is missing", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(detail({ baseAmountMinor: null }));
    mocks.can.mockResolvedValue(false);
    await expect(run()).rejects.toThrow(/commercial snapshot/);
  });
});

describe("PaymentDetailPage — sections and D-14 null-vs-zero (07-UI-SPEC §7.6)", () => {
  it("renders all four section headings verbatim", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(detail());
    mocks.can.mockResolvedValue(false);
    render(await run());

    expect(screen.getByText("Learner charge")).toBeTruthy();
    expect(screen.getByText("Settlement")).toBeTruthy();
    expect(screen.getByText("Manual confirmation")).toBeTruthy();
    expect(screen.getByText("Refunds")).toBeTruthy();
  });

  it("renders the em-dash pending-reconciliation string for a null actual, and never a rendered 0 in that cell", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(detail());
    mocks.can.mockResolvedValue(false);
    render(await run());

    const dt = screen.getByText("Actual gateway fee");
    const dd = dt.parentElement!.querySelector("dd")!;
    expect(dd.textContent).toBe("— (pending reconciliation)");
    expect(dd.textContent).not.toContain("0");
  });

  it("renders the exception banner in warning tone, never danger, when settlement is EXCEPTION", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(
      detail({
        settlementState: "EXCEPTION",
        actual: {
          schoolSettlementActualMinor: 44_000_000,
          platformGrossActualMinor: 675_000,
          gatewayFeeActualMinor: 500,
          platformNetActualMinor: 174_500,
        },
      }),
    );
    mocks.can.mockResolvedValue(false);
    render(await run());

    const banner = screen.getByText("Settlement doesn't match the expected amount").closest("div")!;
    expect(banner.className).toContain("warning");
    expect(banner.className).not.toContain("danger");
    expect(
      screen.getByText("This has been flagged for review. The learner's charge and enrolment are unaffected."),
    ).toBeTruthy();
  });

  it("renders no exception banner when settlement is RECONCILED", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(detail({ settlementState: "RECONCILED" }));
    mocks.can.mockResolvedValue(false);
    render(await run());
    expect(screen.queryByText("Settlement doesn't match the expected amount")).toBeNull();
  });
});

describe("PaymentDetailPage — manual confirmation (PAY-03, PAY-04)", () => {
  it("renders the Confirm manual payment trigger only when payments.confirm is granted and the Order is not PAID", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(detail({ status: "PENDING" }));
    mocks.can.mockResolvedValue(true);
    render(await run());
    expect(screen.getByRole("button", { name: "Confirm manual payment" })).toBeTruthy();
  });

  it("renders no manual-confirm trigger when the actor lacks payments.confirm", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(detail({ status: "PENDING" }));
    mocks.can.mockResolvedValue(false);
    render(await run());
    expect(screen.queryByRole("button", { name: "Confirm manual payment" })).toBeNull();
  });

  it("renders the already-paid banner and the existing transaction, with no confirm affordance, when the Order is PAID", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(
      detail({
        status: "PAID",
        existingAttempt: {
          provider: "PAYSTACK",
          confirmedAt: new Date("2026-02-01T00:00:00Z"),
          providerRef: "PSK-REF-1",
          providerIntentId: "PSK-REF-1",
        },
      }),
    );
    mocks.can.mockResolvedValue(true);
    render(await run());

    expect(screen.getByText("This order is already paid")).toBeTruthy();
    expect(screen.getByText(/PSK-REF-1/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm manual payment" })).toBeNull();
  });

  it.each(["PARTIALLY_REFUNDED", "REFUNDED", "EXCEPTION"])(
    "renders the already-paid banner with no confirm affordance when the Order is %s",
    async (status) => {
      mocks.getPaymentDetailForStaff.mockResolvedValue(
        detail({
          status,
          existingAttempt: {
            provider: "PAYSTACK",
            confirmedAt: new Date("2026-02-01T00:00:00Z"),
            providerRef: "PSK-REF-1",
            providerIntentId: "PSK-REF-1",
          },
        }),
      );
      mocks.can.mockResolvedValue(true);

      render(await run());

      expect(screen.getByText("This order is already paid")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Confirm manual payment" })).toBeNull();
    },
  );
});

describe("PaymentDetailPage — refunds (PAY-05, D-22)", () => {
  it("renders no rows and no placeholder text when there are no refunds", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(detail({ refunds: [], eligibleRefundMinor: 0 }));
    mocks.can.mockResolvedValue(false);
    render(await run());
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/no refunds/i)).toBeNull();
  });

  it("renders the Record a refund trigger only when refunds.manage is granted and eligible value remains", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(
      detail({ status: "PAID", eligibleRefundMinor: 10_000_000 }),
    );
    mocks.can.mockResolvedValue(true);
    render(await run());
    expect(screen.getByRole("button", { name: "Record a refund" })).toBeTruthy();
  });

  it("renders no Record a refund trigger when eligible value is 0, even with refunds.manage granted", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(detail({ status: "PAID", eligibleRefundMinor: 0 }));
    mocks.can.mockResolvedValue(true);
    render(await run());
    expect(screen.queryByRole("button", { name: "Record a refund" })).toBeNull();
  });

  it("renders a RECORDED_MANUALLY refund with the accent-toned pill", async () => {
    mocks.getPaymentDetailForStaff.mockResolvedValue(
      detail({
        refunds: [
          {
            id: "refund-1",
            amountMinor: 5_000_000,
            currency: "NGN",
            status: "RECORDED_MANUALLY",
            actorName: "Finance Officer",
            createdAt: new Date("2026-02-05T00:00:00Z"),
          },
        ],
      }),
    );
    mocks.can.mockResolvedValue(false);
    render(await run());
    expect(screen.getByText("Recorded manually")).toBeTruthy();
    expect(screen.getByText("Finance Officer")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ManualPaymentDialog (PAY-03)
// ---------------------------------------------------------------------------

function fillManualForm() {
  fireEvent.change(screen.getByLabelText("Amount (minor units)"), { target: { value: "45675000" } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-02-01" } });
  fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "Bank transfer" } });
  fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "STMT-001" } });
  fireEvent.change(screen.getByLabelText("Evidence / note"), { target: { value: "Confirmed against bank statement." } });
}

describe("ManualPaymentDialog", () => {
  it("opens on trigger click with the verbatim title, fields and confirm label", () => {
    render(<ManualPaymentDialog orderId="order-1" currency="NGN" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm manual payment" }));

    expect(screen.getByRole("heading", { name: "Confirm manual payment" })).toBeTruthy();
    expect(screen.getByLabelText("Amount (minor units)")).toBeTruthy();
    expect(screen.getByLabelText("Currency")).toBeTruthy();
    expect(screen.getByLabelText("Date")).toBeTruthy();
    expect(screen.getByLabelText("Channel")).toBeTruthy();
    expect(screen.getByLabelText("Reference")).toBeTruthy();
    expect(screen.getByLabelText("Evidence / note")).toBeTruthy();
    expect(screen.getByLabelText(/Reason for manual confirmation/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm payment" })).toBeTruthy();
  });

  it("keeps confirm disabled until the reason reaches the 10-character minimum, with every other field valid", () => {
    render(<ManualPaymentDialog orderId="order-1" currency="NGN" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm manual payment" }));
    fillManualForm();

    const confirm = screen.getByRole("button", { name: "Confirm payment" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Reason for manual confirmation/), { target: { value: "too short" } });
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Reason for manual confirmation/), {
      target: { value: "Confirmed against bank statement dated 2026-02-01." },
    });
    expect(confirm.disabled).toBe(false);
  });

  it("disables confirm while a submission is in flight (ConfirmModal's pending contract)", async () => {
    let resolveAction: (value: unknown) => void = () => {};
    mocks.confirmManualPaymentAction.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)));

    render(<ManualPaymentDialog orderId="order-1" currency="NGN" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm manual payment" }));
    fillManualForm();
    fireEvent.change(screen.getByLabelText(/Reason for manual confirmation/), {
      target: { value: "Confirmed against bank statement dated 2026-02-01." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm payment" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirming…" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "Confirming…" }) as HTMLButtonElement).disabled).toBe(true);

    resolveAction({ ok: true, outcome: "ACTIVATED" });
  });

  it("renders the verbatim 'Action not applied' copy on failure", async () => {
    mocks.confirmManualPaymentAction.mockResolvedValue({ ok: false, message: "Order ORD-0001 is priced in USD." });

    render(<ManualPaymentDialog orderId="order-1" currency="NGN" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm manual payment" }));
    fillManualForm();
    fireEvent.change(screen.getByLabelText(/Reason for manual confirmation/), {
      target: { value: "Confirmed against bank statement dated 2026-02-01." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm payment" }));

    await waitFor(() => expect(screen.getByText("Action not applied")).toBeTruthy());
    expect(screen.getByText("Order ORD-0001 is priced in USD.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// RefundDialog (PAY-05, D-22)
// ---------------------------------------------------------------------------

describe("RefundDialog", () => {
  it("renders the remaining-eligible-amount hint above the amount field, verbatim", () => {
    render(<RefundDialog orderId="order-1" currency="NGN" eligibleRefundMinor={10_000_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Record a refund" }));

    const hint = screen.getByText(/can be refunded\./);
    // The currency symbol/code itself is locale-dependent (Intl.NumberFormat
    // with no explicit locale) — the copy contract (§6.1) is the sentence
    // shape and the formatted 100,000.00 figure, not one specific symbol.
    expect(hint.textContent).toMatch(/^Up to .*100,000\.00 can be refunded\.$/);
    const amountField = screen.getByLabelText("Amount (minor units)");
    expect(hint.compareDocumentPosition(amountField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps confirm disabled until the reason reaches the 10-character minimum, with a valid amount", () => {
    render(<RefundDialog orderId="order-1" currency="NGN" eligibleRefundMinor={10_000_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Record a refund" }));
    fireEvent.change(screen.getByLabelText("Amount (minor units)"), { target: { value: "5000000" } });

    const confirm = screen.getByRole("button", { name: "Record refund" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Reason for refund/), {
      target: { value: "Learner requested a partial refund." },
    });
    expect(confirm.disabled).toBe(false);
  });

  it("renders the verbatim 'Action not applied' copy on failure, naming the eligible figure", async () => {
    mocks.recordRefundAction.mockResolvedValue({
      ok: false,
      message: "Refund of 20000000 for order order-1 exceeds the eligible captured value of 10000000.",
    });

    render(<RefundDialog orderId="order-1" currency="NGN" eligibleRefundMinor={10_000_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Record a refund" }));
    fireEvent.change(screen.getByLabelText("Amount (minor units)"), { target: { value: "10000000" } });
    fireEvent.change(screen.getByLabelText(/Reason for refund/), {
      target: { value: "Learner requested a partial refund." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));

    await waitFor(() => expect(screen.getByText("Action not applied")).toBeTruthy());
    expect(screen.getByText(/exceeds the eligible captured value of 10000000/)).toBeTruthy();
  });
});
