import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `/learn/[enrolmentId]/lessons/[lessonId]` (`src/app/(learner)/learn/
 * [enrolmentId]/lessons/[lessonId]/page.tsx`, 09-11 Tasks 1 and 3).
 *
 * Graded like `tests/learner-lesson-list-page.test.ts`: a Server Component
 * with a dynamic-route `params` promise, invoked directly, then rendered to
 * a markup string via `react-dom/server`'s `renderToStaticMarkup` (no jsdom
 * needed — this file runs under Vitest's "node" project).
 *
 * Every server-service import is fully mocked so this file never pulls in
 * the real `prisma`-backed singleton chain those services build at module
 * scope — `assertLessonOpenable`'s mock below reimplements just enough of
 * the real gating logic (found? window closed? locked?) to drive the
 * page's branches from plain fixture data, mirroring the real function's
 * documented precedence without needing the real module.
 *
 * `LessonContent` and `LessonCompleteControl` are the REAL components —
 * proving the former renders unchanged is the point, and the latter's own
 * render-state coverage lives here per the plan's Task 3 instruction to
 * extend this same file. `LessonCompleteControl`'s own Server Action
 * imports are mocked so instantiating it never pulls in the real,
 * prisma-backed `lesson-progress-service.ts` chain either.
 */

const NOT_FOUND = "notFound";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getCurrentActor: vi.fn(),
    loadLearnerPath: vi.fn(),
    assertLessonOpenable: vi.fn(),
    getLessonContentForLearner: vi.fn(),
    listLessonResourcesForLearner: vi.fn(),
    countLessonsRelockedBy: vi.fn(),
    getOwnWatchProgress: vi.fn(),
    markLessonCompleteAction: vi.fn(),
    undoLessonCompleteAction: vi.fn(),
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
  assertLessonOpenable: mocks.assertLessonOpenable,
}));
vi.mock("@/server/services/lesson-service", () => ({
  getLessonContentForLearner: mocks.getLessonContentForLearner,
}));
vi.mock("@/server/services/lesson-resource-service", () => ({
  listLessonResourcesForLearner: mocks.listLessonResourcesForLearner,
}));
vi.mock("@/server/services/lesson-progress-service", () => ({
  countLessonsRelockedBy: mocks.countLessonsRelockedBy,
  getOwnWatchProgress: mocks.getOwnWatchProgress,
}));
vi.mock("@/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/actions", () => ({
  markLessonCompleteAction: mocks.markLessonCompleteAction,
  undoLessonCompleteAction: mocks.undoLessonCompleteAction,
}));
// VideoWatchTracker's own client-effect behaviour is covered by
// tests/video-watch-tracker.test.ts — mocked here to a plain marker wrapper
// so this file only proves the PAGE's wiring decision (which lesson types
// get wrapped, and with what props), not the tracker's internals.
vi.mock("@/components/learner/VideoWatchTracker", () => ({
  VideoWatchTracker: ({
    enrolmentId,
    lessonId,
    initialSecondsWatched,
    children,
  }: {
    enrolmentId: string;
    lessonId: string;
    initialSecondsWatched: number;
    children?: ReactNode;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "video-watch-tracker",
        "data-enrolment-id": enrolmentId,
        "data-lesson-id": lessonId,
        "data-initial-seconds-watched": initialSecondsWatched,
      },
      children,
    ),
}));

import Page from "@/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/page";
import { undoRelockNotice } from "@/components/learner/LessonCompleteControl";

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

function contentFixture(over: Over = {}) {
  return {
    id: "lesson-1",
    title: "Lesson One",
    type: "TEXT",
    body: "<p>Lesson body text for Lesson One</p>",
    embedUrl: null,
    linkUrl: null,
    withdrawnAt: null,
    ...over,
  };
}

function findLessonInPath(
  path: ReturnType<typeof pathFixture>,
  lessonId: string,
): ReturnType<typeof lessonFixture> | null {
  for (const course of path.courses as ReturnType<typeof courseFixture>[]) {
    for (const mod of course.modules as ReturnType<typeof moduleFixture>[]) {
      for (const lesson of mod.lessons as ReturnType<typeof lessonFixture>[]) {
        if (lesson.id === lessonId) return lesson;
      }
    }
  }
  return null;
}

/** Mirrors `assertLessonOpenable`'s own documented precedence: not-found,
 *  then the access window, then the sequencing lock. */
function defaultAssertLessonOpenable(path: ReturnType<typeof pathFixture>, lessonId: string) {
  const lesson = findLessonInPath(path, lessonId);
  if (!lesson) return { ok: false as const, reason: "not-found" as const };
  if (path.enrolment.accessWindow.readOnly) {
    return { ok: false as const, reason: "access-window-closed" as const };
  }
  if (lesson.locked) return { ok: false as const, reason: "locked" as const };
  return { ok: true as const, lesson };
}

