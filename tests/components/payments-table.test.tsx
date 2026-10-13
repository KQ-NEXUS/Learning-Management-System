/**
 * The staff payments list (checklist rows H-07 and W-12).
 *
 * The list is paged on the server, 50 orders at a time. The status tabs,
 * their counts, the search box and the provider filter used to work in the
 * browser over the rows already loaded, so with 120 payments the "All" tab
 * read 50 and a search could miss a payment on another page.
 *
 * They now belong to the server: the counts are props (every order the staff
 * member may see), and changing a tab, the provider or the search changes the
 * address, so the server reads the matching orders. These cases prove the
 * table never filters or counts the rows it was handed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PaymentsTable, type PaymentRow } from "@/app/staff/payments/PaymentsTable";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  router.replace.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function row(i: number, over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: `order-${i}`,
    reference: `ORD-${String(i).padStart(3, "0")}`,
    cohortTitle: "Cohort A",
    learnerName: `Learner ${i}`,
    learnerEmail: `learner${i}@example.com`,
    amountMinor: 10_000 + i,
    currency: "NGN",
    provider: "PAYSTACK",
    status: "PAID",
    settlementState: "ESTIMATED_ONLY",
    ...over,
  };
}

/** One page of 50 PAID orders out of 120 in scope. */
const pageRows = Array.from({ length: 50 }, (_, i) => row(i + 1));
const COUNTS = { PAID: 100, EXCEPTION: 15, PENDING: 5 };

function statusTabs(): HTMLElement {
  return screen.getByRole("group", { name: "Status" });
}

function tab(name: RegExp): HTMLElement {
  return within(statusTabs()).getByRole("button", { name });
}

describe("PaymentsTable — counts come from the server, not from the rows on the page", () => {
  it("shows the count of every order in scope on each tab, with 50 rows loaded out of 120", () => {
    render(<PaymentsTable rows={pageRows} matchingCount={120} totalAll={120} statusCounts={COUNTS} />);

    expect(tab(/^All/).textContent).toBe("All120");
    expect(tab(/^Paid/).textContent).toBe("Paid100");
    // None of the 50 loaded rows is an exception or pending order; the tabs are there all the same.
    expect(tab(/^Exception/).textContent).toBe("Exception15");
    expect(tab(/^Awaiting confirmation/).textContent).toBe("Awaiting confirmation5");
  });

  it("leaves out a status nobody in scope has, but keeps the tab that is open", () => {
    render(
      <PaymentsTable rows={[]} initialStatus="REFUNDED" matchingCount={0} totalAll={120} statusCounts={COUNTS} />,
    );
    expect(within(statusTabs()).queryByRole("button", { name: /^Failed/ })).toBeNull();
    expect(tab(/^Refunded/).getAttribute("aria-pressed")).toBe("true");
    expect(tab(/^Refunded/).textContent).toBe("Refunded0");
  });

  it("marks the tab named in the address as the open one", () => {
    render(
      <PaymentsTable
        rows={pageRows}
        initialStatus="EXCEPTION"
        matchingCount={15}
        totalAll={120}
        statusCounts={COUNTS}
      />,
    );
    expect(tab(/^Exception/).getAttribute("aria-pressed")).toBe("true");
    expect(tab(/^All/).getAttribute("aria-pressed")).toBe("false");
  });

  it("renders every row it is given: it does not filter them again in the browser", () => {
    // The server already applied status=EXCEPTION and the search; a row the table
    // would have filtered out itself (a PAID one) must still be shown.
    render(
      <PaymentsTable
        rows={[row(1, { status: "EXCEPTION" }), row(2, { status: "PAID" })]}
        initialStatus="EXCEPTION"
        search="nothing-in-these-rows"
        matchingCount={2}
        totalAll={120}
        statusCounts={COUNTS}
      />,
    );
    expect(screen.getAllByText("ORD-001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ORD-002").length).toBeGreaterThan(0);
  });

  it("says how many orders match out of all of them when a filter narrows the list", () => {
    render(
      <PaymentsTable
        rows={pageRows}
        initialStatus="EXCEPTION"
        matchingCount={15}
        totalAll={120}
        statusCounts={COUNTS}
      />,
    );
    expect(screen.getByText("15 of 120")).toBeTruthy();
  });

  it("an empty result under a filter says how many payments clearing it would show", () => {
    render(<PaymentsTable rows={[]} search="zzz" matchingCount={0} totalAll={120} statusCounts={COUNTS} />);
    expect(screen.getByText(/Clearing them shows all 120 payments/)).toBeTruthy();
  });
});

