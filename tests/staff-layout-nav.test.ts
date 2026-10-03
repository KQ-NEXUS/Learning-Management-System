import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
    canAnywhere: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    getStatusSnapshot: vi.fn(),
    isUsingTemporaryPassword: vi.fn(async () => false),
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: unknown }) => createElement("a", { href }, children as never),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/permissions", () => ({ can: mocks.can, canAnywhere: mocks.canAnywhere }));
vi.mock("@/app/(auth)/signin/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/server/services/profile-service", () => ({
  profileService: {
    getOwnProfile: async () => ({ name: "Ada Admin", email: "ada@example.test" }),
    isUsingTemporaryPassword: mocks.isUsingTemporaryPassword,
  },
}));
// The layout now also fetches the header's unread count (D-18/D-22); a fixed
// value here keeps this file's navigation assertions unaffected by Plan 06.
vi.mock("@/server/services/notification-service", () => ({
  notificationService: { unreadCount: async () => 3 },
}));
// NotificationBell's own import chain reaches NotificationDrawer -> the
// notifications server actions -> notification-access-service.ts, which
// reuses live staff destination-page services (tickets/payments/submissions)
// that need a much wider set of mocks than this nav-focused test cares
// about. Mocking the bell itself (same treatment as StaffShell below) keeps
// this file's scope to what it actually asserts: which nav items render.
vi.mock("@/components/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/app/staff/StaffShell", () => ({ StaffShell: () => null }));
// The layout reads the licence status for the banner and the restriction mirror (14-19).
vi.mock("@/server/services/licence-service", () => ({
  licenceService: { getStatusSnapshot: mocks.getStatusSnapshot },
}));

import StaffLayout from "@/app/staff/layout";

type NavItem = { label: string; href: string; group?: string };

type LicenceRestrictionProp = { restricted: boolean; canViewLicence: boolean; stateLabel: string | null };
type BannerElement = { props: { tone: string; stateLabel: string; message: string; linkLabel: string; href: string } };

async function layoutElement() {
  return (await StaffLayout({ children: null })) as {
    props: {
      nav: NavItem[];
      bell: unknown;
      banner: BannerElement | null;
      licenceRestriction: LicenceRestrictionProp | undefined;
    };
  };
}

/** A minimal status snapshot; only the fields the layout reads need real values. */
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    state: "ACTIVE",
    reasonCode: null,
    isRestricted: false,
    daysRemaining: 200,
    expiresAt: new Date("2027-04-01T22:59:59Z"),
    graceEndsAt: new Date("2027-04-15T22:59:59Z"),
    timeZone: "Africa/Lagos",
    support: { renewalEmail: "renewals@provider.test", supportEmail: "support@provider.test", phone: null, hours: null },
    ...overrides,
  };
}

async function visibleNav(): Promise<NavItem[]> {
  const element = await layoutElement();
  return element.props.nav;
}

/** The layout asks `can(permission, {})`; grant everything except the listed permissions. */
function grantAllExcept(...denied: string[]) {
  mocks.can.mockImplementation(async (permission: string) => !denied.includes(permission));
  mocks.canAnywhere.mockImplementation(async (permission: string) => !denied.includes(permission));
}

