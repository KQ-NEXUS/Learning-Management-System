import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AuthLayout from "@/app/(auth)/layout";

afterEach(cleanup);

describe("auth layout landmarks", () => {
  it("puts the brand panel in a banner and the form in main", () => {
    render(<AuthLayout><p>Sign in form</p></AuthLayout>);

    const banner = screen.getByRole("banner");
    expect(banner.textContent).toContain("KQ Nexus");
    expect(screen.getByRole("main").textContent).toContain("Sign in form");
    expect(banner.contains(screen.getByRole("main"))).toBe(false);
  });

  it("has no heading before the page's own h1", () => {
    render(<AuthLayout><h1>Sign in</h1></AuthLayout>);
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => h.tagName)).toEqual(["H1"]);
  });
});
