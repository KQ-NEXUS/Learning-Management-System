import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/server/services/assessment-service", () => ({ loadAssessmentForAuthoring: m.load, saveQuizQuestions: m.save, NotAQuizError: class extends Error {} }));
import { saveQuizQuestionsAction } from "@/app/staff/courses/[id]/assessments/question-actions";
import { AuthorizationError } from "@/server/permissions";
const input = { assessmentId: "a", questions: [{ prompt: "Question", type: "SINGLE_CHOICE", marks: 1, explanation: null, options: [{ label: "One", isCorrect: true }, { label: "Two", isCorrect: false }] }] };
beforeEach(() => { vi.clearAllMocks(); m.load.mockResolvedValue({ id: "a", courseId: "actual-course" }); m.save.mockResolvedValue({ totalMarks: 1 }); });
describe("question save action", () => {
  it("saves one ordered payload and revalidates the actual course", async () => { expect(await saveQuizQuestionsAction(input)).toEqual({ ok: true, totalMarks: 1 }); expect(m.save).toHaveBeenCalledExactlyOnceWith(input); expect(m.revalidate).toHaveBeenCalledExactlyOnceWith("/staff/courses/actual-course/assessments/a"); });
  it("rejects invalid marks before accessing the service", async () => { expect((await saveQuizQuestionsAction({ ...input, questions: [{ ...input.questions[0], marks: 0 }] })).ok).toBe(false); expect(m.load).not.toHaveBeenCalled(); });
  it("rejects unexpected fields", async () => { expect((await saveQuizQuestionsAction({ ...input, courseId: "fake" })).ok).toBe(false); expect(m.save).not.toHaveBeenCalled(); });
  it("returns permission errors in the form", async () => { m.save.mockRejectedValue(new AuthorizationError("Denied" as never)); expect(await saveQuizQuestionsAction(input)).toMatchObject({ ok: false, message: "Your role no longer permits editing this assessment." }); });
});
