function usd(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
}

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyConsentForm } from "@/app/(checkout)/checkout/[orderId]/PolicyConsentForm";
import { HoldCountdown } from "@/app/(checkout)/checkout/[orderId]/HoldCountdown";
import { OrderBreakdownCard } from "@/components/checkout/OrderBreakdownCard";

/** Strips every non-digit/non-dot character so a formatted currency string
 *  (any locale/symbol) round-trips back to its minor-unit integer — used to
 *  prove the three component rows sum exactly to the rendered total. */
function parseAmountMinor(rendered: string): number {
  return Math.round(parseFloat(rendered.replace(/[^0-9.]/g, "")) * 100);
}

function rowValue(label: string): number {
  const dt = screen.getByText(label);
  const dd = dt.parentElement!.querySelector("dd");
  if (!dd) throw new Error(`No <dd> sibling found for row label "${label}"`);
  return parseAmountMinor(dd.textContent ?? "");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function checkboxes() {
  return {
    terms: screen.getByRole("checkbox", { name: /Terms of Service/ }),
    refund: screen.getByRole("checkbox", { name: /Refund & Cancellation Policy/ }),
    marketing: screen.getByRole("checkbox", { name: "Send me occasional programme updates" }),
  };
}

function payButton() {
  return screen.getByRole("button", { name: /Pay|Paying/ }) as HTMLButtonElement;
}

describe("PolicyConsentForm", () => {
  it("renders all three controls unchecked on first paint", () => {
    render(
      <PolicyConsentForm orderId="order-1" action={() => {}} submitLabel="Pay $450.00" />,
    );
    const { terms, refund, marketing } = checkboxes();
    expect((terms as HTMLInputElement).checked).toBe(false);
    expect((refund as HTMLInputElement).checked).toBe(false);
    expect((marketing as HTMLInputElement).checked).toBe(false);
    expect(payButton().disabled).toBe(true);
  });

  it("gives the terms and refund-cancellation labels a link to their policy text", () => {
    render(
      <PolicyConsentForm orderId="order-1" action={() => {}} submitLabel="Pay $450.00" />,
    );
    expect(screen.getByRole("link", { name: "Terms of Service" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Refund & Cancellation Policy" })).toBeTruthy();
  });

  it("leaves Pay inert when only the optional marketing control is checked", () => {
    render(
      <PolicyConsentForm orderId="order-1" action={() => {}} submitLabel="Pay $450.00" />,
    );
    fireEvent.click(checkboxes().marketing);
    expect(payButton().disabled).toBe(true);
  });

  it("enables Pay once both required controls are checked", () => {
    render(
      <PolicyConsentForm orderId="order-1" action={() => {}} submitLabel="Pay $450.00" />,
    );
    const { terms, refund } = checkboxes();
    fireEvent.click(terms);
    fireEvent.click(refund);
    expect(payButton().disabled).toBe(false);
  });

  it("makes Pay inert again after unchecking a required control", () => {
    render(
      <PolicyConsentForm orderId="order-1" action={() => {}} submitLabel="Pay $450.00" />,
    );
    const { terms, refund } = checkboxes();
    fireEvent.click(terms);
    fireEvent.click(refund);
    expect(payButton().disabled).toBe(false);
    fireEvent.click(terms);
    expect(payButton().disabled).toBe(true);
  });

  it("never lets the marketing control affect Pay availability once both required controls are checked", () => {
    render(
      <PolicyConsentForm orderId="order-1" action={() => {}} submitLabel="Pay $450.00" />,
    );
    const { terms, refund, marketing } = checkboxes();
    fireEvent.click(terms);
    fireEvent.click(refund);
    fireEvent.click(marketing);
    expect(payButton().disabled).toBe(false);
    fireEvent.click(marketing);
    expect(payButton().disabled).toBe(false);
  });

  it("keeps Pay inert when forceDisabled is set, even with both required controls checked (D-13 banner state)", () => {
    render(
      <PolicyConsentForm
        orderId="order-1"
        action={() => {}}
        submitLabel="Pay $450.00"
        forceDisabled
      />,
    );
    const { terms, refund } = checkboxes();
    fireEvent.click(terms);
    fireEvent.click(refund);
    expect(payButton().disabled).toBe(true);
  });

  it("shows the pending treatment and cannot be double-submitted while the action is in flight", async () => {
    let resolveAction: () => void = () => {};
    const pendingAction = () =>
      new Promise<void>((resolve) => {
        resolveAction = resolve;
      });

    render(
      <PolicyConsentForm orderId="order-1" action={pendingAction} submitLabel="Pay $450.00" />,
    );
    const { terms, refund } = checkboxes();
    fireEvent.click(terms);
    fireEvent.click(refund);
    expect(payButton().disabled).toBe(false);

    fireEvent.click(payButton());

    await waitFor(() => expect(payButton().textContent).toBe("Paying…"));
    expect(payButton().disabled).toBe(true);

    resolveAction();
    await waitFor(() => expect(payButton().textContent).toBe("Pay $450.00"));
  });
});

describe("HoldCountdown", () => {
  it("hydrates from the server snapshot without a clock-driven text mismatch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));

    const countdown = (
      <HoldCountdown holdExpiresAt="2026-09-10T12:09:47.000Z" initialRemainingMs={587_000} />
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(countdown);
    document.body.appendChild(container);

    vi.setSystemTime(new Date("2026-09-10T12:00:01.000Z"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, countdown);
      await Promise.resolve();
    });

    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/hydration failed/i);

    act(() => root.unmount());
    container.remove();
  });

  it("renders the remaining hold time as mm:ss in mono, and ticks down once per second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(
      <HoldCountdown holdExpiresAt="2026-09-10T12:09:47.000Z" initialRemainingMs={587_000} />,
    );

    expect(screen.getByText("9:47")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("9:46")).toBeTruthy();
  });

  it("uses the default ink above five minutes remaining, at the Label type size", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(
      <HoldCountdown holdExpiresAt="2026-09-10T12:09:47.000Z" initialRemainingMs={587_000} />,
    );
    expect(screen.getByText("9:47").className).toContain("text-foreground");
    expect(screen.getByText("9:47").closest("p")!.className).toContain("text-sm");
  });

  it("escalates to the warning tone between five minutes and one minute remaining", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(
      <HoldCountdown holdExpiresAt="2026-09-10T12:04:59.000Z" initialRemainingMs={299_000} />,
    );
    const value = screen.getByText("4:59");
    expect(value.className).toContain("text-warning");
    expect(value.className).not.toContain("text-foreground");
  });

  it("escalates to the danger tone below one minute remaining, keeping the same font-size class as the other thresholds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(
      <HoldCountdown holdExpiresAt="2026-09-10T12:00:59.000Z" initialRemainingMs={59_000} />,
    );
    const value = screen.getByText("0:59");
    expect(value.className).toContain("text-danger");
    expect(value.closest("p")!.className).toContain("text-sm");
  });

  it("stops at zero and keeps rendering 0:00 without throwing once the hold instant has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(<HoldCountdown holdExpiresAt="2026-09-10T11:59:00.000Z" initialRemainingMs={0} />);
    expect(screen.getByText("0:00")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("0:00")).toBeTruthy();
  });
});

