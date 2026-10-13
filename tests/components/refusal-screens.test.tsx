/**
 * The two whole-page refusal screens (launch checklist W-08, found by plan 15-19): a staff
 * member without the permission who opens `/staff/operations` or `/staff/privacy` directly.
 * Each must have exactly one page heading (h1) naming the page, so a screen-reader user
 * lands on a titled page, with the refusal as the next heading level and none skipped.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OperationsDenied } from "@/app/staff/operations/OperationsDenied";
import { PrivacyDenied } from "@/app/staff/privacy/PrivacyDenied";

afterEach(cleanup);

const SCREENS = [
  { name: "Operations status", Component: OperationsDenied, refusal: "You do not have access to the operations status" },
  { name: "Learner privacy", Component: PrivacyDenied, refusal: "You do not have access to learner privacy tools" },
] as const;

describe.each(SCREENS)("refusal screen: $name", ({ name, Component, refusal }) => {
  it("has exactly one page heading, and it names the page", () => {
    render(<Component />);
    const pageHeadings = screen.getAllByRole("heading", { level: 1 });
    expect(pageHeadings.map((heading) => heading.textContent)).toEqual([name]);
  });

  it("gives the refusal the next heading level, with no level skipped", () => {
    render(<Component />);
    expect(screen.getByRole("heading", { level: 2, name: refusal })).toBeTruthy();
    const levels = screen.getAllByRole("heading").map((heading) => Number(heading.tagName.slice(1)));
    expect(levels).toEqual([1, 2]);
  });

  it("still says which permission is missing and who to ask", () => {
    render(<Component />);
    expect(screen.getByText(/Ask a workspace administrator if you need it\./)).toBeTruthy();
    expect(screen.getByText("403")).toBeTruthy();
  });
});
