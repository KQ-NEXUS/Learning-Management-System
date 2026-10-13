/**
 * Collapsible sidebar groups (owner request, 2026-10-04): each labelled group
 * in the staff sidebar folds to its heading, the choice is remembered, and the
 * group holding the current page always stays open.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StaffShell } from "@/app/staff/StaffShell";

const route = vi.hoisted(() => ({ pathname: "/staff/courses" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

const NAV = [
  { label: "Overview", href: "/staff" },
  { label: "Cohorts", href: "/staff/cohorts", group: "Delivery" },
  { label: "Enrolments", href: "/staff/enrolments", group: "Delivery" },
  { label: "Courses", href: "/staff/courses", group: "Catalogue" },
  { label: "Programmes", href: "/staff/programmes", group: "Catalogue" },
  { label: "Users", href: "/staff/users", group: "Administration" },
];

function Shell() {
  return (
    <StaffShell nav={NAV} identity={null} signOut={<button>Sign out</button>}>
      <p>Page</p>
    </StaffShell>
  );
}

const sidebar = () => within(screen.getByRole("navigation", { name: "Workspace", hidden: true }));
const heading = (name: string) => sidebar().getByRole("button", { name, hidden: true });
const link = (name: string) => sidebar().queryByRole("link", { name });

beforeEach(() => {
  route.pathname = "/staff/courses";
  window.localStorage.clear();
  // Desktop, so the sidebar is on screen rather than an inert mobile drawer.
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("staff sidebar — collapsible groups", () => {
  it("before any choice, folds every group except the one holding the current page", () => {
    render(<Shell />);

    expect(heading("Catalogue").getAttribute("aria-expanded")).toBe("true");
    expect(heading("Delivery").getAttribute("aria-expanded")).toBe("false");
    expect(heading("Administration").getAttribute("aria-expanded")).toBe("false");
    for (const name of ["Overview", "Courses", "Programmes"]) expect(link(name)).toBeTruthy();
    for (const name of ["Cohorts", "Enrolments", "Users"]) expect(link(name)).toBeNull();
  });

  it("opens a folded group and folds it again", () => {
    render(<Shell />);

    fireEvent.click(heading("Delivery"));
    expect(heading("Delivery").getAttribute("aria-expanded")).toBe("true");
    expect(link("Cohorts")).toBeTruthy();
    expect(link("Enrolments")).toBeTruthy();
    // Other groups, and the ungrouped Overview link, are untouched.
    expect(link("Overview")).toBeTruthy();
    expect(link("Users")).toBeNull();

    fireEvent.click(heading("Delivery"));
    expect(heading("Delivery").getAttribute("aria-expanded")).toBe("false");
    expect(link("Cohorts")).toBeNull();
  });

  it("the heading names the links it controls", () => {
    render(<Shell />);
    const controlled = document.getElementById(heading("Delivery").getAttribute("aria-controls") as string);
    expect(within(controlled as HTMLElement).getAllByRole("link", { hidden: true }).map((a) => a.textContent)).toEqual(["Cohorts", "Enrolments"]);
  });

  it("keeps the group holding the current page open, and will not fold it", () => {
    render(<Shell />);

    const catalogue = heading("Catalogue");
    expect(catalogue.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(catalogue);

    expect(catalogue.getAttribute("aria-expanded")).toBe("true");
    expect(link("Courses")).toBeTruthy();
    expect(window.localStorage.getItem("kq.staffNav.collapsedGroups")).toBeNull();
  });

  it("remembers the user's choice for the next visit, and it wins over the default", () => {
    const first = render(<Shell />);
    fireEvent.click(heading("Delivery"));
    expect(window.localStorage.getItem("kq.staffNav.collapsedGroups")).toBe("Catalogue|Administration");
    first.unmount();

    render(<Shell />);
    expect(heading("Delivery").getAttribute("aria-expanded")).toBe("true");
    expect(heading("Administration").getAttribute("aria-expanded")).toBe("false");
    expect(link("Cohorts")).toBeTruthy();
  });

  it("opening every group is a saved choice too, not a return to the default", () => {
    window.localStorage.setItem("kq.staffNav.collapsedGroups", "");
    render(<Shell />);

    for (const group of ["Delivery", "Catalogue", "Administration"]) {
      expect(heading(group).getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("a folded group opens by itself when you are on one of its pages", () => {
    window.localStorage.setItem("kq.staffNav.collapsedGroups", "Delivery");
    route.pathname = "/staff/cohorts";
    render(<Shell />);

    expect(heading("Delivery").getAttribute("aria-expanded")).toBe("true");
    expect(link("Cohorts")?.getAttribute("aria-current")).toBe("page");
  });

  it("unfolding everything in another tab is picked up here", () => {
    window.localStorage.setItem("kq.staffNav.collapsedGroups", "Delivery");
    render(<Shell />);
    expect(link("Cohorts")).toBeNull();

    window.localStorage.setItem("kq.staffNav.collapsedGroups", "");
    fireEvent(window, new StorageEvent("storage", { key: "kq.staffNav.collapsedGroups" }));
    expect(link("Cohorts")).toBeTruthy();
  });

  it("still folds when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    render(<Shell />);

    // Whatever an earlier page view left behind, one click flips the group and a second flips it back.
    const before = heading("Delivery").getAttribute("aria-expanded");
    fireEvent.click(heading("Delivery"));
    expect(heading("Delivery").getAttribute("aria-expanded")).toBe(before === "true" ? "false" : "true");
    fireEvent.click(heading("Delivery"));
    expect(heading("Delivery").getAttribute("aria-expanded")).toBe(before);
    vi.restoreAllMocks();
  });
});
