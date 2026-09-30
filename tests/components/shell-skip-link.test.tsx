import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { LearnerShell } from "@/components/shell/LearnerShell";
import { LessonFrame } from "@/components/learner/LessonFrame";

afterEach(cleanup);

function firstFocusable(container: HTMLElement) {
  return container.querySelector<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
}

describe("UX batch D — skip to main content", () => {
  it("the learner shell's first focusable element skips to its <main>", () => {
    const { container } = render(<LearnerShell nav={[{ label: "Dashboard", href: "/dashboard" }]} rightSlot={null}>content</LearnerShell>);
    const skip = firstFocusable(container)!;
    expect(skip.textContent).toBe("Skip to main content");
    expect(container.querySelector(skip.getAttribute("href")!)?.tagName).toBe("MAIN");
  });

  it("the lesson frame's first focusable element skips to its <main>", () => {
    const { container } = render(<LessonFrame backHref="/learn/e1" backLabel="Back to course">content</LessonFrame>);
    const skip = firstFocusable(container)!;
    expect(skip.textContent).toBe("Skip to main content");
    expect(container.querySelector(skip.getAttribute("href")!)?.tagName).toBe("MAIN");
  });

  it("a shell with no navigation shows no empty menu button", () => {
    render(<LearnerShell nav={[]} rightSlot={null}>content</LearnerShell>);
    expect(screen.queryByRole("button", { name: /navigation/i })).toBeNull();
  });
});
