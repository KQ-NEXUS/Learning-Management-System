import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The staff layout (`src/app/staff/layout.tsx`) decides which sidebar items a staff member sees.
 * Each section is shown only to someone holding its view permission, so the sidebar never offers a
 * link that lands on a denial. Finance (Reconciliation, Reports) sits in its own group.
 */

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getCurrentActor: vi.fn(),
    can: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
  },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/permissions", () => ({ can: mocks.can }));
vi.mock("@/app/(auth)/signin/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/server/services/profile-service", () => ({
  profileService: { getOwnProfile: async () => ({ name: "Ada Admin", email: "ada@example.test" }) },
}));
vi.mock("@/app/staff/StaffShell", () => ({ StaffShell: () => null }));

import StaffLayout from "@/app/staff/layout";

type NavItem = { label: string; href: string; group?: string };

async function visibleNav(): Promise<NavItem[]> {
  const element = (await StaffLayout({ children: null })) as { props: { nav: NavItem[] } };
  return element.props.nav;
}

/** The layout asks `can(permission, {})`; grant everything except the listed permissions. */
function grantAllExcept(...denied: string[]) {
  mocks.can.mockImplementation(async (permission: string) => !denied.includes(permission));
}

describe("staff layout navigation", () => {
  beforeEach(() => {
    mocks.getCurrentActor.mockReset().mockResolvedValue({ userId: "staff-1", isStaff: true, roles: [] });
    mocks.can.mockReset();
    mocks.redirect.mockClear();
  });

  it("shows Reconciliation and Reports in a Finance group to staff who hold both permissions", async () => {
    grantAllExcept();
    const nav = await visibleNav();

    expect(nav.find((item) => item.href === "/staff/reconciliation")).toMatchObject({ label: "Reconciliation", group: "Finance" });
    expect(nav.find((item) => item.href === "/staff/reports")).toMatchObject({ label: "Reports", group: "Finance" });
  });

  it("hides Reconciliation from someone without payments.view, and keeps Reports", async () => {
    grantAllExcept("payments.view");
    const hrefs = (await visibleNav()).map((item) => item.href);

    expect(hrefs).not.toContain("/staff/reconciliation");
    expect(hrefs).not.toContain("/staff/payments");
    expect(hrefs).toContain("/staff/reports");
  });

  it("hides Reports from someone without reports.view, and keeps Reconciliation", async () => {
    grantAllExcept("reports.view");
    const hrefs = (await visibleNav()).map((item) => item.href);

    expect(hrefs).not.toContain("/staff/reports");
    expect(hrefs).toContain("/staff/reconciliation");
  });

  it("always shows Overview, which needs no permission", async () => {
    mocks.can.mockResolvedValue(false);
    const nav = await visibleNav();

    expect(nav.map((item) => item.href)).toEqual(["/staff"]);
  });

  it("sends a signed-in learner to their landing path instead of rendering the shell", async () => {
    mocks.getCurrentActor.mockResolvedValue({ userId: "learner-1", isStaff: false, roles: [] });
    await expect(StaffLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });
});