describe("staff layout navigation", () => {
  beforeEach(() => {
    mocks.getCurrentActor.mockReset().mockResolvedValue({ userId: "staff-1", isStaff: true, roles: [] });
    mocks.can.mockReset();
    mocks.canAnywhere.mockReset().mockResolvedValue(false);
    mocks.redirect.mockClear();
    mocks.getStatusSnapshot.mockReset().mockResolvedValue(snapshot());
  });

  it("integration warning #1 — a cohort-scoped instructor sees Cohorts, Enrolments and Payments, not global-only sections", async () => {
    // Holds these at COHORT scope only: `can(p, {})` (GLOBAL) is false, `canAnywhere(p)` is true.
    const scoped = ["cohorts.view", "enrolments.view", "payments.view", "courses.view", "users.view"];
    mocks.can.mockResolvedValue(false);
    mocks.canAnywhere.mockImplementation(async (permission: string) => scoped.includes(permission));
    const hrefs = (await visibleNav()).map((item) => item.href);

    expect(hrefs).toEqual(expect.arrayContaining(["/staff", "/staff/cohorts", "/staff/enrolments", "/staff/payments"]));
    // Their pages still need a GLOBAL grant, so no link that would land on "not found".
    expect(hrefs).not.toContain("/staff/courses");
    expect(hrefs).not.toContain("/staff/users");
    expect(hrefs).not.toContain("/staff/reconciliation");
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

  it("passes a bell prop to StaffShell", async () => {
    grantAllExcept();
    const element = await layoutElement();
    expect(element.props.bell).toBeTruthy();
  });

  it("shows Email log under Administration, after Audit, to staff holding audit.view", async () => {
    grantAllExcept();
    const nav = await visibleNav();

    const auditIndex = nav.findIndex((item) => item.href === "/staff/audit");
    const emailLogIndex = nav.findIndex((item) => item.href === "/staff/email-log");
    expect(nav[emailLogIndex]).toMatchObject({ label: "Email log", group: "Administration" });
    expect(emailLogIndex).toBeGreaterThan(auditIndex);
  });

  it("hides Email log from someone without audit.view", async () => {
    grantAllExcept("audit.view");
    const hrefs = (await visibleNav()).map((item) => item.href);

    expect(hrefs).not.toContain("/staff/email-log");
    expect(hrefs).not.toContain("/staff/audit");
  });

  it("shows Licence under Administration, after Email log, to staff holding licence.view (14-10)", async () => {
    grantAllExcept();
    const nav = await visibleNav();

    const emailLogIndex = nav.findIndex((item) => item.href === "/staff/email-log");
    const licenceIndex = nav.findIndex((item) => item.href === "/staff/licence");
    expect(nav[licenceIndex]).toMatchObject({ label: "Licence", href: "/staff/licence", group: "Administration" });
    expect(licenceIndex).toBeGreaterThan(emailLogIndex);
  });

  it("hides Licence from someone without licence.view and keeps the other Administration items (14-10)", async () => {
    grantAllExcept("licence.view");
    const hrefs = (await visibleNav()).map((item) => item.href);

    expect(hrefs).not.toContain("/staff/licence");
    expect(hrefs).toEqual(expect.arrayContaining(["/staff/users", "/staff/audit", "/staff/email-log"]));
  });

  it("checks Licence with the global can check, never the scope-aware canAnywhere (licence.view is Global only)", async () => {
    // Held at a narrower scope only: `can(p, {})` (Global) is false, `canAnywhere(p)` is true.
    mocks.can.mockResolvedValue(false);
    mocks.canAnywhere.mockImplementation(async (permission: string) => permission === "licence.view");
    const hrefs = (await visibleNav()).map((item) => item.href);

    expect(hrefs).not.toContain("/staff/licence");
    expect(mocks.can).toHaveBeenCalledWith("licence.view", {});
    expect(mocks.canAnywhere).not.toHaveBeenCalledWith("licence.view");
  });
});

describe("staff layout temporary-password suggestion (R3-12)", () => {
  beforeEach(() => {
    mocks.getCurrentActor.mockReset().mockResolvedValue({ userId: "staff-1", isStaff: true, roles: [] });
    mocks.can.mockReset();
    mocks.canAnywhere.mockReset().mockResolvedValue(false);
    mocks.getStatusSnapshot.mockReset().mockResolvedValue(snapshot());
    mocks.isUsingTemporaryPassword.mockReset().mockResolvedValue(false);
    grantAllExcept();
  });

  const bannerHtml = async () => {
    const element = await layoutElement();
    return element.props.banner ? renderToStaticMarkup(element.props.banner as never) : "";
  };

  it("shows nothing for someone who has chosen their own password", async () => {
    expect((await layoutElement()).props.banner).toBeNull();
  });

  it("suggests a change, with a link to the reset flow, while the temporary password is still in use", async () => {
    mocks.isUsingTemporaryPassword.mockResolvedValue(true);
    const html = await bannerHtml();
    expect(html).toContain("We recommend choosing your own.");
    expect(html).toContain('href="/forgot-password"');
    expect(mocks.isUsingTemporaryPassword).toHaveBeenCalledWith(expect.objectContaining({ userId: "staff-1" }));
  });

  it("is a suggestion only: the layout still renders the page and never redirects", async () => {
    mocks.isUsingTemporaryPassword.mockResolvedValue(true);
    const element = await layoutElement();
    expect(element.props.nav.length).toBeGreaterThan(0);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("appears beneath the licence banner when both apply", async () => {
    mocks.isUsingTemporaryPassword.mockResolvedValue(true);
    mocks.getStatusSnapshot.mockResolvedValue(snapshot({ state: "RESTRICTED_CONTINUITY", isRestricted: true, daysRemaining: null }));
    const html = await bannerHtml();
    expect(html.indexOf("Restricted continuity mode")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Temporary password")).toBeGreaterThan(html.indexOf("Restricted continuity mode"));
  });

  it("a failed read shows nothing rather than breaking the shell", async () => {
    mocks.isUsingTemporaryPassword.mockRejectedValue(new Error("database down"));
    expect((await layoutElement()).props.banner).toBeNull();
  });
});

describe("staff layout licence banner and restriction mirror (14-19, D-15, D-09)", () => {
  beforeEach(() => {
    mocks.isUsingTemporaryPassword.mockReset().mockResolvedValue(false);
    mocks.getCurrentActor.mockReset().mockResolvedValue({ userId: "staff-1", isStaff: true, roles: [] });
    mocks.can.mockReset();
    mocks.canAnywhere.mockReset().mockResolvedValue(false);
    mocks.getStatusSnapshot.mockReset();
  });

  it("passes a danger banner and the restriction context to an administrator in restricted continuity mode", async () => {
    grantAllExcept();
    mocks.getStatusSnapshot.mockResolvedValue(snapshot({ state: "RESTRICTED_CONTINUITY", isRestricted: true, daysRemaining: null }));
    const element = await layoutElement();

    expect(element.props.banner).toBeTruthy();
    expect(element.props.banner!.props).toMatchObject({
      tone: "danger",
      stateLabel: "Restricted continuity mode",
      href: "/staff/licence",
    });
    expect(element.props.licenceRestriction).toEqual({
      restricted: true,
      canViewLicence: true,
      stateLabel: "Restricted continuity mode",
    });
  });

  it("passes no banner and no licence detail to staff without licence.view, but still mirrors the restriction", async () => {
    grantAllExcept("licence.view");
    mocks.getStatusSnapshot.mockResolvedValue(snapshot({ state: "RESTRICTED_CONTINUITY", isRestricted: true, daysRemaining: null }));
    const element = await layoutElement();

    expect(element.props.banner).toBeNull();
    expect(element.props.licenceRestriction).toEqual({ restricted: true, canViewLicence: false, stateLabel: null });
  });

  it("renders no banner and an unrestricted context for an active licence", async () => {
    grantAllExcept();
    mocks.getStatusSnapshot.mockResolvedValue(snapshot());
    const element = await layoutElement();

    expect(element.props.banner).toBeNull();
    expect(element.props.licenceRestriction).toMatchObject({ restricted: false, canViewLicence: true });
  });

  it("renders no banner when the licence is not activated (OQ1 option-a)", async () => {
    grantAllExcept();
    mocks.getStatusSnapshot.mockResolvedValue(
      snapshot({ state: "UNLICENSED", daysRemaining: null, expiresAt: null, graceEndsAt: null, timeZone: null, support: null }),
    );
    const element = await layoutElement();

    expect(element.props.banner).toBeNull();
    expect(element.props.licenceRestriction).toMatchObject({ restricted: false });
  });

  it.each([
    ["EXPIRING_SOON", { daysRemaining: 12 }, "warning"],
    ["GRACE", { daysRemaining: null }, "warning"],
    ["INVALID", { isRestricted: true, reasonCode: "BAD_SIGNATURE", daysRemaining: null }, "danger"],
    ["VALIDATION_ATTENTION", { daysRemaining: null }, "warning"],
  ])("renders the %s banner for an administrator", async (state, extra, tone) => {
    grantAllExcept();
    mocks.getStatusSnapshot.mockResolvedValue(snapshot({ state, ...extra }));
    const element = await layoutElement();

    expect(element.props.banner?.props.tone).toBe(tone);
  });

  it("renders no banner for expiring soon beyond 30 days", async () => {
    grantAllExcept();
    mocks.getStatusSnapshot.mockResolvedValue(snapshot({ state: "EXPIRING_SOON", daysRemaining: 45 }));
    const element = await layoutElement();

    expect(element.props.banner).toBeNull();
  });

  it("labels the banner link 'Activate a licence' only when the viewer holds licence.activate", async () => {
    mocks.getStatusSnapshot.mockResolvedValue(snapshot({ state: "RESTRICTED_CONTINUITY", isRestricted: true, daysRemaining: null }));

    grantAllExcept();
    expect((await layoutElement()).props.banner?.props.linkLabel).toBe("Activate a licence");

    grantAllExcept("licence.activate");
    expect((await layoutElement()).props.banner?.props.linkLabel).toBe("View licence");
  });

  it("keeps the shell, with no banner and an unrestricted context, when the licence status read fails", async () => {
    grantAllExcept();
    mocks.getStatusSnapshot.mockRejectedValue(new Error("database unavailable"));
    const element = await layoutElement();

    expect(element.props.banner).toBeNull();
    expect(element.props.licenceRestriction).toBeUndefined();
    expect(element.props.nav.map((item) => item.href)).toContain("/staff");
    expect(element.props.bell).toBeTruthy();
  });
});