/**
 * 07-09 Task 2: the shared four-line breakdown component (D-16/D-17/D-18)
 * both the order-summary page and the receipt render. Tested standalone here
 * — a pure, presentational component — and again below composed inside the
 * real `CheckoutOrderPage` for the document-order and no-secrets proofs that
 * only make sense at the page level.
 */
describe("OrderBreakdownCard", () => {
  function breakdownFixture(overrides: Partial<Parameters<typeof OrderBreakdownCard>[0]> = {}) {
    return {
      baseAmountMinor: 44_325_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 875_000,
      amountMinor: 45_875_000,
      currency: "NGN",
      provider: "PAYSTACK",
      ...overrides,
    };
  }

  afterEach(cleanup);

  it("renders the four row labels and the fee-variance disclosure verbatim (07-UI-SPEC §6.1)", () => {
    render(<OrderBreakdownCard {...breakdownFixture()} />);
    expect(screen.getByText("School fee")).toBeTruthy();
    expect(screen.getByText("KQ NEXUS platform fee (1.5%)")).toBeTruthy();
    expect(screen.getByText("Estimated payment-processing fee")).toBeTruthy();
    expect(screen.getByText("Total charged")).toBeTruthy();
    expect(
      screen.getByText(
        "This is an estimate from our current provider fee schedule. The actual gateway fee may differ slightly — it affects how the payment is reconciled behind the scenes and never changes the total above.",
      ),
    ).toBeTruthy();
  });

  it("renders the fifth currency/provider line as '{Currency} via {Provider}'", () => {
    render(<OrderBreakdownCard {...breakdownFixture({ currency: "NGN", provider: "PAYSTACK" })} />);
    expect(screen.getByText("NGN via Paystack")).toBeTruthy();
  });

  it("renders the disclosure in muted text, never the warning colour (D-17)", () => {
    render(<OrderBreakdownCard {...breakdownFixture()} />);
    const disclosure = screen.getByText(/This is an estimate from our current provider fee schedule/);
    expect(disclosure.className).toContain("text-muted-foreground");
    expect(disclosure.className).not.toContain("warning");
  });

  it("renders the amounts from the exact snapshot values it is handed, formatted for the given currency", () => {
    render(
      <OrderBreakdownCard
        {...breakdownFixture({
          baseAmountMinor: 100_000,
          platformFeeMinor: 1_500,
          gatewayFeeEstimateMinor: 2_500,
          amountMinor: 104_000,
          currency: "USD",
          provider: "STRIPE",
        })}
      />,
    );
    expect(screen.getByText(usd(1000))).toBeTruthy();
    expect(screen.getByText(usd(15))).toBeTruthy();
    expect(screen.getByText(usd(25))).toBeTruthy();
    expect(screen.getByText(usd(1040))).toBeTruthy();
    expect(screen.getByText("USD via Stripe")).toBeTruthy();
  });

  it("the three component rows sum exactly to the rendered total — catches a dropped-digit formatting bug", () => {
    render(<OrderBreakdownCard {...breakdownFixture()} />);
    const school = rowValue("School fee");
    const platform = rowValue("KQ NEXUS platform fee (1.5%)");
    const gateway = rowValue("Estimated payment-processing fee");
    const total = rowValue("Total charged");
    expect(school + platform + gateway).toBe(total);
  });
});

