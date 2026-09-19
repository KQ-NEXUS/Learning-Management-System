import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `/dashboard` (`src/app/(learner)/dashboard/page.tsx`, 09-08 Task 3).
 *
 * Graded like `tests/lesson-preview-route.test.ts` / `arrange-page-route.test.ts`:
 * the page is a Server Component with no dynamic-route params, invoked
 * directly. Its returned element is then rendered to a markup string with
 * `react-dom/server`'s `renderToStaticMarkup` (no jsdom needed — this file
 * runs under Vitest's "node" project per `vitest.config.ts`) so the
 * assertions below can inspect actual rendered HTML: progressbar counts,
 * link hrefs, and the absence of a meeting-link/named-gap-as-link leak.
 *
 * `next/link` is mocked to a plain `<a>` (no client-router context exists in
 * this harness) rather than the `() => null` stub other route tests use,
 * because several assertions here need real `href`/text content.
 */

const NOT_FOUND_REDIRECT = "NEXT_REDIRECT";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getCurrentActor: vi.fn(),
    loadLearnerDashboard: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`${NOT_FOUND_REDIRECT}:${url}`);
    }),
  },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/services/enrolment-dashboard-service", () => ({
  loadLearnerDashboard: mocks.loadLearnerDashboard,
}));

import Page from "@/app/(learner)/dashboard/page";

type Over = Record<string, unknown>;

const ACTOR = { userId: "user-a", roles: [] };

function accessNotice(over: Over = {}) {
  return { kind: "none", ...over };
}

function progress(over: Over = {}) {
  return {
    requiredLessonsComplete: 2,
    requiredLessonsTotal: 5,
    attendance: { kind: "no-rule" },
    structure: "structure",
    ...over,
  };
}

function card(over: Over = {}) {
  return {
    enrolmentId: "enrolment-1",
    cohortTitle: "Cohort One",
    timezone: "Africa/Lagos",
    assessmentObligations: { kind: "deferred", phase: 10 },
    results: { kind: "deferred", phase: 10 },
    tickets: { kind: "deferred", phase: 12 },
    // Plan 11-13 — certificate is no longer a DeferredColumn; "not-complete"
    // is the no-certificate-yet state. WR-06: CertificateSlot renders it as a
    // normal card ("will appear here once you have completed all
    // requirements"), no longer the Phase 9 "arriving in a future update"
    // named gap, and "not-applicable" renders nothing at all.
    certificate: { kind: "not-complete" },
    progress: progress(),
    accessNotice: accessNotice(),
    upcomingSessions: [],
    hasMoreSessions: false,
    nextAction: { kind: "none" },
    ...over,
  };
}

const run = () => Page();
const renderPage = async () => renderToStaticMarkup((await run()) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`${NOT_FOUND_REDIRECT}:${url}`);
  });
  mocks.getCurrentActor.mockResolvedValue(ACTOR);
  mocks.loadLearnerDashboard.mockResolvedValue({ cards: [] });
});

