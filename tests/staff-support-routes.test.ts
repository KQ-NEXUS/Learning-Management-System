import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, MockAuthorizationError, MockAuthenticationError } = vi.hoisted(() => {
  class MockAuthorizationError extends Error {}
  class MockAuthenticationError extends Error {}
  return { MockAuthorizationError, MockAuthenticationError, mocks: {
    getCurrentActor: vi.fn(),
    can: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    getStaffQueue: vi.fn(),
    listTicketAssignees: vi.fn(),
  } };
});


vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/permissions", () => ({
  can: mocks.can,
  AuthorizationError: MockAuthorizationError,
  AuthenticationError: MockAuthenticationError,
  withPermission: () => (handler: unknown) => handler,
}));
vi.mock("@/app/(auth)/signin/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/server/services/profile-service", () => ({
  profileService: { getOwnProfile: async () => ({ name: "Sam Agent", email: "sam@example.test" }) },
}));
vi.mock("@/app/staff/StaffShell", () => ({ StaffShell: () => null }));
vi.mock("@/server/services/ticket-staff-queue-service", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/ticket-staff-queue-service")>(
    "@/server/services/ticket-staff-queue-service",
  );
  return { ...actual, getStaffQueue: mocks.getStaffQueue, listTicketAssignees: mocks.listTicketAssignees };
});
vi.mock("@/server/db", () => ({ prisma: {} }));

import StaffLayout from "@/app/staff/layout";
import StaffSupportPage from "@/app/staff/support/page";
import {
  buildQueueView,
  compareQueueRows,
  parseQueueParams,
  type QueueParams,
  type QueueRow,
} from "@/server/services/ticket-staff-queue-service";

type NavItem = { label: string; href: string; group?: string };

async function visibleNav(): Promise<NavItem[]> {
  const element = (await StaffLayout({ children: null })) as { props: { nav: NavItem[] } };
  return element.props.nav;
}

const NOW = new Date("2026-09-25T12:00:00.000Z");
function row(overrides: Partial<QueueRow>): QueueRow {
  return {
    id: overrides.reference ?? "id",
    reference: "TKT-1",
    subject: "Cannot log in",
    learnerName: "Ada Learner",
    learnerEmail: "ada@example.test",
    category: "ACCOUNT_ACCESS",
    priority: "NORMAL",
    status: "OPEN",
    queue: "GENERAL_SUPPORT",
    assigneeId: null,
    assigneeName: null,
    updatedAt: new Date("2026-09-24T12:00:00.000Z"),
    resolvedAt: null,
    ...overrides,
  };
}
const DEFAULTS: QueueParams = parseQueueParams({});

describe("staff support navigation", () => {
  beforeEach(() => {
    mocks.getCurrentActor.mockReset().mockResolvedValue({ userId: "staff-1", isStaff: true, roles: [] });
    mocks.can.mockReset();
  });

  it("shows Operations > Support only to tickets.view holders", async () => {
    mocks.can.mockImplementation(async () => true);
    expect((await visibleNav()).find((item) => item.href === "/staff/support")).toMatchObject({ label: "Support", group: "Operations" });

    mocks.can.mockImplementation(async (permission: string) => permission !== "tickets.view");
    expect((await visibleNav()).map((item) => item.href)).not.toContain("/staff/support");
  });
});

describe("staff support page", () => {
  beforeEach(() => {
    mocks.getStaffQueue.mockReset();
    mocks.listTicketAssignees.mockReset();
  });

  it("renders the denied state, not data, when tickets.view is missing", async () => {
    mocks.getStaffQueue.mockRejectedValue(new MockAuthorizationError("no"));
    mocks.listTicketAssignees.mockRejectedValue(new MockAuthorizationError("no"));
    const element = (await StaffSupportPage({ searchParams: Promise.resolve({}) })) as { props: Record<string, unknown> };
    expect(element.props.denied).toBe(true);
    expect(element.props.view).toBeUndefined();
  });

  it("normalizes unknown tab/filter values before calling the service", async () => {
    mocks.getStaffQueue.mockResolvedValue({ params: DEFAULTS });
    mocks.listTicketAssignees.mockResolvedValue([]);
    await StaffSupportPage({ searchParams: Promise.resolve({ tab: "bogus", priority: "nope", page: "-3", queue: "X" }) });
    expect(mocks.getStaffQueue).toHaveBeenCalledWith(DEFAULTS);
  });

  it("maps a load failure to a distinct error state", async () => {
    mocks.getStaffQueue.mockRejectedValue(new Error("db down"));
    mocks.listTicketAssignees.mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const element = (await StaffSupportPage({ searchParams: Promise.resolve({}) })) as { props: Record<string, unknown> };
    expect(element.props.error).toBe(true);
  });
});

describe("queue params and view", () => {
  it("defaults to My work and round-trips recognized values", () => {
    expect(DEFAULTS).toMatchObject({ tab: "my-work", q: "", category: "", priority: "", queue: "", owner: "", page: 1 });
    expect(parseQueueParams({ tab: "escalated", priority: "urgent", queue: "FINANCE", category: "OTHER", owner: "me", page: "2", q: " refund " })).toEqual({
      tab: "escalated", priority: "URGENT", queue: "FINANCE", category: "OTHER", owner: "me", page: 2, q: "refund",
    });
  });

  it("orders urgent, high, normal, low, then oldest activity, then reference", () => {
    const rows = [
      row({ reference: "B", priority: "LOW" }),
      row({ reference: "D", priority: "NORMAL", updatedAt: new Date("2026-09-24T10:00:00.000Z") }),
      row({ reference: "A", priority: "URGENT" }),
      row({ reference: "C", priority: "NORMAL", updatedAt: new Date("2026-09-24T10:00:00.000Z") }),
      row({ reference: "E", priority: "HIGH" }),
    ].sort(compareQueueRows);
    expect(rows.map((r) => r.reference)).toEqual(["A", "E", "C", "D", "B"]);
  });

  it("counts every tab and keeps My work to the actor's open tickets", () => {
    const rows = [
      row({ reference: "M", assigneeId: "staff-1", status: "ASSIGNED" }),
      row({ reference: "U" }),
      row({ reference: "E", status: "ESCALATED", assigneeId: "staff-2" }),
      row({ reference: "R", status: "RESOLVED", resolvedAt: new Date("2026-09-24T00:00:00.000Z") }),
      row({ reference: "OLD", status: "RESOLVED", resolvedAt: new Date("2026-08-01T00:00:00.000Z") }),
      row({ reference: "C", status: "CLOSED" }),
    ];
    const view = buildQueueView(rows, DEFAULTS, "staff-1", NOW);
    expect(view.tabCounts).toEqual({ "my-work": 1, unassigned: 1, open: 3, escalated: 1, resolved: 1 });
    expect(view.health).toEqual({ open: 3, unassigned: 1, urgent: 0, escalated: 1 });
    expect(view.rows.map((r) => r.reference)).toEqual(["M"]);
  });

  it("filters by search and paginates at 20", () => {
    const rows = Array.from({ length: 45 }, (_, i) => row({ reference: `T${String(i).padStart(2, "0")}`, assigneeId: "staff-1", subject: i === 3 ? "Refund missing" : "Other" }));
    const all = buildQueueView(rows, { ...DEFAULTS, page: 3 }, "staff-1", NOW);
    expect(all.pageCount).toBe(3);
    expect(all.rows).toHaveLength(5);
    const searched = buildQueueView(rows, { ...DEFAULTS, q: "refund" }, "staff-1", NOW);
    expect(searched.rows.map((r) => r.reference)).toEqual(["T03"]);
  });
});
