import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuizAttemptPanel } from "@/components/learner/QuizAttemptPanel";
import type { LearnerQuizView, SafeQuizAttempt } from "@/server/services/learner-quiz-service";
vi.mock("@/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/assessment-actions", () => ({ startAttemptAction: vi.fn(), submitAttemptAction: vi.fn(), saveAttemptAnswersAction: vi.fn() }));
afterEach(cleanup);
const active: SafeQuizAttempt = { id: "a", attemptNumber: 1, responses: [], questions: [
  { id: "q1", prompt: "One?", type: "SINGLE_CHOICE", marks: 1, options: [{ id: "x", label: "First option" }, { id: "y", label: "Second option" }] },
  { id: "q2", prompt: "Two?", type: "MULTI_CHOICE", marks: 1, options: [{ id: "z", label: "Third option" }] },
] };
const base: LearnerQuizView = { assessmentId: "quiz", title: "Quiz title", instructions: null, availableFrom: null, availableUntil: null, maxAttempts: 2, passMark: 1, attemptsRemaining: 2, feedbackBehaviour: "IMMEDIATE", active: null, history: [], result: null };
function setup(overrides: Partial<LearnerQuizView> = {}) {
  const onStart = vi.fn(async () => ({ ok: true as const, attempt: active, history: [], attemptsRemaining: 1 }));
  const onSubmit = vi.fn(async () => ({ ok: true as const, result: { attemptId: "a", attemptNumber: 1, status: "SUBMITTED" as const, score: 2, maxScore: 2, passed: true, submittedAt: new Date(), perQuestion: [], expired: false } }));
  const view = render(<QuizAttemptPanel {...base} {...overrides} enrolmentId="e" lessonId="l" onStart={onStart} onSubmit={onSubmit} />);
  return { ...view, onStart, onSubmit };
}
describe("QuizAttemptPanel", () => {
  it("shows an abandoned attempt immediately from the start-new action reply", async () => {
    const abandoned = {
      attemptId: "old", attemptNumber: 1, status: "ABANDONED" as const,
      score: null, maxScore: null, passed: null, submittedAt: null,
      perQuestion: [], expired: false,
    };
    const onStart = vi.fn(async () => ({
      ok: true as const,
      attempt: { ...active, id: "new", attemptNumber: 2 },
      history: [abandoned],
      attemptsRemaining: 1,
    }));
    render(<QuizAttemptPanel {...base} active={active} enrolmentId="e" lessonId="l" onStart={onStart as never} />);

    fireEvent.click(screen.getByText("Start new attempt"));
    fireEvent.click(screen.getByText("Continue with new attempt"));

    await screen.findByText("Attempt 1");
    expect(screen.getByText("Abandoned")).toBeTruthy();
    expect(screen.getByText("Remaining").parentElement?.querySelector("dd")?.textContent).toBe("1");
  });

  it("renders timestamps with the deterministic shared formatter", () => {
    setup({
      availableFrom: "2026-01-01T00:00:00.000Z",
      history: [{ attemptId: "a", attemptNumber: 1, status: "SUBMITTED", score: 1, maxScore: 2, passed: false, submittedAt: new Date("2026-01-01T00:00:00.000Z"), perQuestion: [], expired: false }],
    });
    expect(screen.getAllByText("01/01/2026, 00:00:00")).toHaveLength(2);
  });

  it("offers a first start and a resume without an abandon notice", () => {
    const view = setup(); expect(screen.getByText("Start quiz")).toBeTruthy(); view.unmount();
    setup({ active }); expect(screen.getByText("Resume attempt")).toBeTruthy(); expect(screen.queryByText(/will abandon/)).toBeNull();
  });
  it("explains exhausted attempts without a start control", () => { setup({ attemptsRemaining: 0 }); expect(screen.getByText(/used all 2/)).toBeTruthy(); expect(screen.queryByText("Start quiz")).toBeNull(); });
  it("explains the closed window", () => { setup({ availableUntil: "2000-01-01" }); expect(screen.getByText(/window for this assessment has closed/)).toBeTruthy(); expect(screen.queryByText("Start quiz")).toBeNull(); });
  it("uses one form, native inputs and a live answered count; submits raw selections once", async () => {
    const { container, onSubmit } = setup(); fireEvent.click(screen.getByText("Start quiz")); await screen.findByText("One?");
    await screen.findByRole("button", { name: "Submit quiz" });
    expect(container.querySelectorAll("form")).toHaveLength(1); expect(screen.getAllByRole("radio")).toHaveLength(2); expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect((screen.getByText("Submit quiz") as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText("0 of 2 answered")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/Correct answer|isCorrect|text-success|text-danger/);
    fireEvent.click(screen.getByLabelText("First option")); fireEvent.click(screen.getByLabelText("Third option"));
    expect(screen.getByText("2 of 2 answered")).toBeTruthy(); expect((screen.getByText("Submit quiz") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText("Submit quiz")); await screen.findByText("2 / 2 (100%)");
    expect(onSubmit).toHaveBeenCalledTimes(1); expect(onSubmit.mock.calls[0]).toEqual([{ enrolmentId: "e", lessonId: "l", attemptId: "a", responses: [{ questionId: "q1", selectedOptionIds: ["x"] }, { questionId: "q2", selectedOptionIds: ["z"] }] }]);
  });
  it("uses a warning verdict and explains expiry", () => {
    setup({ result: { attemptId: "a", attemptNumber: 1, status: "EXPIRED", score: 0, maxScore: 2, passed: false, submittedAt: new Date(), perQuestion: [], expired: true } });
    expect(screen.getByText("Not yet passed").className).toContain("pill-amber"); expect(screen.getByText(/scored automatically/)).toBeTruthy();
  });
  it("shows abandoned history with no score", () => {
    setup({ history: [{ attemptId: "a", attemptNumber: 1, status: "ABANDONED", score: null, maxScore: null, passed: null, submittedAt: null, perQuestion: [], expired: false }] });
    expect(screen.getByText("Abandoned").className).toContain("pill-grey"); expect(screen.getAllByText("—").length).toBe(2);
  });
  it("keeps the form on submit failure and offers retry", async () => {
    render(<QuizAttemptPanel {...base} enrolmentId="e" lessonId="l" onStart={async () => ({ ok: true, attempt: active, history: [], attemptsRemaining: 1 })} onSubmit={async () => ({ ok: false, message: "Your quiz couldn't be submitted", body: "Your answers are saved — try submitting again." })} />);
    fireEvent.click(screen.getByText("Start quiz")); await screen.findByText("One?"); fireEvent.click(screen.getByLabelText("First option")); fireEvent.click(screen.getByLabelText("Third option")); fireEvent.click(screen.getByText("Submit quiz"));
    await waitFor(() => expect(screen.getByText("Try again")).toBeTruthy()); expect(screen.getByText(/answers are saved/)).toBeTruthy(); expect(screen.getByLabelText("First option")).toBeTruthy();
  });
});
