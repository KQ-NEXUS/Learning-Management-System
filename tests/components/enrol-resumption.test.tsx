import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { startCheckout, redirect, headerValues } = vi.hoisted(() => ({
  startCheckout: vi.fn(),
  headerValues: new Map<string, string>(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers([...headerValues]) }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: async () => ({ userId: "learner-1" }) }));
vi.mock("@/server/services/checkout-service", () => ({
  startCheckout,
  getCohortOfferPath: async () => "/courses/example",
  CurrencyUnavailableError: class extends Error {},
}));
vi.mock("@/app/(checkout)/actions", () => ({ enrollAction: vi.fn() }));

import EnrolResumptionPage from "@/app/(checkout)/enrol/[cohortId]/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  headerValues.clear();
});

const props = () => ({
  params: Promise.resolve({ cohortId: "cohort-1" }),
  searchParams: Promise.resolve({ currency: "NGN" }),
});

describe("F-13 — /enrol only starts checkout on a same-origin navigation", () => {
  it("our own post-sign-in redirect (same-origin) resumes checkout straight away", async () => {
    headerValues.set("sec-fetch-site", "same-origin");
    startCheckout.mockResolvedValue({ orderId: "order-9" });
    await expect(EnrolResumptionPage(props())).rejects.toThrow("NEXT_REDIRECT:/checkout/order-9");
    expect(startCheckout).toHaveBeenCalledTimes(1);
  });

  it.each(["cross-site", "same-site", "none"])(
    "a %s navigation creates nothing and asks the learner to confirm with a POST",
    async (site) => {
      headerValues.set("sec-fetch-site", site);
      render(await EnrolResumptionPage(props()));
      expect(startCheckout).not.toHaveBeenCalled();
      const button = screen.getByRole("button", { name: "Continue to checkout" });
      const form = button.closest("form")!;
      expect((form.querySelector("input[name=cohortId]") as HTMLInputElement).value).toBe("cohort-1");
      expect((form.querySelector("input[name=currency]") as HTMLInputElement).value).toBe("NGN");
    },
  );

  it("a browser that sends no Sec-Fetch-Site header also gets the confirm step", async () => {
    render(await EnrolResumptionPage(props()));
    expect(startCheckout).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Continue to checkout" })).toBeTruthy();
  });
});

describe("UX batch B — a checkout that can't start says why", () => {
  it.each([
    ["AlreadyEnrolledError", "enrolled"],
    ["CapacityExceededError", "full"],
    ["CohortClosedError", "closed"],
  ] as const)("%s returns to the course page with ?notice=%s", async (name, notice) => {
    const seats = await import("@/server/services/seat-accounting");
    const ErrorClass = seats[name] as unknown as new (...args: unknown[]) => Error;
    headerValues.set("sec-fetch-site", "same-origin");
    startCheckout.mockRejectedValue(Object.create(ErrorClass.prototype));
    await expect(EnrolResumptionPage(props())).rejects.toThrow(`NEXT_REDIRECT:/courses/example?notice=${notice}`);
  });

  it("a currency this cohort no longer sells returns with ?notice=currency", async () => {
    const { CurrencyUnavailableError } = await import("@/server/services/checkout-service");
    headerValues.set("sec-fetch-site", "same-origin");
    startCheckout.mockRejectedValue(new CurrencyUnavailableError("cohort-1", "NGN"));
    await expect(EnrolResumptionPage(props())).rejects.toThrow("NEXT_REDIRECT:/courses/example?notice=currency");
  });
});