describe("/dashboard", () => {
  it("redirects a signed-out visitor to sign-in instead of rendering a dashboard", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    await expect(run()).rejects.toThrow(`${NOT_FOUND_REDIRECT}:/signin`);
    expect(mocks.loadLearnerDashboard).not.toHaveBeenCalled();
  });

  it("renders the empty state when the learner has no active enrolments", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({ cards: [] });

    const html = await renderPage();

    expect(html).toContain("Nothing to pick up right now");
    expect(html).toContain("Your dashboard");
  });

  it("renders a lesson next-action with a working Continue-learning link", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [
        card({
          nextAction: {
            kind: "lesson",
            enrolmentId: "enrolment-1",
            lessonId: "lesson-9",
            lessonTitle: "Intro to Testing",
            moduleTitle: "Foundations",
          },
        }),
      ],
    });

    const html = await renderPage();

    expect(html).toContain("Intro to Testing");
    expect(html).toContain("in Foundations");
    expect(html).toMatch(/<a href="\/learn\/enrolment-1\/lessons\/lesson-9"[^>]*>Continue learning<\/a>/);
  });

  it("renders exactly two progressbars when an attendance threshold applies", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [
        card({
          progress: progress({
            attendance: {
              kind: "computed",
              earnedPct: 80,
              requiredPct: 75,
              attendedCount: 8,
              countableCount: 10,
              meetsThreshold: true,
            },
          }),
        }),
      ],
    });

    const html = await renderPage();
    const count = (html.match(/role="progressbar"/g) ?? []).length;

    expect(count).toBe(2);
    expect(html).toContain("Attendance: 80% of 75% required");
  });

  it("renders exactly one progressbar when the cohort has no attendance rule", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [card({ progress: progress({ attendance: { kind: "no-rule" } }) })],
    });

    const html = await renderPage();
    const count = (html.match(/role="progressbar"/g) ?? []).length;

    expect(count).toBe(1);
  });

  it("renders a muted no-sessions line instead of a fake 0% attendance bar", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [card({ progress: progress({ attendance: { kind: "no-sessions" } }) })],
    });

    const html = await renderPage();
    const count = (html.match(/role="progressbar"/g) ?? []).length;

    expect(count).toBe(1);
    expect(html).toContain("No countable sessions yet");
  });

  it("renders a muted line instead of '0 of 0 complete' when the enrolment's structure is unpinned", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [
        card({
          progress: {
            requiredLessonsComplete: 0,
            requiredLessonsTotal: 0,
            attendance: { kind: "no-rule" },
            structure: "unpinned",
          },
        }),
      ],
    });

    const html = await renderPage();

    expect(html).not.toContain("0 of 0");
    const count = (html.match(/role="progressbar"/g) ?? []).length;
    expect(count).toBe(0);
  });

  it("renders no certificate surface at all when the card's certificate is not-applicable (WR-06)", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [card({ certificate: { kind: "not-applicable" } })],
    });

    const html = await renderPage();

    expect(html).not.toContain("being finalized");
    expect(html).not.toContain("Certificate");
    expect(html).not.toContain("certificate will appear");
  });

  it("never renders any of the remaining named-gap strings inside a link element", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({ cards: [card()] });

    const html = await renderPage();
    const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
    const gapStrings = [
      "Assignments and quizzes — arriving in a future update",
      "Results — arriving in a future update",
      "Support tickets — arriving in a future update",
    ];

    for (const anchor of anchors) {
      for (const gap of gapStrings) {
        expect(anchor).not.toContain(gap);
      }
    }
    // Sanity check the gap strings really are present somewhere on the page
    // (outside any link), so this test cannot pass by them being absent.
    for (const gap of gapStrings) {
      expect(html).toContain(gap);
    }
  });

  it("never renders a meeting link or a bare http(s) URL inside the upcoming-sessions card", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [
        card({
          upcomingSessions: [
            {
              id: "session-1",
              title: "Kickoff call",
              startsAt: new Date("2026-09-20T09:00:00.000Z"),
              endsAt: new Date("2026-09-20T10:00:00.000Z"),
              mode: "unknown",
              location: null,
              cancelledAt: null,
            },
          ],
          hasMoreSessions: true,
        }),
      ],
    });

    const html = await renderPage();

    expect(html).not.toContain("meetingUrl");
    expect(html.match(/https?:\/\//)).toBeNull();
    expect(html).toContain("Kickoff call");
    expect(html).toMatch(/<a href="\/learn\/enrolment-1\/sessions"[^>]*>View all<\/a>/);
  });

  it("renders the ending-access warning tone, not danger, and the two-line ended copy separately", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [
        card({ enrolmentId: "e-ending", accessNotice: { kind: "ending", endsAt: new Date("2026-10-01T00:00:00.000Z") } }),
      ],
    });
    const endingHtml = await renderPage();
    expect(endingHtml).toContain("Your access ends 2026-10-01");
    expect(endingHtml).toContain("bg-warning-surface");
    expect(endingHtml).not.toContain("bg-danger-surface");

    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [card({ enrolmentId: "e-ended", accessNotice: { kind: "ended" } })],
    });
    const endedHtml = await renderPage();
    expect(endedHtml).toContain("Your access window has ended");
    expect(endedHtml).toContain("your progress and results stay on record");
  });

  // ---- Plan 11-18: COMPLETED cards (UAT tests 10 and 19, decision G-01) ----

  const issuedAt = new Date("2026-09-10T00:00:00.000Z");
  function completedCard(over: Over = {}) {
    return card({
      enrolmentStatus: "COMPLETED",
      nextAction: { kind: "complete" },
      certificate: {
        kind: "issued",
        certificateId: "cert-1",
        verificationRef: "CERT-ABC",
        issuedAt,
      },
      // A COMPLETED card carries these to-the-page-hostile fields on purpose:
      // if the page rendered them the omitted-section assertions would catch it.
      assessmentObligations: {
        kind: "tracked",
        items: [{ assessmentId: "a-1", title: "Final quiz", lessonId: "lesson-7" }],
      },
      results: {
        kind: "tracked",
        recent: [{ assessmentId: "a-1", title: "Final quiz", effectiveScore: 8, maxScore: 10 }],
      },
      upcomingSessions: [
        {
          id: "session-1",
          title: "Wrap-up call",
          startsAt: new Date("2026-09-20T09:00:00.000Z"),
          endsAt: new Date("2026-09-20T10:00:00.000Z"),
          mode: "unknown",
          location: null,
          cancelledAt: null,
        },
      ],
      hasMoreSessions: true,
      accessNotice: { kind: "ended" },
      ...over,
    });
  }

  it("G-01: a COMPLETED card shows the certificate download and reference and no dead links", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({ cards: [completedCard()] });

    const html = await renderPage();

    expect(html).toContain('href="/api/certificates/cert-1/download"');
    expect(html).toContain("Download certificate");
    expect(html).toContain("CERT-ABC");
    // Still present.
    expect(html).toContain("Cohort One");
    expect(html).toContain("Next up");
    expect(html).toContain("Your progress");
    expect(html).toContain("Support tickets");
    // Omitted: sections and links the COMPLETED enrolment cannot open.
    expect(html).not.toContain("Upcoming sessions");
    expect(html).not.toContain("Wrap-up call");
    expect(html).not.toContain("Assessments");
    expect(html).not.toContain("Results");
    expect(html).not.toContain("Continue learning");
    expect(html).not.toContain("Your access window has ended");
    expect(html).not.toContain("/learn/enrolment-1/");
  });

  it("the Next-up 'complete' copy no longer promises certificates are yet to ship", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [card({ nextAction: { kind: "complete" } })],
    });

    const html = await renderPage();

    expect(html).not.toContain("certificates ship");
    expect(html).not.toContain("once certificates");
    expect(html).toContain("Certificate section below");
  });

  it("guard: an ACTIVE card still renders Assessments, Results and Upcoming sessions", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [
        completedCard({
          enrolmentStatus: "ACTIVE",
          nextAction: { kind: "none" },
          accessNotice: { kind: "none" },
        }),
      ],
    });

    const html = await renderPage();

    expect(html).toContain("Upcoming sessions");
    expect(html).toContain("Assessments");
    expect(html).toContain("Results");
    expect(html).toContain('href="/learn/enrolment-1/sessions"');
    expect(html).toContain('href="/learn/enrolment-1/results"');
    expect(html).toContain('href="/learn/enrolment-1/lessons/lesson-7"');
  });
});
