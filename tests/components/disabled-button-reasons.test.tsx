/**
 * A greyed-out primary button says why: checkout Pay, Confirm manual payment and
 * Record refund each show a line saying what is still needed, linked to the button
 * with aria-describedby, and the line goes away once the button is usable.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/feedback/Toaster", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/app/staff/payments/actions", () => ({
  confirmManualPaymentAction: vi.fn(),
  recordRefundAction: vi.fn(),
}));

import { PolicyConsentForm } from "@/app/(checkout)/checkout/[orderId]/PolicyConsentForm";
import { ManualPaymentDialog } from "@/app/staff/payments/ManualPaymentDialog";
import { RefundDialog } from "@/app/staff/payments/RefundDialog";

afterEach(cleanup);

const describedBy = (button: HTMLElement) =>
  (button.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("checkout Pay button", () => {
  it("says the policies must be ticked, then goes quiet once both are", () => {
    render(<PolicyConsentForm orderId="o1" action={vi.fn()} submitLabel="Pay now" />);
    const pay = screen.getByRole("button", { name: "Pay now" }) as HTMLButtonElement;

    expect(pay.disabled).toBe(true);
    expect(describedBy(pay)).toContain("Tick the Terms of Service and the Refund & Cancellation Policy");

    fireEvent.click(screen.getByRole("checkbox", { name: /Terms of Service/ }));
    expect(describedBy(pay)).toContain("Tick the Terms of Service");
    fireEvent.click(screen.getByRole("checkbox", { name: /Refund & Cancellation Policy/ }));

    expect(pay.disabled).toBe(false);
    expect(pay.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/Tick the Terms/)).toBeNull();
  });

  it("asks for email confirmation first when the account is unverified", () => {
    render(<PolicyConsentForm orderId="o1" action={vi.fn()} forceDisabled submitLabel="Pay now" />);
    const pay = screen.getByRole("button", { name: "Pay now" });
    expect(describedBy(pay)).toContain("Confirm your email address first");
  });
});

describe("manual payment dialog", () => {
  it("lists what is still needed and clears the list when everything is filled in", () => {
    render(<ManualPaymentDialog orderId="o1" currency="NGN" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm manual payment" }));
    const confirm = screen.getByRole("button", { name: "Confirm payment" }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(true);
    const help = describedBy(confirm);
    for (const part of ["an amount above zero", "the payment date", "the payment channel", "a reference", "where the evidence is held", "a reason of at least 10 characters"]) {
      expect(help).toContain(part);
    }

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: "5000000" } });
    expect(describedBy(confirm)).not.toContain("an amount above zero");
  });
});

describe("refund dialog", () => {
  it("says an amount and a reason are needed, and that the amount cannot exceed the refundable total", () => {
    render(<RefundDialog orderId="o1" currency="NGN" eligibleRefundMinor={1_000_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Record a refund" }));
    const record = screen.getByRole("button", { name: "Record refund" }) as HTMLButtonElement;

    expect(record.disabled).toBe(true);
    expect(describedBy(record)).toContain("an amount above zero, no more than the refundable total");
    expect(describedBy(record)).toContain("a reason of at least 10 characters");

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "Learner could not attend." } });

    expect(record.disabled).toBe(false);
    expect(record.getAttribute("aria-describedby")).toBeNull();
  });
});
