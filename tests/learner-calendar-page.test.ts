/**
 * `/learn/calendar` — one calendar of the learner's sessions across everything
 * they are enrolled on (owner idea, 2026-10-04). The page is a Server Component
 * invoked directly; the calendar itself is covered in
 * `tests/components/session-calendar.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getCurrentActor: vi.fn(),
    listOwnActiveEnrolments: vi.fn(),
    listOwnCohortSessions: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
  },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/services/learner-access", () => ({ listOwnActiveEnrolments: mocks.listOwnActiveEnrolments }));
vi.mock("@/server/services/learner-session-service", () => ({ listOwnCohortSessions: mocks.listOwnCohortSessions }));
vi.mock("@/components/shell/LearnerPageHeader", () => ({ LearnerPageHeader: () => null }));
vi.mock("@/components/calendar/SessionCalendar", () => ({ SessionCalendar: () => null }));

import Page from "@/app/(learner)/learn/calendar/page";
import { SessionCalendar } from "@/components/calendar/SessionCalendar";

const ACTOR = { userId: "learner-1", roles: [] };

type AnyElement = { type?: unknown; props?: { children?: unknown } & Record<string, unknown> };

function findCalendar(node: unknown): AnyElement | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findCalendar(child);
      if (hit) return hit;
    }
    return null;
  }
  const element = node as AnyElement;
  if (element.type === SessionCalendar) return element;
  return findCalendar(element.props?.children);
}

const enrolment = (id: string, title: string, timezone = "Africa/Lagos") => ({ id, cohort: { title, timezone } });

const view = (over: Record<string, unknown>) => ({
  id: "s1",
  title: "Site walk-through",
  startsAt: new Date("2026-10-05T08:00:00.000Z"),
  endsAt: new Date("2026-10-05T11:00:00.000Z"),
  location: "Ikeja",
  cancelledAt: null,
  cancellationReason: null,
  mode: "in-person",
  attendance: "NOT_RECORDED",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentActor.mockResolvedValue(ACTOR);
});

describe("/learn/calendar", () => {
  it("sends a signed-out visitor to sign in without reading anything", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(mocks.listOwnActiveEnrolments).not.toHaveBeenCalled();
  });

  it("gathers upcoming and past sessions from every one of the learner's own enrolments", async () => {
    mocks.listOwnActiveEnrolments.mockResolvedValue([enrolment("enr-a", "Safety Leadership"), enrolment("enr-b", "Fire Marshal")]);
    mocks.listOwnCohortSessions.mockImplementation(async (_actor: unknown, enrolmentId: string) =>
      enrolmentId === "enr-a"
        ? { timezone: "Africa/Lagos", upcoming: [view({ id: "s1" })], past: [view({ id: "s0", title: "Induction" })] }
        : { timezone: "Africa/Lagos", upcoming: [view({ id: "s9", title: "Live session", mode: "virtual", location: null })], past: [] },
    );

    const calendar = findCalendar(await Page());
    const sessions = calendar!.props!.sessions as Array<Record<string, unknown>>;

    expect(mocks.listOwnCohortSessions).toHaveBeenCalledWith(ACTOR, "enr-a");
    expect(mocks.listOwnCohortSessions).toHaveBeenCalledWith(ACTOR, "enr-b");
    expect(sessions.map((s) => [s.id, s.title, s.meta, s.href])).toEqual([
      ["enr-a:s1", "Site walk-through", "Safety Leadership · Ikeja", "/learn/enr-a/sessions"],
      ["enr-a:s0", "Induction", "Safety Leadership · Ikeja", "/learn/enr-a/sessions"],
      ["enr-b:s9", "Live session", "Fire Marshal · Virtual", "/learn/enr-b/sessions"],
    ]);
    expect(sessions[0]).toMatchObject({ startsAt: "2026-10-05T08:00:00.000Z", timezone: "Africa/Lagos", cancelled: false });
    // Read-only for a learner: no handlers are passed, so days are not controls.
    expect(calendar!.props).not.toHaveProperty("onDayClick");
    expect(calendar!.props).not.toHaveProperty("onItemClick");
  });

  it("never hands the meeting link to the calendar, even when the sessions page may show it", async () => {
    mocks.listOwnActiveEnrolments.mockResolvedValue([enrolment("enr-a", "Safety Leadership")]);
    mocks.listOwnCohortSessions.mockResolvedValue({
      timezone: "Africa/Lagos",
      upcoming: [view({ meetingUrl: "https://meet.example/secret-room", mode: "virtual" })],
      past: [],
    });

    const calendar = findCalendar(await Page());
    expect(JSON.stringify(calendar!.props!.sessions)).not.toContain("secret-room");
  });

  it("marks a cancelled session, and skips an enrolment whose sessions cannot be read", async () => {
    mocks.listOwnActiveEnrolments.mockResolvedValue([enrolment("enr-a", "Safety Leadership"), enrolment("enr-gone", "Withdrawn")]);
    mocks.listOwnCohortSessions.mockImplementation(async (_actor: unknown, enrolmentId: string) =>
      enrolmentId === "enr-a"
        ? { timezone: "Africa/Lagos", upcoming: [view({ cancelledAt: new Date("2026-10-01T00:00:00.000Z") })], past: [] }
        : null,
    );

    const sessions = findCalendar(await Page())!.props!.sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].cancelled).toBe(true);
  });

  it("shows no calendar to someone enrolled on nothing", async () => {
    mocks.listOwnActiveEnrolments.mockResolvedValue([]);
    expect(findCalendar(await Page())).toBeNull();
    expect(mocks.listOwnCohortSessions).not.toHaveBeenCalled();
  });
});
