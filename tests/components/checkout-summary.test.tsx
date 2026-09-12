import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyConsentForm } from "@/app/(checkout)/checkout/[orderId]/PolicyConsentForm";
import { HoldCountdown } from "@/app/(checkout)/checkout/[orderId]/HoldCountdown";

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
  it("renders the remaining hold time as mm:ss in mono, and ticks down once per second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(<HoldCountdown holdExpiresAt="2026-09-10T12:09:47.000Z" />);

    expect(screen.getByText("9:47")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("9:46")).toBeTruthy();
  });

  it("uses the default ink above five minutes remaining, at the Label type size", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(<HoldCountdown holdExpiresAt="2026-09-10T12:09:47.000Z" />);
    expect(screen.getByText("9:47").className).toContain("text-foreground");
    expect(screen.getByText("9:47").closest("p")!.className).toContain("text-sm");
  });

  it("escalates to the warning tone between five minutes and one minute remaining", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(<HoldCountdown holdExpiresAt="2026-09-10T12:04:59.000Z" />);
    const value = screen.getByText("4:59");
    expect(value.className).toContain("text-warning");
    expect(value.className).not.toContain("text-foreground");
  });

  it("escalates to the danger tone below one minute remaining, keeping the same font-size class as the other thresholds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(<HoldCountdown holdExpiresAt="2026-09-10T12:00:59.000Z" />);
    const value = screen.getByText("0:59");
    expect(value.className).toContain("text-danger");
    expect(value.closest("p")!.className).toContain("text-sm");
  });

  it("stops at zero and keeps rendering 0:00 without throwing once the hold instant has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    render(<HoldCountdown holdExpiresAt="2026-09-10T11:59:00.000Z" />);
    expect(screen.getByText("0:00")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("0:00")).toBeTruthy();
  });
});