/**
 * 07-09 Task 2: the order-summary page itself. Invoked directly and its
 * returned element rendered with Testing Library, matching
 * `tests/components/order-confirmation.test.tsx`'s established pattern for
 * exercising an async `page.tsx` outside the real Next.js runtime.
 */
const pageMocks = vi.hoisted(() => ({
  getCurrentActor: vi.fn(),
  getOwnOrder: vi.fn(),
  getOwnVerificationStatus: vi.fn(),
  getCohortOfferPath: vi.fn(),
  payAction: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: pageMocks.getCurrentActor }));
vi.mock("@/server/services/checkout-service", () => ({
  getOwnOrder: pageMocks.getOwnOrder,
  getOwnVerificationStatus: pageMocks.getOwnVerificationStatus,
  getCohortOfferPath: pageMocks.getCohortOfferPath,
}));
vi.mock("@/app/(checkout)/checkout/[orderId]/actions", () => ({ payAction: pageMocks.payAction }));
vi.mock("next/navigation", () => ({
  notFound: pageMocks.notFound,
}));

import CheckoutOrderPage from "@/app/(checkout)/checkout/[orderId]/page";

const ORDER_ID = "order-1";

function runCheckoutPage(declined?: string) {
  return CheckoutOrderPage({
    params: Promise.resolve({ orderId: ORDER_ID }),
    searchParams: Promise.resolve(declined ? { declined } : {}),
  });
}

type CheckoutOrderFixtureOverrides = {
  status?: string;
  enrolment?: { id: string; status: string; holdExpiresAt: Date | string | null } | null;
};

function checkoutOrderFixture(overrides: CheckoutOrderFixtureOverrides = {}) {
  return {
    id: ORDER_ID,
    reference: "ORD-20260910-ABCDEF12",
    status: overrides.status ?? "PENDING",
    amountMinor: 45_875_000,
    currency: "NGN",
    selectedProvider: "PAYSTACK",
    baseAmountMinor: 44_325_000,
    platformFeeMinor: 675_000,
    gatewayFeeEstimateMinor: 875_000,
    cohort: {
      id: "cohort-1",
      title: "September Cohort",
      startsAt: new Date("2026-10-01T09:00:00Z"),
      endsAt: new Date("2026-10-30T17:00:00Z"),
      deliveryMode: "INSTRUCTOR_LED",
    },
    enrolment:
      overrides.enrolment !== undefined
        ? overrides.enrolment
        : {
            id: "enrolment-1",
            status: "PENDING_PAYMENT",
            holdExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          },
  };
}

function seedCheckoutPage(order: ReturnType<typeof checkoutOrderFixture> | null) {
  pageMocks.getCurrentActor.mockResolvedValue({ userId: "user-1", isStaff: false });
  pageMocks.getOwnOrder.mockResolvedValue(order);
  pageMocks.getOwnVerificationStatus.mockResolvedValue({ verified: true, email: "learner@example.com" });
  pageMocks.getCohortOfferPath.mockResolvedValue("/courses/a-course");
}

