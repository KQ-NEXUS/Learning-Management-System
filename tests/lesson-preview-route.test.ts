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
      listLessonCaptions: vi.fn(),
      LessonContent: vi.fn(() => null),
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
  listLessonCaptions: mocks.listLessonCaptions,
}));
vi.mock("@/components/catalogue/LessonContent", () => ({ LessonContent: mocks.LessonContent }));

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

/** The props the page hands to `LessonContent`, found by walking the element it returns. */
function lessonContentProps(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = lessonContentProps(child);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === mocks.LessonContent) return element.props ?? null;
  return lessonContentProps(element.props?.children);
}

const videoResource = { id: "video-1", title: "Welcome", filename: "welcome.mp4", mimeType: "video/mp4", sizeBytes: BigInt(1024), uploadStatus: "READY" };
const track = (over: Over = {}) => ({
  id: "caption-en",
  videoResourceId: "video-1",
  language: "en",
  label: "English",
  uploadStatus: "READY",
  uploadDetail: null,
  ...over,
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
  mocks.listLessonCaptions.mockResolvedValue([]);
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

  // W-09: the staff preview of a video lesson showed no captions; the learner player did.
  describe("captions in the preview of a video lesson (W-09)", () => {
    beforeEach(() => {
      mocks.lessonGet.mockResolvedValue(lesson({ type: "VIDEO" }));
      mocks.listLessonResources.mockResolvedValue([videoResource]);
    });

    it("passes the lesson's caption tracks to the player, read through the staff permission check", async () => {
      mocks.listLessonCaptions.mockResolvedValue([track(), track({ id: "caption-fr", language: "fr", label: "Français" })]);

      const props = lessonContentProps(await run());

      expect(mocks.listLessonCaptions).toHaveBeenCalledWith("lesson-1");
      expect(props?.captions).toEqual([
        { id: "caption-en", videoResourceId: "video-1", language: "en", label: "English" },
        { id: "caption-fr", videoResourceId: "video-1", language: "fr", label: "Français" },
      ]);
    });

    it("offers only tracks that are READY, as the learner view does: an upload in progress or a failed one is left out", async () => {
      mocks.listLessonCaptions.mockResolvedValue([
        track(),
        track({ id: "caption-uploading", uploadStatus: "UPLOADING" }),
        track({ id: "caption-failed", uploadStatus: "ERROR", uploadDetail: "Not a caption file." }),
      ]);

      const props = lessonContentProps(await run());

      expect((props?.captions as { id: string }[]).map((caption) => caption.id)).toEqual(["caption-en"]);
      // Nothing but what the player needs crosses to the client component.
      expect(JSON.stringify(props?.captions)).not.toMatch(/uploadStatus|uploadDetail|storageKey/);
    });

    it("does not read captions for a lesson that is not a video", async () => {
      mocks.lessonGet.mockResolvedValue(lesson({ type: "TEXT" }));

      const props = lessonContentProps(await run());

      expect(mocks.listLessonCaptions).not.toHaveBeenCalled();
      expect(props?.captions).toEqual([]);
    });

    it("does not read captions for a lesson of another course", async () => {
      mocks.resolveCourseIdForLesson.mockResolvedValue("course-2");

      await expect(run()).rejects.toThrow(NOT_FOUND);
      expect(mocks.listLessonCaptions).not.toHaveBeenCalled();
    });

    it("maps a refusal to read the captions to the same notFound path", async () => {
      mocks.listLessonCaptions.mockRejectedValue(new AuthorizationError("denied"));

      await expect(run()).rejects.toThrow(NOT_FOUND);
      expect(mocks.LessonContent).not.toHaveBeenCalled();
    });
  });

  it("maps an authorization denial on the lesson to the same notFound path", async () => {
    mocks.lessonGet.mockRejectedValue(new AuthorizationError("denied"));

    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.listLessonResources).not.toHaveBeenCalled();
  });
});
