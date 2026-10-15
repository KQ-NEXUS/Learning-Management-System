import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaffShell } from "@/app/staff/StaffShell";
import { LearnerShell } from "@/components/shell/LearnerShell";
import { BrandMark } from "@/components/shell/BrandMark";
import AuthLayout from "@/app/(auth)/layout";
import { BRAND } from "@/lib/brand";

/**
 * The IETC shield and name (ietc-redesign): every shell shows the shield as a decorative image
 * beside the school's name, which is what gives the home link its accessible name.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/staff/courses" }));
afterEach(() => {
  cleanup();
});

describe("IETC brand", () => {
  it.each(["staff", "learner", "auth"])("renders the decorative shield beside the school's name in the %s shell", (shell) => {
    const content = <p>Page content</p>;
    const { container } = render(
      shell === "staff" ? (
        <StaffShell nav={[]} identity={null} signOut={null}>
          {content}
        </StaffShell>
      ) : shell === "learner" ? (
        <LearnerShell nav={[]} rightSlot={null}>
          {content}
        </LearnerShell>
      ) : (
        <AuthLayout>{content}</AuthLayout>
      ),
    );
    const shield = container.querySelector(`img[src*="ietc-icon"]`);
    expect(shield).not.toBeNull();
    expect(shield!.getAttribute("alt")).toBe("");
    for (const line of BRAND.nameLines) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText("Page content")).toBeTruthy();
    const home = shield!.closest("a")!;
    expect(home.textContent).toContain(BRAND.nameLines[0]);
    if (shell === "learner") expect(home.getAttribute("href")).toBe("/courses");
    if (shell === "staff") expect(home.getAttribute("href")).toBe("/staff");
  });

  it("includes the shield and the name in server-rendered auth layout markup", () => {
    const html = renderToStaticMarkup(
      <AuthLayout>
        <p>Sign in</p>
      </AuthLayout>,
    );
    expect(html).toContain("ietc-icon");
    expect(html).toContain(BRAND.nameLines[0]);
    expect(html).toContain("Sign in");
  });

  it("keeps BrandMark decorative so the adjacent wordmark names the link", () => {
    const { container } = render(<BrandMark />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("aria-hidden")).toBe("true");
  });
});
