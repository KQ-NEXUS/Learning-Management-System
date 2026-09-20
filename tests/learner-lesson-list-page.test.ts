import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `/learn/[enrolmentId]` (`src/app/(learner)/learn/[enrolmentId]/page.tsx`,
 * 09-09 Task 3).
 *
 * Graded like `tests/learner-dashboard-page.test.ts` /
 * `tests/staff-progress-override.test.ts`: the page is a Server Component
 * with a dynamic-route `params` promise, invoked directly, then rendered to
 * a markup string via `react-dom/server`'s `renderToStaticMarkup` (no jsdom
 * needed — this file runs under Vitest's "node" project) so assertions can
 * inspect real rendered HTML: which titles leaked, which rows carry an
 * `href`, and which don't.
 *
 * `next/link` is mocked to a plain `<a>` so href assertions can inspect
 * real markup, matching the dashboard test's own justification.
 */

const NOT_FOUND = "notFound";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getCurrentActor: vi.fn(),
    loadLearnerPath: vi.fn(),
    getOwnPendingEnrolmentOrderHref: vi.fn(),
    collectRequiredLessonEvidence: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    notFound: vi.fn(() => {
      throw new Error(NOT_FOUND);
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
vi.mock("@/server/services/learner-access", () => ({
  loadLearnerPath: mocks.loadLearnerPath,
  getOwnPendingEnrolmentOrderHref: mocks.getOwnPendingEnrolmentOrderHref,
}));
vi.mock("@/server/services/enrolment-dashboard-service", () => ({
  collectRequiredLessonEvidence: mocks.collectRequiredLessonEvidence,
}));

import Page from "@/app/(learner)/learn/[enrolmentId]/page";

type Over = Record<string, unknown>;

const ACTOR = { userId: "user-a", roles: [] };

function lessonFixture(over: Over = {}) {
  return {
    id: "lesson-1",
    title: "Lesson One",
    type: "TEXT",
    position: 0,
    required: true,
    allowManualComplete: true,
    withdrawnAt: null,
    locked: false,
    blockingLessonTitle: null,
    completed: false,
    completedSource: null,
    completedAt: null,
    ...over,
  };
}

function moduleFixture(over: Over = {}) {
  return {
    id: "module-1",
    title: "Module One",
    position: 0,
    lessons: [lessonFixture()],
    ...over,
  };
}

function courseFixture(over: Over = {}) {
  return {
    courseId: "course-1",
    courseTitle: "Course One",
    modules: [moduleFixture()],
    ...over,
  };
}

function pathFixture(over: Over = {}) {
  return {
    enrolment: {
      id: "enrolment-1",
      cohortId: "cohort-1",
      status: "ACTIVE",
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      accessStartsAt: new Date("2026-01-01T00:00:00.000Z"),
      accessEndsAt: null,
      cohort: {
        id: "cohort-1",
        title: "Cohort One",
        deliveryMode: "SELF_PACED",
        timezone: "Africa/Lagos",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-12-31T00:00:00.000Z"),
        attendanceThresholdPct: null,
        courseId: "course-1",
        programmeId: null,
      },
      accessWindow: { kind: "unlimited", readOnly: false, endsAt: null },
    },
    courses: [courseFixture()],
    progress: new Set<string>(),
    sequencing: [],
    ...over,
  };
}

// Mirrors the real `collectRequiredLessonEvidence` logic closely enough for
// this page's own render — required, not-withdrawn lessons vs. completed.
function computeEvidence(path: ReturnType<typeof pathFixture>) {
  const requiredLessonIds: string[] = [];
  const completedLessonIds = new Set<string>();
  for (const course of path.courses as ReturnType<typeof courseFixture>[]) {
    for (const mod of course.modules as ReturnType<typeof moduleFixture>[]) {
      for (const l of mod.lessons as ReturnType<typeof lessonFixture>[]) {
        if (l.required && l.withdrawnAt == null) requiredLessonIds.push(l.id);
        if (l.completed) completedLessonIds.add(l.id);
      }
    }
  }
  return { requiredLessonIds, completedLessonIds };
}

function pageParams(enrolmentId = "enrolment-1") {
  return { params: Promise.resolve({ enrolmentId }) };
}

const run = (enrolmentId?: string) => Page(pageParams(enrolmentId));
const renderPage = async (enrolmentId?: string) =>
  renderToStaticMarkup((await run(enrolmentId)) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.notFound.mockImplementation(() => {
    throw new Error(NOT_FOUND);
  });
  mocks.getCurrentActor.mockResolvedValue(ACTOR);
  mocks.getOwnPendingEnrolmentOrderHref.mockResolvedValue(null);
  mocks.collectRequiredLessonEvidence.mockImplementation(computeEvidence);
});

describe("/learn/[enrolmentId]", () => {
  it("redirects a signed-out visitor to sign-in instead of rendering", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    await expect(run()).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(mocks.loadLearnerPath).not.toHaveBeenCalled();
  });

  it("renders module headers and lesson rows, in order, for an owned ACTIVE enrolment", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                id: "module-a",
                title: "Module A",
                lessons: [
                  lessonFixture({ id: "lesson-a1", title: "Lesson A1" }),
                  lessonFixture({ id: "lesson-a2", title: "Lesson A2" }),
                ],
              }),
              moduleFixture({ id: "module-b", title: "Module B", lessons: [lessonFixture({ id: "lesson-b1", title: "Lesson B1" })] }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).toContain("Course One");
    const orderOfAppearance = ["Module A", "Lesson A1", "Lesson A2", "Module B", "Lesson B1"].map(
      (needle) => html.indexOf(needle),
    );
    for (const index of orderOfAppearance) expect(index).toBeGreaterThan(-1);
    for (let i = 1; i < orderOfAppearance.length; i++) {
      expect(orderOfAppearance[i]).toBeGreaterThan(orderOfAppearance[i - 1]);
    }
  });

  it("renders a locked row's blocking lesson title and gives that row no href", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [
                  lessonFixture({
                    id: "lesson-locked",
                    title: "Locked Lesson",
                    locked: true,
                    blockingLessonTitle: "Intro Lesson",
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).toContain("Intro Lesson");
    expect(html).toContain("Locked Lesson");
    expect(html).toContain('aria-disabled="true"');
    // The locked row is a div, not an anchor — no href referencing this lesson.
    expect(html).not.toContain('href="/learn/enrolment-1/lessons/lesson-locked"');
  });

  it("gives an unlocked row an href into the lesson-reading pane", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({ lessons: [lessonFixture({ id: "lesson-open", title: "Open Lesson" })] }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).toMatch(/<a href="\/learn\/enrolment-1\/lessons\/lesson-open"[^>]*>/);
  });

  it("renders the denied panel and leaks no lesson or module title for a PENDING_PAYMENT enrolment", async () => {
    mocks.loadLearnerPath.mockResolvedValue(null);
    mocks.getOwnPendingEnrolmentOrderHref.mockResolvedValue("/orders/ORD-123");

    const html = await renderPage();

    expect(html).toContain("You don&#x27;t have access to this course yet");
    expect(html).toMatch(/<a href="\/orders\/ORD-123"[^>]*>/);
    expect(html).not.toContain("Lesson One");
    expect(html).not.toContain("Module One");
    expect(html).not.toContain("Course One");
  });

  it("calls notFound() for a stranger's enrolment id", async () => {
    mocks.loadLearnerPath.mockResolvedValue(null);
    mocks.getOwnPendingEnrolmentOrderHref.mockResolvedValue(null);

    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("renders a module with zero lessons as a header with no rows, without error", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [moduleFixture({ id: "module-empty", title: "Empty Module", lessons: [] })],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).toContain("Empty Module");
  });

  it("renders the course-level progress caption from the shared evidence helper", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [
                  lessonFixture({ id: "lesson-done", completed: true }),
                  lessonFixture({ id: "lesson-todo", completed: false }),
                ],
              }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).toContain("1 of 2 required lessons complete");
    expect(mocks.collectRequiredLessonEvidence).toHaveBeenCalled();
  });
});
