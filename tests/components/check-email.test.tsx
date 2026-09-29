import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CheckEmail } from "@/app/(auth)/CheckEmail";

afterEach(cleanup);

describe("CheckEmail — UX batch B: not a dead end", () => {
  it("is announced, says how long the link lasts, and leads back to sign in", () => {
    render(<CheckEmail subtitle="We've sent a link." expiresIn="1 hour" retryHref="/forgot-password" retryLabel="Try a different email" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Check your email/);
    expect(status.textContent).toMatch(/works for 1 hour/);
    expect(status.textContent).toMatch(/spam or junk/);
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("/signin");
    expect(screen.getByRole("link", { name: "Try a different email" }).getAttribute("href")).toBe("/forgot-password");
  });

  it("omits the retry link when none is given", () => {
    render(<CheckEmail subtitle="Verify your address." expiresIn="24 hours" />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
