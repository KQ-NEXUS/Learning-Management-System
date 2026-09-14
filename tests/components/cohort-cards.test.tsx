import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { CohortCards } from "@/app/(public)/CohortCards";
import type { PublicCohort } from "@/server/services/public-catalogue-service";

afterEach(cleanup);

// Mirrors CohortCards' own (unexported) formatDateRange so the test asserts
// against the same formatting rule without depending on the component's
// internals, and stays correct under whatever ICU locale this process runs.
function expectedDateRange(startsAt: Date, endsAt: Date): string {
  const fmt = (value: Date) =>
    new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `${fmt(startsAt)}–${fmt(endsAt)}`;
}

function cohort(overrides: Partial<PublicCohort> & { id: string }): PublicCohort {
  return {
    startsAt: new Date("2026-10-01T12:00:00Z"),
    endsAt: new Date("2026-10-05T12:00:00Z"),
    enrolmentOpensAt: new Date("2026-09-01T00:00:00Z"),
    enrolmentClosesAt: new Date("2026-09-30T00:00:00Z"),
    deliveryMode: "INSTRUCTOR_LED",
    // 07-04 tracer: a default NGN price so the (only) rendered CTA in this
    // wave — "Pay in NGN with Paystack" — has something to render by
    // default. 07-09 adds priceUsdMinor coverage alongside the USD CTA.
    priceNgnMinor: 45_000_000,
    priceUsdMinor: null,
    seatsAvailable: 5,
    ...overrides,
  };
}

