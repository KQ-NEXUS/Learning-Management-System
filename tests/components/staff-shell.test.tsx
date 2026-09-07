import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StaffShell } from "@/app/staff/StaffShell";

const route = vi.hoisted(() => ({ pathname: "/staff/courses" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
let desktop = false;
const listeners = new Set<() => void>();
const removeListener = vi.fn((_: string, listener: () => void) => listeners.delete(listener));
beforeEach(() => {
  desktop = false;
  route.pathname = "/staff/courses";
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return desktop; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: removeListener,
  })));
});
afterEach(() => { cleanup(); listeners.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const nav = ["Courses", "Programmes", "Users", "Roles", "Audit"].map(label => ({ label, href: `/staff/${label.toLowerCase()}` }));
function Shell() {
  return <StaffShell nav={nav} identity={null} signOut={<button>Sign out</button>}><button>Page action</button></StaffShell>;
}
function resize(value: boolean) { act(() => { desktop = value; listeners.forEach(listener => listener()); }); }

describe("StaffShell responsive navigation", () => {
  it("makes closed mobile navigation inert and hides it from assistive technology", () => {
    const { container } = render(<Shell />);
    const aside = container.querySelector("aside")!;
    expect(aside.hasAttribute("inert")).toBe(true);
    expect(aside.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
  });
  it("focuses the first link, wraps both Tab directions, isolates background and restores focus on Escape", () => {
    render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    const background = screen.getByRole("main").parentElement!;
    fireEvent.click(trigger);
    const links = within(screen.getByRole("navigation", { name: "Workspace" })).getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(document.activeElement).toBe(links[0]);
    expect(background.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(links[4]);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(links[0]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(background.hasAttribute("inert")).toBe(false);
  });
  it("closes via backdrop or navigation, including a same-route link", () => {
    const { container, rerender } = render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(trigger);
    fireEvent.click(container.querySelector(".fixed.inset-0")!);
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const currentLink = screen.getByRole("link", { name: "Courses" });
    // JSDOM cannot navigate; cancellation preserves the shell's click handler.
    currentLink.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(currentLink);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    route.pathname = "/staff/users";
    rerender(<Shell />);
    expect(document.activeElement).toBe(trigger);
  });
  it("keeps desktop navigation active and releases mobile isolation on resize without focusing the hidden trigger", () => {
    const { container } = render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(trigger);
    const first = screen.getByRole("link", { name: "Courses" });
    resize(true);
    expect(container.querySelector("aside")!.hasAttribute("inert")).toBe(false);
    expect(container.querySelector("aside")!.getAttribute("aria-hidden")).not.toBe("true");
    expect(screen.getByRole("main").parentElement!.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(first);
    resize(false);
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector("aside")!.hasAttribute("inert")).toBe(true);
  });
  it("initializes on desktop and removes its media listener on unmount", () => {
    desktop = true;
    const { container, unmount } = render(<Shell />);
    expect(container.querySelector("aside")!.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeTruthy();
    unmount();
    expect(removeListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
  it("restores an existing background inert state when closing and unmounting", () => {
    const { unmount } = render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    const background = screen.getByRole("main").parentElement!;
    background.setAttribute("inert", "");
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(background.hasAttribute("inert")).toBe(true);
    background.removeAttribute("inert");
    fireEvent.click(trigger);
    unmount();
    expect(background.hasAttribute("inert")).toBe(false);
  });
});

describe("StaffShell sticky sidebar layout", () => {
  // jsdom has no layout or scroll engine, so this locks the class contract that
  // keeps the desktop sidebar pinned. `overflow-x: hidden` forces `overflow-y`
  // to compute to `auto`, making the element a scroll container; if the row
  // wrapper is that container, the sidebar's `lg:sticky` anchors to it instead
  // of the viewport and slides out of view as a tall route scrolls.
  it("never clips overflow-x on the flex row that the sticky sidebar anchors against", () => {
    const { container } = render(<Shell />);
    const aside = container.querySelector("aside")!;
    const row = aside.parentElement!;
    expect(row.className).toContain("flex");
    expect(row.className).toContain("min-h-screen");
    expect(row.className).not.toMatch(/(^|\s)(lg:)?overflow-x-hidden(\s|$)/);
    expect(row.className).not.toMatch(/(^|\s)(lg:)?overflow-hidden(\s|$)/);
  });

  it("keeps the sidebar pinned full-height on desktop and scrollable when its own content overflows", () => {
    const { container } = render(<Shell />);
    const aside = container.querySelector("aside")!;
    expect(aside.className).toContain("lg:sticky");
    expect(aside.className).toContain("lg:top-0");
    expect(aside.className).toContain("lg:h-screen");
    // Its own content (nav + identity chip) scrolls rather than clipping on a short viewport.
    expect(aside.className).toContain("overflow-y-auto");
  });

  it("clips horizontal bleed on the content column instead of the sticky row", () => {
    const { container } = render(<Shell />);
    const contentColumn = screen.getByRole("main").parentElement!;
    // Same element the mobile background-inert logic targets.
    expect(contentColumn).toBe(container.querySelector("aside")!.nextElementSibling);
    expect(contentColumn.className).toContain("overflow-x-hidden");
  });
});
