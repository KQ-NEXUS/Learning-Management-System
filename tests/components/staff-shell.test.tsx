import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StaffShell, type StaffNavItem } from "@/app/staff/StaffShell";
import { useLicenceRestriction } from "@/components/licence/LicenceRestrictionProvider";

/**
 * The IETC staff top bar (design/mockups/staff-overview.html): Overview plus one menu per
 * nav group, a phone Menu panel, and the bell, banner and licence-context slots.
 */

const route = vi.hoisted(() => ({ pathname: "/staff/courses" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

beforeEach(() => {
  route.pathname = "/staff/courses";
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const nav: StaffNavItem[] = [
  { label: "Overview", href: "/staff" },
  { label: "Cohorts", href: "/staff/cohorts", group: "Delivery" },
  { label: "Payments", href: "/staff/payments", group: "Delivery" },
  { label: "Courses", href: "/staff/courses", group: "Catalogue" },
  { label: "Programmes", href: "/staff/programmes", group: "Catalogue" },
  { label: "Users", href: "/staff/users", group: "Administration" },
];

function Shell() {
  return (
    <StaffShell nav={nav} identity={{ name: "Ada Admin", email: "admin@example.com" }} signOut={<button>Sign out</button>}>
      <button>Page action</button>
    </StaffShell>
  );
}

function topBar() {
  return screen.getAllByRole("navigation", { name: "Workspace" })[0];
}

describe("StaffShell top bar", () => {
  it("shows Overview and one button per group, with each group's links closed", () => {
    render(<Shell />);
    const bar = topBar();
    expect(within(bar).getByRole("link", { name: "Overview" })).toBeTruthy();
    for (const group of ["Delivery", "Catalogue", "Administration"]) {
      expect(within(bar).getByRole("button", { name: group }).getAttribute("aria-expanded")).toBe("false");
    }
    expect(within(bar).queryByRole("link", { name: "Cohorts" })).toBeNull();
  });

  it("marks the group that holds the current page", () => {
    render(<Shell />);
    expect(within(topBar()).getByRole("button", { name: "Catalogue" }).getAttribute("aria-current")).toBe("true");
    expect(within(topBar()).getByRole("button", { name: "Delivery" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens one group at a time and marks the current page inside it", () => {
    render(<Shell />);
    fireEvent.click(within(topBar()).getByRole("button", { name: "Catalogue" }));
    expect(within(topBar()).getByRole("link", { name: "Courses" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(topBar()).getByRole("button", { name: "Delivery" }));
    expect(within(topBar()).queryByRole("link", { name: "Courses" })).toBeNull();
    expect(within(topBar()).getByRole("link", { name: "Cohorts" })).toBeTruthy();
  });

  it("closes on Escape and puts focus back on the group's button", () => {
    render(<Shell />);
    const button = within(topBar()).getByRole("button", { name: "Delivery" });
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("closes when you press outside the bar", () => {
    render(<Shell />);
    const button = within(topBar()).getByRole("button", { name: "Delivery" });
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Page action" }));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when the page changes", () => {
    const { rerender } = render(<Shell />);
    fireEvent.click(within(topBar()).getByRole("button", { name: "Delivery" }));
    route.pathname = "/staff/cohorts";
    rerender(<Shell />);
    expect(within(topBar()).getByRole("button", { name: "Delivery" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows who is signed in by initials, with the full name for assistive technology", () => {
    render(<Shell />);
    expect(screen.getByText("AA")).toBeTruthy();
    expect(screen.getByText("Signed in as Ada Admin")).toBeTruthy();
  });
});

describe("StaffShell phone menu", () => {
  it("lists every link under its group, and Escape closes it back onto the Menu button", () => {
    render(<Shell />);
    const menu = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(menu);
    const panel = screen.getAllByRole("navigation", { name: "Workspace" })[1];
    expect(within(panel).getAllByRole("link").map((link) => link.textContent)).toEqual(nav.map((item) => item.label));
    expect(within(panel).getByText("Delivery")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getAllByRole("navigation", { name: "Workspace" })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Menu" }));
  });
});

describe("StaffShell bell slot", () => {
  it("renders no bell when the prop is omitted", () => {
    render(<Shell />);
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
  });

  it("renders the supplied bell in the top bar", () => {
    render(
      <StaffShell nav={nav} identity={null} signOut={<button>Sign out</button>} bell={<button aria-label="Notifications">Bell</button>}>
        <button>Page action</button>
      </StaffShell>,
    );
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });
});

describe("StaffShell licence banner slot and restriction context (14-19, D-15, D-09)", () => {
  it("renders the banner between the header and main, in that DOM order", () => {
    const { container } = render(
      <StaffShell nav={nav} identity={null} signOut={<button>Sign out</button>} banner={<div role="status" id="licence-restriction-notice">Banner</div>}>
        <button>Page action</button>
      </StaffShell>,
    );
    const column = screen.getByRole("main").parentElement!;
    const tags = Array.from(column.children).map((child) => child.tagName.toLowerCase());
    expect(tags.slice(tags.indexOf("header"), tags.indexOf("main") + 1)).toEqual(["header", "div", "main"]);
    expect(column.children[tags.indexOf("header") + 1]).toBe(container.querySelector("#licence-restriction-notice"));
  });

  it("renders nothing extra between the header and main when no banner is supplied", () => {
    render(<Shell />);
    const tags = Array.from(screen.getByRole("main").parentElement!.children).map((child) => child.tagName.toLowerCase());
    expect(tags.slice(tags.indexOf("header"), tags.indexOf("main") + 1)).toEqual(["header", "main"]);
  });

  it("provides the supplied restriction value to its children, and the unrestricted default otherwise", () => {
    function Probe() {
      return <output data-testid="restriction">{JSON.stringify(useLicenceRestriction())}</output>;
    }
    const { unmount } = render(
      <StaffShell
        nav={nav}
        identity={null}
        signOut={<button>Sign out</button>}
        licenceRestriction={{ restricted: true, canViewLicence: true, stateLabel: "Restricted continuity mode" }}
      >
        <Probe />
      </StaffShell>,
    );
    expect(JSON.parse(screen.getByTestId("restriction").textContent!)).toEqual({
      restricted: true,
      canViewLicence: true,
      stateLabel: "Restricted continuity mode",
    });
    unmount();

    render(
      <StaffShell nav={nav} identity={null} signOut={<button>Sign out</button>}>
        <Probe />
      </StaffShell>,
    );
    expect(JSON.parse(screen.getByTestId("restriction").textContent!)).toEqual({
      restricted: false,
      canViewLicence: false,
      stateLabel: null,
    });
  });
});
