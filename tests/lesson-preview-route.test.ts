import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The learner-view lesson preview page
 * (`src/app/staff/courses/[id]/preview/lessons/[lessonId]/page.tsx`) must reject
 * a cross-course context — `/staff/courses/{A}/preview/lessons/{lesson-in-B}` —
 * BEFORE it loads any lesson resources, while still previewing an authorized
 * withdrawn lesson that `loadCourseTree` intentionally omits.
 *
 * The page is a server component; it is invoked directly and its returned
 * element (or its `notFound()` throw) is inspected. `notFound()` really throws
 * in Next, and the page relies on that control-flow, so the mock throws too.
 */

const NOT_FOUND = "NEXT_NOT_FOUND";

const { mocks, AuthorizationError, AuthenticationError } = vi.hoisted(() => {
  class AuthorizationError extends Error {}
  class AuthenticationError extends Error {}
  return {
    AuthorizationError,
    AuthenticationError,
    mocks: {
      courseGet: vi.fn(),
      lessonGet: vi.fn(),
      loadCourseTree: vi.fn(),
      listLessonResources: vi.fn(),
      resolveCourseIdForLesson: vi.fn(),
      notFound: vi.fn(() => {
        throw new Error("NEXT_NOT_FOUND");
      }),
    },
  };
});

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("lucide-react", () => ({ Eye: () => null }));
vi.mock("@/server/permissions", () => ({ AuthorizationError, AuthenticationError }));
vi.mock("@/server/services/course-service", () => ({ courseService: { get: mocks.courseGet } }));
vi.mock("@/server/services/lesson-service", () => ({
  lessonService: { get: mocks.lessonGet },
  loadCourseTree: mocks.loadCourseTree,
  resolveCourseIdForLesson: mocks.resolveCourseIdForLesson,
}));
vi.mock("@/server/services/lesson-resource-service", () => ({
  listLessonResources: mocks.listLessonResources,
}));
vi.mock("@/components/catalogue/LessonContent", () => ({ LessonContent: () => null }));

import Page from "@/app/staff/courses/[id]/preview/lessons/[lessonId]/page";

type Over = Record<string, unknown>;

const lesson = (over: Over = {}) => ({
  id: "lesson-1",
  moduleId: "module-1",
  title: "Intro",
  type: "TEXT",
  position: 0,
  body: null,
  embedUrl: null,
  linkUrl: null,
  required: true,
  allowManualComplete: true,
  assessmentId: null,
  withdrawnAt: null,
  ...over,
});

const treeWith = (lessonId: string | null) => ({
  id: "course-1",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  modules: [
    {
      id: "module-1",
      title: "Module one",
      summary: null,
      position: 0,
      lessons: lessonId
        ? [
            {
              id: lessonId,
              title: "Intro",
              type: "TEXT",
              position: 0,
              required: true,
              allowManualComplete: true,
              assessmentId: null,
              embedUrl: null,
              linkUrl: null,
              body: null,
            },
          ]
        : [],
    },
  ],
});

const run = (over: Over = {}) =>
  Page({
    params: Promise.resolve({ id: "course-1", lessonId: "lesson-1", ...over }),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notFound.mockImplementation(() => {
    throw new Error(NOT_FOUND);
  });
  mocks.courseGet.mockResolvedValue({ id: "course-1", title: "Course" });
  mocks.lessonGet.mockResolvedValue(lesson());
  mocks.resolveCourseIdForLesson.mockResolvedValue("course-1");
  mocks.loadCourseTree.mockResolvedValue(treeWith("lesson-1"));
  mocks.listLessonResources.mockResolvedValue([]);
});

describe("learner-view lesson preview route", () => {
  it("previews a same-course active lesson and loads its resources", async () => {
    await expect(run()).resolves.toBeTruthy();
    expect(mocks.resolveCourseIdForLesson).toHaveBeenCalledWith("lesson-1");
    expect(mocks.listLessonResources).toHaveBeenCalledWith("lesson-1");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("previews a same-course withdrawn lesson the course tree omits", async () => {
    mocks.lessonGet.mockResolvedValue(lesson({ withdrawnAt: new Date("2026-02-01T00:00:00Z") }));
    mocks.loadCourseTree.mockResolvedValue(treeWith(null));

    await expect(run()).resolves.toBeTruthy();
    expect(mocks.listLessonResources).toHaveBeenCalledWith("lesson-1");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("rejects a lesson whose real parent course differs, before loading resources", async () => {
    mocks.resolveCourseIdForLesson.mockResolvedValue("course-2");

    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.loadCourseTree).not.toHaveBeenCalled();
    expect(mocks.listLessonResources).not.toHaveBeenCalled();
  });

  it("rejects an unknown lesson id the same way, without loading resources", async () => {
    mocks.lessonGet.mockResolvedValue(null);
    mocks.resolveCourseIdForLesson.mockResolvedValue(null);

    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.listLessonResources).not.toHaveBeenCalled();
  });

  it("maps an authorization denial on the lesson to the same notFound path", async () => {
    mocks.lessonGet.mockRejectedValue(new AuthorizationError("denied"));

    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.listLessonResources).not.toHaveBeenCalled();
  });
});
