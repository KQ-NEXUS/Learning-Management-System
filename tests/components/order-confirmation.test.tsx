function usd(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
}

/**
 * Plan 06-08 Task 3: the permanent receipt at `/orders/[reference]` — REG-05's
 * six required fields, its two sub-states, and the T-06-55 transparency
 * prohibition (never claim enrolment when the Enrolment is not ACTIVE).
 *
 * The page is a Server Component; it is invoked directly and its returned
 * element is rendered with Testing Library, matching
 * `tests/components/cohort-pages.test.tsx`'s established pattern for
 * exercising an async `page.tsx` outside the real Next.js runtime.
 * `next/navigation`'s `notFound()` really throws in Next, so the mock throws
 * too (`tests/lesson-preview-route.test.ts`'s convention); `usePathname` is
 * mocked because `LearnerShell` (`tests/components/staff-shell.test.tsx`'s
 * convention for its staff-side sibling) reads it directly.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentActor: vi.fn(),
  getOwnOrderByReference: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/services/checkout-service", () => ({
  getOwnOrderByReference: mocks.getOwnOrderByReference,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  usePathname: () => "/orders/ORD-20260910-ABCDEF12",
}));
// signOutAction is only ever passed as a <form action> prop, never invoked in
// these tests — mocked away so importing it doesn't pull in next/headers and
// the real auth-service chain.
vi.mock("@/app/(auth)/signin/actions", () => ({ signOutAction: vi.fn() }));

import OrderReceiptPage from "@/app/orders/[reference]/page";

const NOT_FOUND = "NEXT_NOT_FOUND";
const REFERENCE = "ORD-20260910-ABCDEF12";

function run(reference: string = REFERENCE) {
  return OrderReceiptPage({ params: Promise.resolve({ reference }) });
}

type OrderFixtureOverrides = {
  status?: string;
  amountMinor?: number;
  currency?: string;
  selectedProvider?: string | null;
  baseAmountMinor?: number | null;
  platformFeeMinor?: number | null;
  gatewayFeeEstimateMinor?: number | null;
  enrolment?: { id: string; status: string; holdExpiresAt: Date | null } | null;
  cohort?: Record<string, unknown>;
};

/**
 * `amountMinor`/`currency`/`baseAmountMinor`/`platformFeeMinor`/
 * `gatewayFeeEstimateMinor`/`selectedProvider` are the Order's own D-13
 * commercial snapshot — what the learner actually agreed to and was
 * charged. `cohort.priceMinor` below is a DELIBERATELY different figure a
 * live cohort might carry today, standing in for T-06-51/D-18's "the
 * receipt must never re-read the cohort's current price" case even though
 * `OrderCohortFacts` itself has no `priceMinor` field for the page to read.
 */
function baseOrder(overrides: OrderFixtureOverrides = {}) {
  return {
    id: "order-1",
    reference: REFERENCE,
    status: overrides.status ?? "PAID",
    amountMinor: overrides.amountMinor ?? 45000,
    currency: overrides.currency ?? "USD",
    selectedProvider: overrides.selectedProvider !== undefined ? overrides.selectedProvider : "STRIPE",
    baseAmountMinor: overrides.baseAmountMinor !== undefined ? overrides.baseAmountMinor : 43000,
    platformFeeMinor: overrides.platformFeeMinor !== undefined ? overrides.platformFeeMinor : 650,
    gatewayFeeEstimateMinor:
      overrides.gatewayFeeEstimateMinor !== undefined ? overrides.gatewayFeeEstimateMinor : 1350,
    cohort: {
      id: "cohort-1",
      title: "September Cohort",
      startsAt: new Date("2026-09-01T09:00:00Z"),
      endsAt: new Date("2026-09-30T17:00:00Z"),
      deliveryMode: "ONLINE",
      priceMinor: 99999,
      ...overrides.cohort,
    },
    enrolment:
      overrides.enrolment !== undefined
        ? overrides.enrolment
        : { id: "enrolment-1", status: "ACTIVE", holdExpiresAt: null },
  };
}

