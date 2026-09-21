import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CohortForm } from "@/app/staff/cohorts/CohortForm";

/**
 * CohortForm — dual-price fields (07-05, D-06/D-08/D-24).
 *
 * `tests/components/cohort-pages.test.tsx` mocks `CohortForm` entirely away
 * (its two async Server Component tests call `DetailPage`/`EditPage` directly
 * and inspect the returned element tree without further rendering, which is
 * incompatible with fully rendering the "use client" `CohortForm` itself).
 * This file follows `tests/components/course-form.test.tsx`'s established
 * precedent instead — a real `@testing-library/react` render — to prove the
 * actual field labels, hint copy, required-ness and pre-fill behaviour the
 * mocked-away file cannot see.
 */

vi.mock("@/app/staff/cohorts/actions", () => ({
  createCohortAction: vi.fn(),
  updateCohortAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const COURSES = [{ id: "course-1", title: "Course One" }];
const PROGRAMMES: Array<{ id: string; title: string }> = [];

describe("CohortForm — dual-price fields", () => {
  it("renders the NGN and USD base price fields with the exact UI-SPEC labels, hints and section note", () => {
    render(<CohortForm mode="create" courses={COURSES} programmes={PROGRAMMES} />);

    expect(screen.getByLabelText("NGN base price")).toBeTruthy();
    expect(screen.getByLabelText("USD base price")).toBeTruthy();

    expect(
      screen.getByText(
        "Whole integer minor units (kobo) — e.g. 45000000 for ₦450,000.00. Leave blank if this Cohort does not sell in NGN.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Whole integer minor units (cents) — e.g. 50000 for $500.00. Leave blank if this Cohort does not sell in USD.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "No currency conversion happens — each price is set independently and never derived from the other.",
      ),
    ).toBeTruthy();
  });

  it("carries no required attribute on either price field — a Cohort may sell on one rail only (D-08)", () => {
    render(<CohortForm mode="create" courses={COURSES} programmes={PROGRAMMES} />);
    const ngnInput = screen.getByLabelText("NGN base price") as HTMLInputElement;
    const usdInput = screen.getByLabelText("USD base price") as HTMLInputElement;
    expect(ngnInput.required).toBe(false);
    expect(usdInput.required).toBe(false);
  });

  it("renders no Currency field — currency is no longer an administrator choice", () => {
    render(<CohortForm mode="create" courses={COURSES} programmes={PROGRAMMES} />);
    expect(screen.queryByLabelText("Currency")).toBeNull();
    expect(screen.queryByLabelText(/^Price \(minor units\)/)).toBeNull();
  });

  it("pre-fills each price field from its own stored value on edit; a null rail pre-fills blank, never 0", () => {
    render(
      <CohortForm
        mode="edit"
        cohortId="cohort-1"
        expectedUpdatedAt="2026-01-01T00:00:00.000Z"
        courses={COURSES}
        programmes={PROGRAMMES}
        values={{ priceNgnMinor: 45000000, priceUsdMinor: null }}
      />,
    );
    const ngnInput = screen.getByLabelText("NGN base price") as HTMLInputElement;
    const usdInput = screen.getByLabelText("USD base price") as HTMLInputElement;
    expect(ngnInput.value).toBe("45000000");
    expect(usdInput.value).toBe("");
  });

  it("pre-fills the USD field and leaves NGN blank when only the USD rail is stored", () => {
    render(
      <CohortForm
        mode="edit"
        cohortId="cohort-1"
        expectedUpdatedAt="2026-01-01T00:00:00.000Z"
        courses={COURSES}
        programmes={PROGRAMMES}
        values={{ priceNgnMinor: null, priceUsdMinor: 50000 }}
      />,
    );
    const ngnInput = screen.getByLabelText("NGN base price") as HTMLInputElement;
    const usdInput = screen.getByLabelText("USD base price") as HTMLInputElement;
    expect(ngnInput.value).toBe("");
    expect(usdInput.value).toBe("50000");
  });
});
