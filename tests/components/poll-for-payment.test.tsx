import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import {
  CONFIRMING_TIMEOUT_MS,
  PollForPayment,
} from "@/app/(checkout)/checkout/[orderId]/confirming/PollForPayment";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PollForPayment — UX batch B: the timeout is not a dead end", () => {
  it("shows a spinner and no support link while confirming", () => {
    const { container } = render(<PollForPayment orderId="order-1" />);
    expect(screen.getByRole("heading", { name: "Confirming your payment" })).toBeTruthy();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("after the timeout the spinner stops and a support link for this order appears", () => {
    const { container } = render(<PollForPayment orderId="order-1" />);
    act(() => {
      vi.advanceTimersByTime(CONFIRMING_TIMEOUT_MS + 1);
    });

    expect(screen.getByRole("heading", { name: "This is taking longer than usual" })).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeNull();
    const link = screen.getByRole("link", { name: /contact support/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/support/new?contextKind=ORDER&contextId=order-1");
    expect(screen.queryByText(/support below/)).toBeNull();
  });
});
