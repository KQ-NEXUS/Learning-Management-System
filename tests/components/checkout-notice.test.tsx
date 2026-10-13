import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CheckoutNotice } from "@/app/(public)/CheckoutNotice";
import { LEARNER_REFUSAL_MESSAGE } from "@/server/licence/policy";

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
    for (const notice of [undefined, "", "hacked<script>", ["full", "closed"], "__proto__", "constructor", "toString"]) {
      const { container } = render(<CheckoutNotice notice={notice} />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });
});

describe("CheckoutNotice — Phase 14 unavailable notice (OQ8, A12)", () => {
  const SENTENCE = "Enrolment is temporarily unavailable. Please contact support.";

  it("renders exactly the neutral sentence in a status paragraph in the warning style", () => {
    render(<CheckoutNotice notice="unavailable" />);
    const el = screen.getByRole("status");
    expect(el.tagName).toBe("P");
    expect(el.textContent).toBe(SENTENCE);
    expect(el.className).toContain("border-l-2");
    expect(el.className).toContain("border-warning");
    expect(el.className).toContain("bg-warning-surface");
  });

  it("the constant and the rendered notice never name the licence or its state (learner prohibition)", () => {
    const { container } = render(<CheckoutNotice notice="unavailable" />);
    const rendered = container.textContent ?? "";
    for (const text of [LEARNER_REFUSAL_MESSAGE, rendered]) {
      expect(text).not.toMatch(/licen[cs]e|restricted|expir/i);
    }
  });

  it("an unknown key still renders nothing", () => {
    const { container } = render(<CheckoutNotice notice="licence-expired" />);
    expect(container.innerHTML).toBe("");
  });
});
