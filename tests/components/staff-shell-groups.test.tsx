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
  it("starts with every group open, each heading a button that says so", () => {
    render(<Shell />);

    for (const group of ["Delivery", "Catalogue", "Administration"]) {
      expect(heading(group).getAttribute("aria-expanded")).toBe("true");
    }
    for (const name of ["Overview", "Cohorts", "Enrolments", "Courses", "Programmes", "Users"]) {
      expect(link(name)).toBeTruthy();
    }
  });

  it("folds a group to its heading and opens it again", () => {
    render(<Shell />);

    fireEvent.click(heading("Delivery"));
    expect(heading("Delivery").getAttribute("aria-expanded")).toBe("false");
    expect(link("Cohorts")).toBeNull();
    expect(link("Enrolments")).toBeNull();
    // Other groups, and the ungrouped Overview link, are untouched.
    expect(link("Overview")).toBeTruthy();
    expect(link("Users")).toBeTruthy();

    fireEvent.click(heading("Delivery"));
    expect(heading("Delivery").getAttribute("aria-expanded")).toBe("true");
    expect(link("Cohorts")).toBeTruthy();
  });

  it("the heading names the links it controls", () => {
    render(<Shell />);
    const controlled = document.getElementById(heading("Delivery").getAttribute("aria-controls") as string);
    expect(within(controlled as HTMLElement).getAllByRole("link").map((a) => a.textContent)).toEqual(["Cohorts", "Enrolments"]);
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

  it("remembers folded groups for the next visit", () => {
    const first = render(<Shell />);
    fireEvent.click(heading("Delivery"));
    fireEvent.click(heading("Administration"));
    expect(window.localStorage.getItem("kq.staffNav.collapsedGroups")).toBe("Delivery|Administration");
    first.unmount();

    render(<Shell />);
    expect(heading("Delivery").getAttribute("aria-expanded")).toBe("false");
    expect(heading("Administration").getAttribute("aria-expanded")).toBe("false");
    expect(link("Cohorts")).toBeNull();
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
