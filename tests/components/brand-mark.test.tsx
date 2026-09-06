import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaffShell } from "@/app/staff/StaffShell";
import { LearnerShell } from "@/components/shell/LearnerShell";
import AuthLayout from "@/app/(auth)/layout";

vi.mock("next/navigation", () => ({ usePathname: () => "/staff/courses" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const paths = ["M10 3 3.5 6.2 10 9.4l6.5-3.2L10 3Z", "M3.5 10.2 10 13.4l6.5-3.2"];
describe("approved brand glyph", () => {
  it.each(["staff", "learner", "auth"])("renders decorative approved paths with an adjacent wordmark in %s shell", shell => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const content = <p>Page content</p>;
    const { container } = render(shell === "staff"
      ? <StaffShell nav={[]} identity={null} signOut={null}>{content}</StaffShell>
      : shell === "learner"
        ? <LearnerShell nav={[]} rightSlot={null}>{content}</LearnerShell>
        : <AuthLayout>{content}</AuthLayout>);
    const svg = container.querySelector('svg[viewBox="0 0 20 20"]');
    expect(svg).not.toBeNull();
    expect(Array.from(svg!.querySelectorAll("path"), path => path.getAttribute("d"))).toEqual(paths);
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.getAttribute("focusable")).toBe("false");
    expect(svg!.getAttribute("stroke")).toBe("currentColor");
    expect(svg!.parentElement!.className).toContain("text-accent-contrast");
    expect(svg!.parentElement!.getAttribute("style")).toContain("linear-gradient(140deg");
    expect(screen.getByText("KQ Nexus")).toBeTruthy();
    expect(screen.getByText("Page content")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    if (shell === "learner") expect(screen.getByRole("link", { name: "KQ Nexus" }).getAttribute("href")).toBe("/courses");
  });
  it("includes the glyph in server-rendered auth layout markup", () => {
    const html = renderToStaticMarkup(<AuthLayout><p>Sign in</p></AuthLayout>);
    expect(html).toContain(paths[0]);
    expect(html).toContain(paths[1]);
    expect(html).toContain("Sign in");
  });
});