describe("CheckoutOrderPage — breakdown card (07-09 D-16/D-17)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the breakdown card's four rows from the Order's own snapshot, before the policy checkboxes in document order", async () => {
    seedCheckoutPage(checkoutOrderFixture());
    render(await runCheckoutPage());

    const school = rowValue("School fee");
    const platform = rowValue("KQ NEXUS platform fee (1.5%)");
    const gateway = rowValue("Estimated payment-processing fee");
    const total = rowValue("Total charged");
    expect(school + platform + gateway).toBe(total);
    expect(screen.getByText("NGN via Paystack")).toBeTruthy();

    const breakdownSection = screen.getByText("School fee").closest("section")!;
    const firstCheckbox = screen.getAllByRole("checkbox")[0];
    // DOCUMENT_POSITION_FOLLOWING (4) — the checkbox comes AFTER the card.
    expect(breakdownSection.compareDocumentPosition(firstCheckbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("removes the old single Price fact from the Cohort/Dates/Mode grid — Price now lives only in the breakdown card", async () => {
    seedCheckoutPage(checkoutOrderFixture());
    render(await runCheckoutPage());
    expect(screen.queryByText("Price")).toBeNull();
    expect(screen.getByText("Cohort")).toBeTruthy();
    expect(screen.getByText("Dates")).toBeTruthy();
    expect(screen.getByText("Mode")).toBeTruthy();
  });

  it("renders no provider secret or account identifier anywhere on the page (T-07-12)", async () => {
    const priorSecret = process.env.PAYSTACK_SECRET_KEY;
    const priorSubaccount = process.env.PAYSTACK_SUBACCOUNT_CODE;
    const priorConnected = process.env.STRIPE_CONNECTED_ACCOUNT_ID;
    process.env.PAYSTACK_SECRET_KEY = "sk_live_should_never_render_00000000";
    process.env.PAYSTACK_SUBACCOUNT_CODE = "ACCT_should_never_render";
    process.env.STRIPE_CONNECTED_ACCOUNT_ID = "acct_should_never_render";
    try {
      seedCheckoutPage(checkoutOrderFixture());
      const { container } = render(await runCheckoutPage());
      expect(container.textContent).not.toContain("sk_live_should_never_render_00000000");
      expect(container.textContent).not.toContain("ACCT_should_never_render");
      expect(container.textContent).not.toContain("acct_should_never_render");
      expect(container.innerHTML).not.toContain("sk_live_should_never_render_00000000");
      expect(container.innerHTML).not.toContain("ACCT_should_never_render");
      expect(container.innerHTML).not.toContain("acct_should_never_render");
    } finally {
      process.env.PAYSTACK_SECRET_KEY = priorSecret;
      process.env.PAYSTACK_SUBACCOUNT_CODE = priorSubaccount;
      process.env.STRIPE_CONNECTED_ACCOUNT_ID = priorConnected;
    }
  });

  it("still renders the Phase 6 hold countdown unchanged alongside the new breakdown card", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    seedCheckoutPage(
      checkoutOrderFixture({
        enrolment: {
          id: "enrolment-1",
          status: "PENDING_PAYMENT",
          holdExpiresAt: "2026-09-10T12:09:47.000Z",
        },
      }),
    );
    render(await runCheckoutPage());
    expect(screen.getByText("9:47")).toBeTruthy();
    vi.useRealTimers();
  });

  it("still renders the Phase 6 verification banner unchanged, forcing Pay inert regardless of the new breakdown card", async () => {
    seedCheckoutPage(checkoutOrderFixture());
    pageMocks.getOwnVerificationStatus.mockResolvedValue({ verified: false, email: "learner@example.com" });
    render(await runCheckoutPage());
    expect(screen.getByText("Verify your email to pay")).toBeTruthy();
    const payButton = screen.getByRole("button", { name: /Pay/ }) as HTMLButtonElement;
    expect(payButton.disabled).toBe(true);
  });

  it("still renders the Phase 6 decline banner unchanged when declined=1 and the hold is still live", async () => {
    seedCheckoutPage(checkoutOrderFixture());
    render(await runCheckoutPage("1"));
    expect(screen.getByText("Your card was declined")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("still renders the Phase 6 hold-expired panel unchanged, replacing the whole page body including the breakdown card", async () => {
    seedCheckoutPage(
      checkoutOrderFixture({
        enrolment: { id: "enrolment-1", status: "PENDING_PAYMENT", holdExpiresAt: "2020-01-01T00:00:00.000Z" },
      }),
    );
    render(await runCheckoutPage());
    expect(screen.getByText("Your seat hold has expired")).toBeTruthy();
    expect(screen.queryByText("School fee")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("renders the 404 page for another learner's order, without ever reading a commercial snapshot", async () => {
    seedCheckoutPage(null);
    await expect(runCheckoutPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(pageMocks.notFound).toHaveBeenCalled();
  });
});