describe("PaymentsTable — a filter change asks the server", () => {
  it("a status tab goes to ?status= and drops the page number", () => {
    render(<PaymentsTable rows={pageRows} matchingCount={120} totalAll={120} statusCounts={COUNTS} />);
    fireEvent.click(tab(/^Exception/));
    expect(router.replace).toHaveBeenCalledWith("/staff/payments?status=EXCEPTION");
  });

  it("the All tab removes the status and keeps the provider and the search", () => {
    render(
      <PaymentsTable
        rows={pageRows}
        initialStatus="PAID"
        provider="STRIPE"
        search="ada"
        matchingCount={3}
        totalAll={120}
        statusCounts={COUNTS}
      />,
    );
    fireEvent.click(tab(/^All/));
    expect(router.replace).toHaveBeenCalledWith("/staff/payments?provider=STRIPE&q=ada");
  });

  it("the provider filter goes to ?provider= and keeps the open tab", () => {
    render(
      <PaymentsTable
        rows={pageRows}
        initialStatus="PAID"
        matchingCount={100}
        totalAll={120}
        statusCounts={COUNTS}
      />,
    );
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "MANUAL" } });
    expect(router.replace).toHaveBeenCalledWith("/staff/payments?status=PAID&provider=MANUAL");
  });

  it("the search box waits for a pause in typing, then goes to ?q= once", () => {
    vi.useFakeTimers();
    render(<PaymentsTable rows={pageRows} matchingCount={120} totalAll={120} statusCounts={COUNTS} />);
    const box = screen.getByLabelText("Search");

    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.change(box, { target: { value: "ad" } });
    fireEvent.change(box, { target: { value: " ada@example.com " } });
    expect(router.replace).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/staff/payments?q=ada%40example.com");
  });

  it("does not ask again when the box already shows the search in the address", () => {
    vi.useFakeTimers();
    render(<PaymentsTable rows={pageRows} search="ada" matchingCount={3} totalAll={120} statusCounts={COUNTS} />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("ada");
  });

  it("Clear filters goes back to the plain list", () => {
    render(
      <PaymentsTable
        rows={[]}
        initialStatus="PAID"
        provider="STRIPE"
        search="zzz"
        matchingCount={0}
        totalAll={120}
        statusCounts={COUNTS}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /clear filters/i })[0]);
    expect(router.replace).toHaveBeenCalledWith("/staff/payments");
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("");
  });

  it("Clear filters is not undone by the search box a moment later", () => {
    vi.useFakeTimers();
    render(
      <PaymentsTable
        rows={[]}
        initialStatus="PAID"
        provider="STRIPE"
        search="zzz"
        matchingCount={0}
        totalAll={120}
        statusCounts={COUNTS}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /clear filters/i })[0]);
    // The server has not answered yet, so the props still carry the old filters.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/staff/payments");
  });

  it("a tab clicked while a search is still being typed carries the typed text, once", () => {
    vi.useFakeTimers();
    render(<PaymentsTable rows={pageRows} matchingCount={120} totalAll={120} statusCounts={COUNTS} />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "ada" } });
    fireEvent.click(tab(/^Exception/));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/staff/payments?status=EXCEPTION&q=ada");
  });

  it("follows the address when it changes from outside, without asking the server again", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <PaymentsTable rows={pageRows} search="ada" matchingCount={3} totalAll={120} statusCounts={COUNTS} />,
    );
    rerender(<PaymentsTable rows={pageRows} search="" matchingCount={120} totalAll={120} statusCounts={COUNTS} />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("PaymentsTable — refusal", () => {
  it("shows the same refusal with no count and no tab number, whatever exists", () => {
    render(<PaymentsTable denied={{ permission: "payments.view" }} />);
    expect(screen.queryByText("ORD-001")).toBeNull();
    expect(screen.queryByText(/of 120/)).toBeNull();
  });
});