describe("CohortCards", () => {
  it("renders nothing when the cohort list is empty, leaving the caller's empty-state copy in place", () => {
    const { container } = render(<CohortCards cohorts={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a static Full label and no submit control when seatsAvailable is 0", () => {
    render(<CohortCards cohorts={[cohort({ id: "c1", seatsAvailable: 0 })]} />);
    expect(screen.getByText("Full")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("form")).toBeNull();
  });

  it("renders a working Pay in NGN with Paystack control and the seat count when seatsAvailable is 1 (the last-seat boundary)", () => {
    render(<CohortCards cohorts={[cohort({ id: "c1", seatsAvailable: 1 })]} />);
    expect(screen.getByRole("button", { name: "Pay in NGN with Paystack" })).toBeTruthy();
    expect(screen.getByText("1 seats left")).toBeTruthy();
    const hidden = document.querySelector('input[name="cohortId"]') as HTMLInputElement | null;
    expect(hidden?.value).toBe("c1");
  });

  it("renders the Pay in NGN with Paystack control and seat count for a cohort with many seats available", () => {
    render(<CohortCards cohorts={[cohort({ id: "c1", seatsAvailable: 12 })]} />);
    expect(screen.getByRole("button", { name: "Pay in NGN with Paystack" })).toBeTruthy();
    expect(screen.getByText("12 seats left")).toBeTruthy();
  });

  it("shows the date range, delivery mode as plain text, and the formatted price", () => {
    const startsAt = new Date("2026-11-10T12:00:00Z");
    const endsAt = new Date("2026-11-14T12:00:00Z");
    render(
      <CohortCards
        cohorts={[
          cohort({
            id: "c1",
            startsAt,
            endsAt,
            deliveryMode: "SELF_PACED",
            priceNgnMinor: null,
            priceUsdMinor: 25000,
          }),
        ]}
      />,
    );
    expect(screen.getByText(expectedDateRange(startsAt, endsAt))).toBeTruthy();
    expect(screen.getByText("Self-paced")).toBeTruthy();
    expect(screen.getByText("$250.00")).toBeTruthy();
  });

  it("does not render the delivery mode through the tinted StatusPill primitive", () => {
    render(<CohortCards cohorts={[cohort({ id: "c1", deliveryMode: "BLENDED" })]} />);
    expect(screen.getByText("Blended")).toBeTruthy();
    // StatusPill always renders an aria-hidden dot with this exact class pair;
    // its absence confirms the mode is plain text, not the tinted pill primitive.
    expect(document.querySelector(".rounded-full.size-1\\.5")).toBeNull();
  });

  it("renders a single cohort as one card with no carousel, index number or '1 of 1' affordance", () => {
    render(<CohortCards cohorts={[cohort({ id: "c1" })]} />);
    expect(screen.getAllByRole("button", { name: "Pay in NGN with Paystack" })).toHaveLength(1);
    expect(screen.queryByText(/1 of 1/i)).toBeNull();
  });

  it("renders five stacked cohorts with no pagination control", () => {
    const cohorts = Array.from({ length: 5 }, (_, i) =>
      cohort({ id: `c${i}`, seatsAvailable: i + 1 }),
    );
    render(<CohortCards cohorts={cohorts} />);
    expect(screen.getAllByRole("button", { name: "Pay in NGN with Paystack" })).toHaveLength(5);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText(/page \d/i)).toBeNull();
  });

  it("applies a break-words treatment so long card text wraps instead of overflowing", () => {
    render(<CohortCards cohorts={[cohort({ id: "c1" })]} />);
    expect(document.querySelector(".break-words")).not.toBeNull();
  });

  it("shows no availability, urgency or scarcity copy beyond the literal seat count and the Full label", () => {
    render(
      <CohortCards
        cohorts={[cohort({ id: "c1", seatsAvailable: 1 }), cohort({ id: "c2", seatsAvailable: 0 })]}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(/selling fast|limited|hurry|almost gone|popular|only .* left/i.test(text)).toBe(false);
  });

  describe("07-09: zero/one/two currency-rail branches", () => {
    it("renders both currency CTAs, each posting its own hidden currency field, when both rails are priced", () => {
      render(
        <CohortCards
          cohorts={[cohort({ id: "c1", priceNgnMinor: 45_000_000, priceUsdMinor: 50_000 })]}
        />,
      );
      const ngnButton = screen.getByRole("button", { name: "Pay in NGN with Paystack" });
      const usdButton = screen.getByRole("button", { name: "Pay in USD with Stripe" });
      expect(ngnButton).toBeTruthy();
      expect(usdButton).toBeTruthy();

      const ngnForm = ngnButton.closest("form") as HTMLFormElement;
      expect((ngnForm.querySelector('input[name="currency"]') as HTMLInputElement).value).toBe("NGN");
      const usdForm = usdButton.closest("form") as HTMLFormElement;
      expect((usdForm.querySelector('input[name="currency"]') as HTMLInputElement).value).toBe("USD");
    });

    it("sits both CTAs side by side at >=640px and stacks them full width below, via the same responsive container class", () => {
      render(
        <CohortCards
          cohorts={[cohort({ id: "c1", priceNgnMinor: 45_000_000, priceUsdMinor: 50_000 })]}
        />,
      );
      const ngnButton = screen.getByRole("button", { name: "Pay in NGN with Paystack" });
      const ctaContainer = ngnButton.closest("form")!.parentElement as HTMLElement;
      expect(ctaContainer.className).toContain("flex-col");
      expect(ctaContainer.className).toContain("sm:flex-row");
    });

    it("renders a single USD CTA in the previous single-CTA position when only the USD rail is priced — no empty second slot", () => {
      render(
        <CohortCards cohorts={[cohort({ id: "c1", priceNgnMinor: null, priceUsdMinor: 50_000 })]} />,
      );
      expect(screen.getByRole("button", { name: "Pay in USD with Stripe" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Pay in NGN with Paystack" })).toBeNull();
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });

    it("renders no button and the unavailable-rail notice, with a mailto link, when neither rail is priced", () => {
      render(
        <CohortCards cohorts={[cohort({ id: "c1", priceNgnMinor: null, priceUsdMinor: null })]} />,
      );
      expect(screen.queryByRole("button")).toBeNull();
      expect(
        screen.getByText(/Payment is temporarily unavailable for this cohort\./),
      ).toBeTruthy();
      expect(screen.getByText(/to enrol\./)).toBeTruthy();
      const link = screen.getByRole("link", { name: "Contact support" });
      expect(link.getAttribute("href")).toBe("mailto:support@example.com");
    });

    it("never uses the Full copy for the unavailable-rail notice, and never shows the notice for a full cohort", () => {
      render(
        <CohortCards
          cohorts={[
            cohort({ id: "c1", priceNgnMinor: null, priceUsdMinor: null, seatsAvailable: 0 }),
          ]}
        />,
      );
      expect(screen.getByText("Full")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText(/Payment is temporarily unavailable/)).toBeNull();
    });

    it("shows Full and no button when a cohort is both full and fully priced on both rails (distinct, unrelated conditions)", () => {
      render(
        <CohortCards
          cohorts={[
            cohort({ id: "c1", priceNgnMinor: 45_000_000, priceUsdMinor: 50_000, seatsAvailable: 0 }),
          ]}
        />,
      );
      expect(screen.getByText("Full")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText(/Payment is temporarily unavailable/)).toBeNull();
    });

    it("shows each priced rail's own formatted price and renders no price at all for a null rail (never a zero)", () => {
      render(
        <CohortCards cohorts={[cohort({ id: "c1", priceNgnMinor: 45_000_000, priceUsdMinor: null })]} />,
      );
      expect(screen.getByText(/450,000\.00/)).toBeTruthy();
      expect(screen.queryByText(/\$0\.00/)).toBeNull();
      expect(screen.queryByText("$0.00")).toBeNull();
    });

    it("targets no anchor at the /enrol/ resumption path anywhere in this component", () => {
      render(
        <CohortCards
          cohorts={[
            cohort({ id: "c1", priceNgnMinor: 45_000_000, priceUsdMinor: 50_000 }),
            cohort({ id: "c2", priceNgnMinor: null, priceUsdMinor: null }),
          ]}
        />,
      );
      const anchors = Array.from(document.querySelectorAll("a"));
      expect(anchors.every((a) => !(a.getAttribute("href") ?? "").includes("/enrol/"))).toBe(true);
    });
  });
});
