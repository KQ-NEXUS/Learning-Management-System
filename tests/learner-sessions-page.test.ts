import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `/learn/[enrolmentId]/sessions` (`src/app/(learner)/learn/[enrolmentId]/sessions/page.tsx`,
 * 09-10 Task 2).
 *
 * Graded like `tests/learner-dashboard-page.test.ts`: the page is a Server
 * Component invoked directly, its returned element rendered to a markup
 * string with `react-dom/server`'s `renderToStaticMarkup` so assertions can
 * inspect real rendered HTML — in particular, that the fixture meeting URL
 * never appears anywhere in the pre-window case's full output (a substring
 * check, not a DOM query, per DD-24 / T-09-04).
 */

const NEXT_REDIRECT = "NEXT_REDIRECT";
const NEXT_NOT_FOUND = "NEXT_NOT_FOUND";
const MEETING_URL = "https://meet.example.com/room/abc-123-secret";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getCurrentActor: vi.fn(),
    listOwnCohortSessions: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`${"NEXT_REDIRECT"}:${url}`);
    }),
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
  },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/services/learner-session-service", () => ({
  listOwnCohortSessions: mocks.listOwnCohortSessions,
}));

import Page from "@/app/(learner)/learn/[enrolmentId]/sessions/page";

type Over = Record<string, unknown>;

const ACTOR = { userId: "user-a", roles: [] };

function session(over: Over = {}) {
  return {
    id: "session-1",
    title: "Kickoff call",
    startsAt: new Date("2026-09-20T10:00:00.000Z"),
    endsAt: new Date("2026-09-20T12:00:00.000Z"),
    location: null,
    cancelledAt: null,
    cancellationReason: null,
    mode: "virtual",
    attendance: "NOT_RECORDED",
    ...over,
  };
}

const run = (enrolmentId = "enrolment-1") =>
  Page({ params: Promise.resolve({ enrolmentId }) } as never);
const renderPage = async (enrolmentId = "enrolment-1") =>
  renderToStaticMarkup((await run(enrolmentId)) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`${NEXT_REDIRECT}:${url}`);
  });
  mocks.notFound.mockImplementation(() => {
    throw new Error(NEXT_NOT_FOUND);
  });
  mocks.getCurrentActor.mockResolvedValue(ACTOR);
  mocks.listOwnCohortSessions.mockResolvedValue({
    timezone: "Africa/Lagos",
    upcoming: [],
    past: [],
  });
});

describe("/learn/[enrolmentId]/sessions", () => {
  it("redirects a signed-out visitor to sign-in instead of rendering", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    await expect(run()).rejects.toThrow(`${NEXT_REDIRECT}:/signin`);
    expect(mocks.listOwnCohortSessions).not.toHaveBeenCalled();
  });

  it("renders notFound when listOwnCohortSessions returns null (denial parity)", async () => {
    mocks.listOwnCohortSessions.mockResolvedValue(null);

    await expect(run()).rejects.toThrow(NEXT_NOT_FOUND);
  });

  it("renders the empty-state copy when there are no sessions at all", async () => {
    const html = await renderPage();
    expect(html).toContain("No sessions are scheduled yet");
  });

  it('a pre-window virtual session shows the "opens N minutes before" copy and never leaks the meeting URL', async () => {
    mocks.listOwnCohortSessions.mockResolvedValue({
      timezone: "Africa/Lagos",
      upcoming: [
        session({
          startsAt: new Date("2026-09-20T10:00:00.000Z"),
          endsAt: new Date("2026-09-20T12:00:00.000Z"),
          meetingUrlAvailableFrom: new Date("2026-09-20T09:00:00.000Z"),
        }),
      ],
      past: [],
    });

    const html = await renderPage();

    expect(html).toContain("The meeting link opens 60 minutes before this session starts");
    expect(html).not.toContain(MEETING_URL);
    expect(html).not.toContain("meetingUrl");
  });

  it('the in-window session renders a "Join session" anchor whose href is the meeting URL', async () => {
    mocks.listOwnCohortSessions.mockResolvedValue({
      timezone: "Africa/Lagos",
      upcoming: [session({ meetingUrl: MEETING_URL })],
      past: [],
    });

    const html = await renderPage();

    expect(html).toMatch(new RegExp(`<a href="${MEETING_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>Join session</a>`));
  });

  it("a cancelled session renders the Cancelled pill and a struck-through title", async () => {
    mocks.listOwnCohortSessions.mockResolvedValue({
      timezone: "Africa/Lagos",
      upcoming: [
        session({
          title: "Rescheduled workshop",
          cancelledAt: new Date("2026-09-19T00:00:00.000Z"),
          cancellationReason: "Facilitator unavailable",
        }),
      ],
      past: [],
    });

    const html = await renderPage();

    expect(html).toContain("Cancelled");
    expect(html).toContain("Facilitator unavailable");
    expect(html).toMatch(/line-through[^"]*"[^>]*>Rescheduled workshop/);
  });

  it("a past session renders the correct attendance pill label", async () => {
    mocks.listOwnCohortSessions.mockResolvedValue({
      timezone: "Africa/Lagos",
      upcoming: [],
      past: [session({ attendance: "LATE", mode: "unknown" })],
    });

    const html = await renderPage();

    expect(html).toContain("Late");
  });

  it("groups sessions under Upcoming and Past headings", async () => {
    mocks.listOwnCohortSessions.mockResolvedValue({
      timezone: "Africa/Lagos",
      upcoming: [session({ id: "up-1", mode: "unknown" })],
      past: [session({ id: "past-1", mode: "unknown", attendance: "PRESENT" })],
    });

    const html = await renderPage();

    expect(html).toContain("Upcoming");
    expect(html).toContain("Past");
    expect(html).toContain("Attended");
  });
});