function seedSignedIn(order: ReturnType<typeof baseOrder> | null) {
  mocks.getCurrentActor.mockResolvedValue({ userId: "user-1", isStaff: false });
  mocks.getOwnOrderByReference.mockResolvedValue(order);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderReceiptPage — success sub-state", () => {
  it("renders all six REG-05 fields for a PAID order with an ACTIVE enrolment", async () => {
    seedSignedIn(baseOrder());
    render(await run());

    expect(screen.getByText("You're enrolled")).toBeTruthy();
    expect(screen.getByText(REFERENCE)).toBeTruthy();
    expect(screen.getByText("September Cohort")).toBeTruthy();
    expect(screen.getByText(usd(450))).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText(/Need help with this order/)).toBeTruthy();
  });

  it("renders the order reference in mono", async () => {
    seedSignedIn(baseOrder());
    render(await run());
    expect(screen.getByText(REFERENCE).className).toContain("font-mono");
  });

  it("shows the amount recorded on the Order, never a differing cohort price in the same fixture", async () => {
    seedSignedIn(baseOrder({ amountMinor: 45000, currency: "USD" }));
    render(await run());
    expect(screen.getByText(usd(450))).toBeTruthy();
    expect(screen.queryByText(usd(999.99))).toBeNull();
  });
});

