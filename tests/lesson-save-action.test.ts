import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UX batch A — the lesson editor's Quiz/Assignment picker. The save action
 * must send the chosen assessment (and clear it when blank), and a refused
 * link must come back as an error on the picker, not a crash.
 */

const m = vi.hoisted(() => ({ createLesson: vi.fn(), updateLesson: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/services/lesson-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/lesson-service")>();
  return { ...actual, createLesson: m.createLesson, updateLesson: m.updateLesson };
});

import { AssessmentLinkError } from "@/server/services/lesson-service";
import { saveLessonAction } from "@/app/staff/courses/[id]/lessons/[lessonId]/actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const INITIAL = { ok: false as const, errors: [], message: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.updateLesson.mockResolvedValue({ id: "l1" });
});

describe("saveLessonAction — the assessment link", () => {
  it("sends the chosen assessment for a Quiz lesson", async () => {
    await saveLessonAction(INITIAL, form({ lessonId: "l1", courseId: "c1", type: "QUIZ", title: "Q", assessmentId: "quiz-1" }));
    expect(m.updateLesson.mock.calls[0][1]).toMatchObject({ assessmentId: "quiz-1" });
  });

  it("a blank choice clears the link", async () => {
    await saveLessonAction(INITIAL, form({ lessonId: "l1", courseId: "c1", type: "ASSIGNMENT", title: "A", assessmentId: "" }));
    expect(m.updateLesson.mock.calls[0][1]).toMatchObject({ assessmentId: null });
  });

  it("a non-assessment lesson never sends a link", async () => {
    await saveLessonAction(INITIAL, form({ lessonId: "l1", courseId: "c1", type: "TEXT", title: "T", body: "<p>x</p>", assessmentId: "quiz-1" }));
    expect(m.updateLesson.mock.calls[0][1]).not.toHaveProperty("assessmentId");
  });

  it("a refused link comes back as an error on the picker", async () => {
    m.updateLesson.mockRejectedValueOnce(new AssessmentLinkError("Choose an assessment from this course."));
    const result = await saveLessonAction(INITIAL, form({ lessonId: "l1", courseId: "c1", type: "QUIZ", title: "Q", assessmentId: "other" }));
    expect(result).toEqual({
      ok: false,
      errors: [{ name: "assessmentId", message: "Choose an assessment from this course." }],
      message: null,
    });
  });
});
