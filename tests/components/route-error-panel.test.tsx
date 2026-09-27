import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteErrorPanel } from "@/components/shell/RouteErrorPanel";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function boom(message = "relation \"User\" does not exist", digest?: string) {
  return Object.assign(new Error(message), digest ? { digest } : {});
}

describe("RouteErrorPanel", () => {
  it("offers a retry that calls the boundary's retry()", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    render(<RouteErrorPanel error={boom()} retry={retry} home={{ href: "/staff", label: "Back to overview" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("links home and announces itself as an alert", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteErrorPanel error={boom()} retry={() => {}} home={{ href: "/dashboard", label: "Back to dashboard" }} />);
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
  });

  it("never shows the raw error message, but shows the digest for support", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RouteErrorPanel error={boom("secret stack detail", "abc123")} retry={() => {}} home={{ href: "/", label: "Home" }} />,
    );
    expect(document.body.textContent).not.toContain("secret stack detail");
    expect(screen.getByText("abc123")).toBeTruthy();
  });
});

describe("route error boundaries", () => {
  const app = path.resolve(__dirname, "../../src/app");
  const segments = ["", "staff", "(learner)", "(lesson)", "(public)", "(checkout)", "(auth)", "account"];

  it.each(segments)("app/%s has an error.tsx client boundary that uses retry", (segment) => {
    const file = path.join(app, segment, "error.tsx");
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain("retry");
  });

  it("app has a global-error.tsx that renders its own html and body", () => {
    const file = path.join(app, "global-error.tsx");
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source).toContain("<html");
    expect(source).toContain("<body");
  });

  it.each(["staff", "(learner)", "(lesson)"])("app/%s has a loading.tsx", (segment) => {
    expect(existsSync(path.join(app, segment, "loading.tsx"))).toBe(true);
  });
});