function pageParams(enrolmentId = "enrolment-1", lessonId = "lesson-1") {
  return { params: Promise.resolve({ enrolmentId, lessonId }) };
}

const run = (enrolmentId?: string, lessonId?: string) => Page(pageParams(enrolmentId, lessonId));
const renderPage = async (enrolmentId?: string, lessonId?: string) =>
  renderToStaticMarkup((await run(enrolmentId, lessonId)) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.notFound.mockImplementation(() => {
    throw new Error(NOT_FOUND);
  });
  mocks.getCurrentActor.mockResolvedValue(ACTOR);
  mocks.assertLessonOpenable.mockImplementation(defaultAssertLessonOpenable);
  mocks.getLessonContentForLearner.mockResolvedValue(contentFixture());
  mocks.listLessonResourcesForLearner.mockResolvedValue([]);
  mocks.countLessonsRelockedBy.mockReturnValue(0);
  mocks.getOwnWatchProgress.mockResolvedValue(null);
});

describe("/learn/[enrolmentId]/lessons/[lessonId]", () => {
  it("redirects a signed-out visitor to sign-in instead of rendering", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    await expect(run()).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(mocks.loadLearnerPath).not.toHaveBeenCalled();
  });

  it("calls notFound() for a stranger's or unknown enrolment id", async () => {
    mocks.loadLearnerPath.mockResolvedValue(null);

    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("renders the lesson title and LessonContent output for an openable lesson", async () => {
    mocks.loadLearnerPath.mockResolvedValue(pathFixture());

    const html = await renderPage();

    expect(html).toContain("Lesson One");
    expect(html).toContain("Lesson body text for Lesson One");
  });

  it("calls notFound() for a locked lesson id, and no lesson body text appears", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [courseFixture({ modules: [moduleFixture({ lessons: [lessonFixture({ locked: true })] })] })],
      }),
    );

    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.getLessonContentForLearner).not.toHaveBeenCalled();
  });

  it("renders the ended-access copy and no lesson body content for a closed access window", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        enrolment: { ...pathFixture().enrolment, accessWindow: { kind: "windowed", readOnly: true, endsAt: new Date() } },
      }),
    );

    const html = await renderPage();

    expect(html).toContain("Your access window has ended");
    expect(html).not.toContain("Lesson body text for Lesson One");
    expect(html).not.toContain("Lesson One");
    expect(mocks.getLessonContentForLearner).not.toHaveBeenCalled();
  });

  it("gives an unlocked next lesson an href into the next lesson-reading pane", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [
                  lessonFixture({ id: "lesson-1", title: "Lesson One" }),
                  lessonFixture({ id: "lesson-2", title: "Lesson Two" }),
                ],
              }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).toMatch(/<a href="\/learn\/enrolment-1\/lessons\/lesson-2"[^>]*>Next lesson/);
  });

  it("renders a muted, non-interactive 'Next lesson' with no href when the next lesson is locked", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [
                  lessonFixture({ id: "lesson-1", title: "Lesson One" }),
                  lessonFixture({ id: "lesson-2", title: "Lesson Two", locked: true }),
                ],
              }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).not.toMatch(/<a href="\/learn\/enrolment-1\/lessons\/lesson-2"/);
    expect(html).toContain("Next lesson");
  });

  it("renders muted, non-interactive prev/next text with no href at the only (first and last) lesson", async () => {
    mocks.loadLearnerPath.mockResolvedValue(pathFixture());

    const html = await renderPage();

    expect(html).not.toMatch(/<a href="[^"]*"[^>]*>(← Previous lesson|Next lesson)/);
    expect(html).toContain("Previous lesson");
    expect(html).toContain("Next lesson");
  });

  it("renders a back link to the course's lesson-list page", async () => {
    mocks.loadLearnerPath.mockResolvedValue(pathFixture());

    const html = await renderPage();

    expect(html).toMatch(/<a href="\/learn\/enrolment-1"[^>]*>← Course One<\/a>/);
  });
});