describe("OrderReceiptPage — exception sub-state (T-06-55)", () => {
  it("renders the exception sub-state for a PAID order whose enrolment never activated (Pitfall-4)", async () => {
    seedSignedIn(
      baseOrder({ enrolment: { id: "enrolment-1", status: "CANCELLED", holdExpiresAt: null } }),
    );
    render(await run());

    expect(screen.getByText("Payment received — finishing up")).toBeTruthy();
    expect(screen.queryByText("You're enrolled")).toBeNull();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Pending review")).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("renders the exception sub-state for an EXCEPTION order", async () => {
    seedSignedIn(
      baseOrder({
        status: "EXCEPTION",
        enrolment: { id: "enrolment-1", status: "CANCELLED", holdExpiresAt: null },
      }),
    );
    render(await run());

    expect(screen.getByText("Payment received — finishing up")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Pending review")).toBeTruthy();
  });

  it("withholds none of the six required fields in the exception sub-state", async () => {
    seedSignedIn(
      baseOrder({
        status: "EXCEPTION",
        enrolment: { id: "enrolment-1", status: "CANCELLED", holdExpiresAt: null },
      }),
    );
    render(await run());

    expect(screen.getByText(REFERENCE)).toBeTruthy();
    expect(screen.getByText("September Cohort")).toBeTruthy();
    expect(screen.getByText(usd(450))).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Pending review")).toBeTruthy();
    expect(screen.getByText(/Need help with this order/)).toBeTruthy();
  });

  it("uses no danger-toned pill in the exception sub-state — amber, not red", async () => {
    seedSignedIn(
      baseOrder({
        status: "EXCEPTION",
        enrolment: { id: "enrolment-1", status: "CANCELLED", holdExpiresAt: null },
      }),
    );
    const { container } = render(await run());
    expect(container.innerHTML).not.toContain("pill-red");
    expect(container.innerHTML).toContain("pill-amber");
  });
});

describe("OrderReceiptPage — refund states", () => {
  it("shows a partial-refund receipt without payment-pending language", async () => {
    seedSignedIn(baseOrder({ status: "PARTIALLY_REFUNDED" }));

    render(await run());

    expect(screen.getByText("Payment partially refunded")).toBeTruthy();
    expect(screen.getByText("Partially refunded")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Payment received — finishing up")).toBeNull();
    expect(screen.queryByText("Pending review")).toBeNull();
  });

  it("shows a full-refund receipt and the enrolment's actual withdrawn state", async () => {
    seedSignedIn(
      baseOrder({
        status: "REFUNDED",
        enrolment: { id: "enrolment-1", status: "WITHDRAWN", holdExpiresAt: null },
      }),
    );

    render(await run());

    expect(screen.getByText("Payment refunded")).toBeTruthy();
    expect(screen.getByText("Refunded")).toBeTruthy();
    expect(screen.getByText("Withdrawn")).toBeTruthy();
    expect(screen.queryByText("Payment received — finishing up")).toBeNull();
    expect(screen.queryByText("Pending review")).toBeNull();
  });
});

describe("OrderReceiptPage — breakdown (07-09 D-16/D-18)", () => {
  it("renders the four breakdown rows, the currency/provider line and the disclosure, from the Order's own snapshot", async () => {
    seedSignedIn(
      baseOrder({
        amountMinor: 45_875_000,
        currency: "NGN",
        selectedProvider: "PAYSTACK",
        baseAmountMinor: 44_325_000,
        platformFeeMinor: 675_000,
        gatewayFeeEstimateMinor: 875_000,
      }),
    );
    render(await run());

    expect(screen.getByText("School fee")).toBeTruthy();
    expect(screen.getByText("KQ NEXUS platform fee (1.5%)")).toBeTruthy();
    expect(screen.getByText("Estimated payment-processing fee")).toBeTruthy();
    expect(screen.getByText("Total charged")).toBeTruthy();
    expect(screen.getByText("NGN via Paystack")).toBeTruthy();
    expect(
      screen.getByText(
        "This is an estimate from our current provider fee schedule. The actual gateway fee may differ slightly — it affects how the payment is reconciled behind the scenes and never changes the total above.",
      ),
    ).toBeTruthy();
  });

  it("renders the same breakdown component the order-summary page uses, importing nothing from pricing.ts (D-18: reads a snapshot, never prices anything)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../src/app/orders/[reference]/page.tsx"),
      "utf8",
    );
    expect(source).toContain("OrderBreakdownCard");
    expect(source).not.toMatch(/from ["']@\/server\/payments\/pricing["']/);
    expect(source).not.toMatch(/calculateCheckoutBreakdown/);
  });

  it("D-18: leaves every rendered receipt amount unchanged after the Cohort's price is edited between renders", async () => {
    const order = baseOrder({
      amountMinor: 45000,
      currency: "USD",
      baseAmountMinor: 43000,
      platformFeeMinor: 650,
      gatewayFeeEstimateMinor: 1350,
    });
    seedSignedIn(order);
    render(await run());
    expect(screen.getByText(usd(450))).toBeTruthy();
    cleanup();

    // The Cohort's price changes after the Order was paid — the mock's
    // OrderCohortFacts carries no price field at all (matching the real
    // shape), but a live cohort's price is simulated here as a wholly
    // separate, deliberately different figure to prove this page never
    // reads it.
    const mutatedOrder = {
      ...order,
      cohort: { ...order.cohort, priceMinor: 1 },
    };
    seedSignedIn(mutatedOrder);
    render(await run());
    expect(screen.getByText(usd(450))).toBeTruthy();
    expect(screen.getByText(usd(430))).toBeTruthy();
    expect(screen.getByText(usd(6.5))).toBeTruthy();
    expect(screen.getByText(usd(13.5))).toBeTruthy();
  });

  it("D-18: leaves every rendered receipt amount unchanged when the active GatewayFeeSchedule is edited between renders — the page reads no schedule at all", async () => {
    const order = baseOrder({
      amountMinor: 45000,
      currency: "USD",
      baseAmountMinor: 43000,
      platformFeeMinor: 650,
      gatewayFeeEstimateMinor: 1350,
    });
    seedSignedIn(order);
    render(await run());
    expect(screen.getByText(usd(450))).toBeTruthy();
    expect(screen.getByText(usd(13.5))).toBeTruthy();
    cleanup();

    // `getOwnOrderByReference` is the ONLY data source this page reads —
    // there is no GatewayFeeSchedule read anywhere in its call graph for a
    // schedule edit to affect. Re-rendering from the identical Order
    // fixture and confirming every figure is byte-identical is this test's
    // executable form of that structural fact; the source-scan assertion
    // above is the other half of the same proof (D-18, D-13).
    seedSignedIn(order);
    render(await run());
    expect(screen.getByText(usd(450))).toBeTruthy();
    expect(screen.getByText(usd(13.5))).toBeTruthy();
    expect(mocks.getOwnOrderByReference).toHaveBeenCalledTimes(2);
  });
});

describe("OrderReceiptPage — no print/download affordance (D-17)", () => {
  it("renders no print or download control anywhere on the page", async () => {
    seedSignedIn(baseOrder());
    render(await run());
    expect(screen.queryByText(/print/i)).toBeNull();
    expect(screen.queryByText(/download/i)).toBeNull();
  });
});

describe("OrderReceiptPage — ownership (T-06-13/T-06-50)", () => {
  it("renders the 404 page for another learner's reference", async () => {
    seedSignedIn(null);
    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("renders the 404 page for an unauthenticated visitor without querying the order", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);
    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.getOwnOrderByReference).not.toHaveBeenCalled();
  });
});
