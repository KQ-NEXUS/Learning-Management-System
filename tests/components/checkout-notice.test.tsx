import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CheckoutNotice } from "@/app/(public)/CheckoutNotice";

afterEach(cleanup);

describe("CheckoutNotice — UX batch B", () => {
  it.each([
    ["full", /now full/i],
    ["closed", /no longer taking enrolments/i],
    ["currency", /no longer available in that currency/i],
  ] as const)("explains the %s case", (notice, text) => {
    render(<CheckoutNotice notice={notice} />);
    expect(screen.getByRole("status").textContent).toMatch(text);
  });

  it("an already-enrolled learner gets a link to their dashboard", () => {
    render(<CheckoutNotice notice="enrolled" />);
    expect(screen.getByRole("status").textContent).toMatch(/already enrolled/i);
    expect(screen.getByRole("link", { name: /dashboard/i }).getAttribute("href")).toBe("/dashboard");
  });

  it("renders nothing for a missing, unknown or repeated value", () => {
    for (const notice of [undefined, "", "hacked<script>", ["full", "closed"]]) {
      const { container } = render(<CheckoutNotice notice={notice} />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });
});
