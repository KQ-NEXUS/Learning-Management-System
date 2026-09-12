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
  enrolment?: { id: string; status: string; holdExpiresAt: Date | null } | null;
  cohort?: Record<string, unknown>;
};

/**
 * `amountMinor`/`currency` are what the learner actually agreed to and was
 * charged; `cohort.priceMinor` below is a DELIBERATELY different figure a
 * live cohort might carry today, standing in for T-06-51's "the receipt
 * must never re-read the cohort's current price" case even though
 * `OrderCohortFacts` itself has no `priceMinor` field for the page to read.
 */
function baseOrder(overrides: OrderFixtureOverrides = {}) {
  return {
    id: "order-1",
    reference: REFERENCE,
    status: overrides.status ?? "PAID",
    amountMinor: overrides.amountMinor ?? 45000,
    currency: overrides.currency ?? "USD",
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
    expect(screen.getByText("$450.00")).toBeTruthy();
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
    expect(screen.getByText("$450.00")).toBeTruthy();
    expect(screen.queryByText("$999.99")).toBeNull();
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
    expect(screen.getByText("$450.00")).toBeTruthy();
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
