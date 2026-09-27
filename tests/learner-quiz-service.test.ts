import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ path: vi.fn(), open: vi.fn(), lesson: vi.fn(), assessment: vi.fn(), active: vi.fn(), abandoned: vi.fn(), own: vi.fn(), results: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { lesson: { findUnique: m.lesson }, assessment: { findUnique: m.assessment }, attempt: { findFirst: m.active, findMany: m.abandoned } } }));
vi.mock("@/server/services/learner-access", () => ({ loadLearnerPath: m.path, assertLessonOpenable: m.open }));
vi.mock("@/server/services/attempt-service", () => ({ getOwnAttempt: m.own, getOwnAssessmentResult: m.results }));
import { loadLearnerQuiz } from "@/server/services/learner-quiz-service";
const actor = { userId: "u" } as never;
beforeEach(() => {
  vi.clearAllMocks(); m.path.mockResolvedValue({ courses: [{ modules: [{ lessons: [{ id: "l", type: "QUIZ" }] }] }] }); m.open.mockReturnValue({ ok: true });
  m.lesson.mockResolvedValue({ assessmentId: "quiz" }); m.assessment.mockResolvedValue({ id: "quiz", status: "PUBLISHED", type: "QUIZ", title: "Quiz", instructions: null, availableFrom: null, availableUntil: null, maxAttempts: 3, passMark: 1, feedbackBehaviour: "IMMEDIATE" });
  m.results.mockResolvedValue({ attemptsRemaining: 1, attempts: [{ attemptId: "new", attemptNumber: 2, status: "SUBMITTED", perQuestion: [{ correctOptionIds: ["key"], explanation: "secret" }] }, { attemptId: "old", attemptNumber: 1, status: "SUBMITTED", perQuestion: [] }] });
  m.active.mockResolvedValue(null); m.abandoned.mockResolvedValue([]);
});
describe("learner quiz read", () => {
  it("denies unowned and locked lessons before reading assessment data", async () => {
    m.path.mockResolvedValueOnce(null); expect(await loadLearnerQuiz(actor, { enrolmentId: "foreign", lessonId: "l" })).toBeNull();
    m.open.mockReturnValueOnce({ ok: false }); expect(await loadLearnerQuiz(actor, { enrolmentId: "e", lessonId: "l" })).toBeNull(); expect(m.lesson).not.toHaveBeenCalled();
  });
  it("selects the newest result and scopes reads to the exact enrolment", async () => {
    expect((await loadLearnerQuiz(actor, { enrolmentId: "e", lessonId: "l" }))?.result?.attemptId).toBe("new");
    expect(m.results).toHaveBeenCalledExactlyOnceWith(actor, { assessmentId: "quiz", enrolmentId: "e" });
    expect(m.active.mock.calls[0][0].where.enrolmentId).toBe("e");
  });
  it("removes NEVER feedback from the serialized payload", async () => {
    const assessment = await m.assessment(); m.assessment.mockResolvedValue({ ...assessment, feedbackBehaviour: "NEVER" });
    const view = await loadLearnerQuiz(actor, { enrolmentId: "e", lessonId: "l" }); expect(JSON.stringify(view)).not.toMatch(/correctOptionIds|explanation|secret/);
  });
  it("includes abandoned attempts without their snapshots or scores", async () => {
    m.abandoned.mockResolvedValue([{ id: "ab", attemptNumber: 3, submittedAt: null }]);
    const view = await loadLearnerQuiz(actor, { enrolmentId: "e", lessonId: "l" }); expect(view?.history[0]).toMatchObject({ attemptId: "ab", status: "ABANDONED", score: null, perQuestion: [] });
  });
});

describe("F-15 — 'On release' quiz answers are held until the quiz window closes", () => {
  const view = async (over: Record<string, unknown>, remaining: number | null = 1) => {
    const assessment = await m.assessment();
    m.assessment.mockResolvedValue({ ...assessment, feedbackBehaviour: "ON_RELEASE", ...over });
    m.results.mockResolvedValue({
      attemptsRemaining: remaining,
      attempts: [{ attemptId: "new", attemptNumber: 2, status: "SUBMITTED", passed: true, perQuestion: [{ correct: false, correctOptionIds: ["key"], explanation: "secret" }] }],
    });
    return loadLearnerQuiz(actor, { enrolmentId: "e", lessonId: "l" });
  };

  it("an open window holds the answers, even after passing — the score and which were wrong still show", async () => {
    const v = await view({ availableUntil: new Date(Date.now() + 86_400_000) });
    expect(JSON.stringify(v)).not.toMatch(/"key"|secret/);
    expect(v?.result?.perQuestion[0]).toMatchObject({ correct: false, correctOptionIds: [], explanation: null });
    expect(v?.answersRevealed).toBe(false);
  });

  it("once the window has closed the answers are shown", async () => {
    const v = await view({ availableUntil: new Date(Date.now() - 60_000) });
    expect(v?.result?.perQuestion[0]).toMatchObject({ correctOptionIds: ["key"], explanation: "secret" });
    expect(v?.answersRevealed).toBe(true);
  });

  it("no closing date: held while attempts remain, shown once none remain", async () => {
    expect(JSON.stringify(await view({ availableUntil: null }, 1))).not.toMatch(/"key"|secret/);
    expect((await view({ availableUntil: null }, 0))?.answersRevealed).toBe(true);
  });

  it("no closing date and unlimited attempts: never shown", async () => {
    expect(JSON.stringify(await view({ availableUntil: null, maxAttempts: null }, null))).not.toMatch(/"key"|secret/);
  });

  it("IMMEDIATE is unchanged: answers show straight away", async () => {
    const v = await view({ feedbackBehaviour: "IMMEDIATE", availableUntil: new Date(Date.now() + 86_400_000) });
    expect(v?.result?.perQuestion[0]).toMatchObject({ correctOptionIds: ["key"] });
  });
});
