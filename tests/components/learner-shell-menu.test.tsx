import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/courses" }));

import { LearnerShell } from "@/components/shell/LearnerShell";

afterEach(cleanup);

const NAV = [{ label: "Courses", href: "/courses" }];

describe("LearnerShell phone menu", () => {
  it("shows the extra links only once the menu is open", () => {
    render(
      <LearnerShell nav={NAV} rightSlot={null} mobileMenuExtra={<a href="/signin">Sign in</a>}>
        content
      </LearnerShell>,
    );
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });

  it("Escape closes the menu and returns focus to the menu button", () => {
    render(
      <LearnerShell nav={NAV} rightSlot={null} mobileMenuExtra={<a href="/signin">Sign in</a>}>
        content
      </LearnerShell>,
    );
    const button = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open navigation" }));
  });
});
