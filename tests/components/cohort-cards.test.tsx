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
    priceMinor: 15000,
    currency: "USD",
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

  it("renders a working Enroll now control and the seat count when seatsAvailable is 1 (the last-seat boundary)", () => {
    render(<CohortCards cohorts={[cohort({ id: "c1", seatsAvailable: 1 })]} />);
    expect(screen.getByRole("button", { name: "Enroll now" })).toBeTruthy();
    expect(screen.getByText("1 seats left")).toBeTruthy();
    const hidden = document.querySelector('input[name="cohortId"]') as HTMLInputElement | null;
    expect(hidden?.value).toBe("c1");
  });

  it("renders the Enroll now control and seat count for a cohort with many seats available", () => {
    render(<CohortCards cohorts={[cohort({ id: "c1", seatsAvailable: 12 })]} />);
    expect(screen.getByRole("button", { name: "Enroll now" })).toBeTruthy();
    expect(screen.getByText("12 seats left")).toBeTruthy();
  });

  it("shows the date range, delivery mode as plain text, and the formatted price", () => {
    const startsAt = new Date("2026-11-10T12:00:00Z");
    const endsAt = new Date("2026-11-14T12:00:00Z");
    render(
      <CohortCards
        cohorts={[cohort({ id: "c1", startsAt, endsAt, deliveryMode: "SELF_PACED", priceMinor: 25000, currency: "USD" })]}
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
    expect(screen.getAllByRole("button", { name: "Enroll now" })).toHaveLength(1);
    expect(screen.queryByText(/1 of 1/i)).toBeNull();
  });

  it("renders five stacked cohorts with no pagination control", () => {
    const cohorts = Array.from({ length: 5 }, (_, i) =>
      cohort({ id: `c${i}`, seatsAvailable: i + 1 }),
    );
    render(<CohortCards cohorts={cohorts} />);
    expect(screen.getAllByRole("button", { name: "Enroll now" })).toHaveLength(5);
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
});