describe("LessonCompleteControl, rendered inside the reading pane (09-11 Task 3)", () => {
  it("renders a single 38px 'Mark complete' submit button when not completed and allowManualComplete is true", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [lessonFixture({ allowManualComplete: true, completed: false })],
              }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).toContain("Mark complete");
    expect((html.match(/<button/g) ?? []).length).toBe(1);
  });

  it("renders no button element at all when not completed and allowManualComplete is false", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [lessonFixture({ allowManualComplete: false, completed: false })],
              }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).not.toContain("<button");
    expect(html).not.toContain("Mark complete");
  });

  it("renders the Completed label plus exactly one Undo control and zero Mark complete controls", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [
                  lessonFixture({ completed: true, completedSource: "MANUAL" }),
                ],
              }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).toContain("Completed");
    expect((html.match(/Undo/g) ?? []).length).toBe(1);
    expect(html).not.toContain("Mark complete");
  });

  it("renders the automatic-completion caption only for an AUTO_VIDEO source", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [lessonFixture({ completed: true, completedSource: "AUTO_VIDEO" })],
              }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).toContain("Marked complete automatically");
  });

  it("does not render the automatic-completion caption for a MANUAL source", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [lessonFixture({ completed: true, completedSource: "MANUAL" })],
              }),
            ],
          }),
        ],
      }),
    );

    const html = await renderPage();

    expect(html).not.toContain("Marked complete automatically");
  });

  it("does not show the D-16 relock disclosure before the undo affordance is engaged, even when relockCount > 0", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [lessonFixture({ completed: true, completedSource: "MANUAL" })],
              }),
            ],
          }),
        ],
      }),
    );
    mocks.countLessonsRelockedBy.mockReturnValue(3);

    const html = await renderPage();

    expect(html).not.toContain("re-lock");
    // The confirm step itself renders as a plain button, not the real submit —
    // this file runs under Vitest's "node" project (no jsdom), so the actual
    // click-through to the engaged disclosure is proven via `undoRelockNotice`
    // directly below rather than a simulated click.
  });

  it("undoRelockNotice renders DD-27's exact copy, singular and plural", () => {
    expect(undoRelockNotice(3)).toBe("Undoing this will also re-lock 3 lessons after it");
    expect(undoRelockNotice(1)).toBe("Undoing this will also re-lock 1 lesson after it");
  });
});

describe("VideoWatchTracker wiring (09-12 Task 3)", () => {
  it("wraps LessonContent in VideoWatchTracker for a VIDEO lesson, and still renders the lesson content", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [moduleFixture({ lessons: [lessonFixture({ type: "VIDEO" })] })],
          }),
        ],
      }),
    );
    mocks.getLessonContentForLearner.mockResolvedValue(contentFixture({ type: "VIDEO" }));

    const html = await renderPage();

    expect(html).toContain('data-testid="video-watch-tracker"');
    expect(html).toContain("Lesson body text for Lesson One");
  });

  it("does not render VideoWatchTracker output for a TEXT lesson", async () => {
    mocks.loadLearnerPath.mockResolvedValue(pathFixture());
    mocks.getLessonContentForLearner.mockResolvedValue(contentFixture({ type: "TEXT" }));

    const html = await renderPage();

    expect(html).not.toContain("video-watch-tracker");
  });

  it("renders both the tracker and the Mark complete button for a VIDEO lesson with allowManualComplete true (DD-16)", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [
                  lessonFixture({ type: "VIDEO", allowManualComplete: true, completed: false }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
    mocks.getLessonContentForLearner.mockResolvedValue(contentFixture({ type: "VIDEO" }));

    const html = await renderPage();

    expect(html).toContain('data-testid="video-watch-tracker"');
    expect(html).toContain("Mark complete");
  });

  it("gates the tracker on lesson.type alone, never on allowManualComplete — a VIDEO lesson with allowManualComplete false still gets the tracker", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [
              moduleFixture({
                lessons: [
                  lessonFixture({ type: "VIDEO", allowManualComplete: false, completed: false }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
    mocks.getLessonContentForLearner.mockResolvedValue(contentFixture({ type: "VIDEO" }));

    const html = await renderPage();

    expect(html).toContain('data-testid="video-watch-tracker"');
    expect(html).not.toContain("Mark complete");
  });

  it("passes initialSecondsWatched from the learner's own stored LessonWatchProgress row", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [moduleFixture({ lessons: [lessonFixture({ type: "VIDEO" })] })],
          }),
        ],
      }),
    );
    mocks.getLessonContentForLearner.mockResolvedValue(contentFixture({ type: "VIDEO" }));
    mocks.getOwnWatchProgress.mockResolvedValue({
      secondsWatched: 42,
      durationSeconds: 100,
      percentWatched: 42,
    });

    const html = await renderPage();

    expect(html).toContain('data-initial-seconds-watched="42"');
    expect(mocks.getOwnWatchProgress).toHaveBeenCalledWith(ACTOR, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
    });
  });

  it("defaults initialSecondsWatched to 0 when no stored row exists", async () => {
    mocks.loadLearnerPath.mockResolvedValue(
      pathFixture({
        courses: [
          courseFixture({
            modules: [moduleFixture({ lessons: [lessonFixture({ type: "VIDEO" })] })],
          }),
        ],
      }),
    );
    mocks.getLessonContentForLearner.mockResolvedValue(contentFixture({ type: "VIDEO" }));
    mocks.getOwnWatchProgress.mockResolvedValue(null);

    const html = await renderPage();

    expect(html).toContain('data-initial-seconds-watched="0"');
  });

  it("never calls getOwnWatchProgress for a non-VIDEO lesson", async () => {
    mocks.loadLearnerPath.mockResolvedValue(pathFixture());
    mocks.getLessonContentForLearner.mockResolvedValue(contentFixture({ type: "TEXT" }));

    await renderPage();

    expect(mocks.getOwnWatchProgress).not.toHaveBeenCalled();
  });
});
