import { describe, expect, it } from "vitest";
import {
  evaluateAssessmentReadiness,
  FEEDBACK_BEHAVIOURS,
  type AssessmentReadinessInput,
  type AssessmentReadinessQuestionInput,
} from "@/server/services/assessment-readiness";

function makeQuestion(
  overrides: Partial<AssessmentReadinessQuestionInput> = {},
): AssessmentReadinessQuestionInput {
  return {
    position: 0,
    prompt: "What is 2 + 2?",
    type: "SINGLE_CHOICE",
    marks: 1,
    options: [
      { position: 0, label: "3", isCorrect: false },
      { position: 1, label: "4", isCorrect: true },
    ],
    ...overrides,
  };
}

function makeQuiz(overrides: Partial<AssessmentReadinessInput> = {}): AssessmentReadinessInput {
  return {
    type: "QUIZ",
    title: "Sample Quiz",
    instructions: null,
    availableFrom: "2026-01-01T00:00:00.000Z",
    availableUntil: "2026-02-01T00:00:00.000Z",
    dueAt: null,
    maxAttempts: 3,
    passMark: 1,
    totalMarks: 1,
    attemptGradingMethod: "HIGHEST",
    feedbackBehaviour: "ON_RELEASE",
    allowedFileTypes: [],
    maxFileSizeBytes: null,
    allowResubmission: false,
    questions: [makeQuestion()],
    ...overrides,
  };
}

function makeAssignment(
  overrides: Partial<AssessmentReadinessInput> = {},
): AssessmentReadinessInput {
  return {
    type: "ASSIGNMENT",
    title: "Sample Assignment",
    instructions: "Submit a PDF report.",
    availableFrom: "2026-01-01T00:00:00.000Z",
    availableUntil: "2026-02-01T00:00:00.000Z",
    dueAt: "2026-01-25T00:00:00.000Z",
    maxAttempts: null,
    passMark: null,
    totalMarks: null,
    attemptGradingMethod: "HIGHEST",
    feedbackBehaviour: "ON_RELEASE",
    allowedFileTypes: ["pdf"],
    maxFileSizeBytes: 5_000_000,
    allowResubmission: true,
    questions: [],
    ...overrides,
  };
}

function find(items: ReturnType<typeof evaluateAssessmentReadiness>, id: string) {
  return items.find((item) => item.id === id);
}

function blockingFailureIds(items: ReturnType<typeof evaluateAssessmentReadiness>) {
  return items.filter((item) => item.state === "FAIL" && item.blocking).map((item) => item.id);
}

describe("evaluateAssessmentReadiness — FEEDBACK_BEHAVIOURS", () => {
  it("exports exactly ON_RELEASE, IMMEDIATE, NEVER", () => {
    expect(FEEDBACK_BEHAVIOURS).toEqual(["ON_RELEASE", "IMMEDIATE", "NEVER"]);
  });
});

describe("evaluateAssessmentReadiness — a fully valid QUIZ", () => {
  it("produces zero blocking items", () => {
    const items = evaluateAssessmentReadiness(makeQuiz());
    expect(blockingFailureIds(items)).toEqual([]);
  });
});

describe("evaluateAssessmentReadiness — a fully valid ASSIGNMENT", () => {
  it("produces zero blocking items", () => {
    const items = evaluateAssessmentReadiness(makeAssignment());
    expect(blockingFailureIds(items)).toEqual([]);
  });
});

describe("evaluateAssessmentReadiness — QUIZ questions", () => {
  it("blocks on zero questions", () => {
    const items = evaluateAssessmentReadiness(makeQuiz({ questions: [], totalMarks: null }));
    const item = find(items, "assessment.questions.present");
    expect(item?.state).toBe("FAIL");
    expect(item?.blocking).toBe(true);
  });

  it("blocks on a blank prompt, naming the question's position", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({ questions: [makeQuestion({ position: 2, prompt: "   " })] }),
    );
    const item = find(items, "assessment.question.2.prompt");
    expect(item?.state).toBe("FAIL");
    expect(item?.blocking).toBe(true);
  });

  it("blocks a SINGLE_CHOICE question with zero correct options", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        questions: [
          makeQuestion({
            type: "SINGLE_CHOICE",
            options: [
              { position: 0, label: "A", isCorrect: false },
              { position: 1, label: "B", isCorrect: false },
            ],
          }),
        ],
      }),
    );
    expect(find(items, "assessment.question.0.correct-option-count")?.state).toBe("FAIL");
  });

  it("blocks a SINGLE_CHOICE question with two correct options", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        questions: [
          makeQuestion({
            type: "SINGLE_CHOICE",
            options: [
              { position: 0, label: "A", isCorrect: true },
              { position: 1, label: "B", isCorrect: true },
            ],
          }),
        ],
      }),
    );
    expect(find(items, "assessment.question.0.correct-option-count")?.state).toBe("FAIL");
  });

  it("blocks a TRUE_FALSE question with zero correct options", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        questions: [
          makeQuestion({
            type: "TRUE_FALSE",
            options: [
              { position: 0, label: "True", isCorrect: false },
              { position: 1, label: "False", isCorrect: false },
            ],
          }),
        ],
      }),
    );
    expect(find(items, "assessment.question.0.correct-option-count")?.state).toBe("FAIL");
  });

  it("passes a TRUE_FALSE question with exactly one correct option", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        questions: [
          makeQuestion({
            type: "TRUE_FALSE",
            options: [
              { position: 0, label: "True", isCorrect: true },
              { position: 1, label: "False", isCorrect: false },
            ],
          }),
        ],
      }),
    );
    expect(find(items, "assessment.question.0.correct-option-count")?.state).toBe("PASS");
  });

  it("blocks a MULTI_CHOICE question with zero correct options", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        questions: [
          makeQuestion({
            type: "MULTI_CHOICE",
            options: [
              { position: 0, label: "A", isCorrect: false },
              { position: 1, label: "B", isCorrect: false },
            ],
          }),
        ],
      }),
    );
    expect(find(items, "assessment.question.0.correct-option-count")?.state).toBe("FAIL");
  });

  it("passes a MULTI_CHOICE question with two correct options", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        questions: [
          makeQuestion({
            type: "MULTI_CHOICE",
            options: [
              { position: 0, label: "A", isCorrect: true },
              { position: 1, label: "B", isCorrect: true },
            ],
          }),
        ],
      }),
    );
    expect(find(items, "assessment.question.0.correct-option-count")?.state).toBe("PASS");
  });

  it("blocks a question with fewer than two options", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        questions: [
          makeQuestion({ options: [{ position: 0, label: "Only one", isCorrect: true }] }),
        ],
      }),
    );
    expect(find(items, "assessment.question.0.option-count")?.state).toBe("FAIL");
  });

  it("blocks a question with marks less than 1", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({ questions: [makeQuestion({ marks: 0 })], totalMarks: 0 }),
    );
    expect(find(items, "assessment.question.0.marks")?.state).toBe("FAIL");
  });

  it("blocks when totalMarks is set and differs from the sum of question marks, naming both figures", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({ questions: [makeQuestion({ marks: 1 })], totalMarks: 5 }),
    );
    const item = find(items, "assessment.total-marks-match");
    expect(item?.state).toBe("FAIL");
    expect(item?.blocking).toBe(true);
    expect(item?.detail).toContain("5");
    expect(item?.detail).toContain("1");
  });

  it("passes when totalMarks matches the sum of question marks", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        questions: [makeQuestion({ position: 0, marks: 2 }), makeQuestion({ position: 1, marks: 3 })],
        totalMarks: 5,
      }),
    );
    expect(find(items, "assessment.total-marks-match")?.state).toBe("PASS");
  });
});

describe("evaluateAssessmentReadiness — passMark / totalMarks (both types)", () => {
  it("blocks when passMark exceeds totalMarks on a QUIZ", () => {
    const items = evaluateAssessmentReadiness(makeQuiz({ passMark: 10, totalMarks: 1 }));
    const item = find(items, "assessment.pass-mark");
    expect(item?.state).toBe("FAIL");
    expect(item?.blocking).toBe(true);
  });

  it("blocks when passMark exceeds totalMarks on an ASSIGNMENT", () => {
    const items = evaluateAssessmentReadiness(
      makeAssignment({ passMark: 10, totalMarks: 5 }),
    );
    expect(find(items, "assessment.pass-mark")?.state).toBe("FAIL");
  });

  it("warns (non-blocking) when passMark is null", () => {
    const items = evaluateAssessmentReadiness(makeQuiz({ passMark: null }));
    const item = find(items, "assessment.pass-mark");
    expect(item?.state).toBe("WARN");
    expect(blockingFailureIds(items)).not.toContain("assessment.pass-mark");
  });
});

describe("evaluateAssessmentReadiness — maxAttempts / attemptGradingMethod", () => {
  it("blocks when maxAttempts is less than 1", () => {
    const items = evaluateAssessmentReadiness(makeQuiz({ maxAttempts: 0 }));
    expect(find(items, "assessment.max-attempts")?.state).toBe("FAIL");
  });

  it("treats a null maxAttempts as unlimited and passes", () => {
    const items = evaluateAssessmentReadiness(makeQuiz({ maxAttempts: null }));
    expect(find(items, "assessment.max-attempts")?.state).toBe("PASS");
  });

  it("attemptGradingMethod never blocks", () => {
    const items = evaluateAssessmentReadiness(makeQuiz({ maxAttempts: 1 }));
    expect(find(items, "assessment.attempt-grading-method")?.blocking).toBe(false);
  });

  it("attemptGradingMethod warns (non-blocking) when maxAttempts is exactly 1", () => {
    const items = evaluateAssessmentReadiness(makeQuiz({ maxAttempts: 1 }));
    expect(find(items, "assessment.attempt-grading-method")?.state).toBe("WARN");
  });

  it("attemptGradingMethod passes when maxAttempts is greater than 1", () => {
    const items = evaluateAssessmentReadiness(makeQuiz({ maxAttempts: 3 }));
    expect(find(items, "assessment.attempt-grading-method")?.state).toBe("PASS");
  });
});

describe("evaluateAssessmentReadiness — feedbackBehaviour", () => {
  it("blocks a value outside FEEDBACK_BEHAVIOURS", () => {
    const items = evaluateAssessmentReadiness(makeQuiz({ feedbackBehaviour: "ALWAYS" }));
    const item = find(items, "assessment.feedback-behaviour");
    expect(item?.state).toBe("FAIL");
    expect(item?.blocking).toBe(true);
  });

  it("passes each documented value", () => {
    for (const value of FEEDBACK_BEHAVIOURS) {
      const items = evaluateAssessmentReadiness(makeQuiz({ feedbackBehaviour: value }));
      expect(find(items, "assessment.feedback-behaviour")?.state).toBe("PASS");
    }
  });
});

describe("evaluateAssessmentReadiness — ASSIGNMENT-only checks", () => {
  it("blocks an empty allowedFileTypes array", () => {
    const items = evaluateAssessmentReadiness(makeAssignment({ allowedFileTypes: [] }));
    expect(find(items, "assessment.assignment.file-types")?.state).toBe("FAIL");
  });

  it("blocks a null maxFileSizeBytes", () => {
    const items = evaluateAssessmentReadiness(makeAssignment({ maxFileSizeBytes: null }));
    expect(find(items, "assessment.assignment.file-size")?.state).toBe("FAIL");
  });

  it("blocks a maxFileSizeBytes less than 1", () => {
    const items = evaluateAssessmentReadiness(makeAssignment({ maxFileSizeBytes: 0 }));
    expect(find(items, "assessment.assignment.file-size")?.state).toBe("FAIL");
  });

  it("blocks blank instructions", () => {
    const items = evaluateAssessmentReadiness(makeAssignment({ instructions: "   " }));
    expect(find(items, "assessment.assignment.instructions")?.state).toBe("FAIL");
  });
});

describe("evaluateAssessmentReadiness — availability window (both types)", () => {
  it("blocks when availableFrom is later than availableUntil on a QUIZ", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        availableFrom: "2026-03-01T00:00:00.000Z",
        availableUntil: "2026-02-01T00:00:00.000Z",
      }),
    );
    const item = find(items, "assessment.availability-window");
    expect(item?.state).toBe("FAIL");
    expect(item?.blocking).toBe(true);
  });

  it("blocks when availableFrom is later than availableUntil on an ASSIGNMENT", () => {
    const items = evaluateAssessmentReadiness(
      makeAssignment({
        availableFrom: "2026-03-01T00:00:00.000Z",
        availableUntil: "2026-02-01T00:00:00.000Z",
      }),
    );
    expect(find(items, "assessment.availability-window")?.state).toBe("FAIL");
  });

  it("warns (non-blocking), does not block, when dueAt is later than availableUntil", () => {
    const items = evaluateAssessmentReadiness(
      makeQuiz({
        availableUntil: "2026-02-01T00:00:00.000Z",
        dueAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    const item = find(items, "assessment.due-date");
    expect(item?.state).toBe("WARN");
    expect(item?.blocking).toBe(false);
    expect(blockingFailureIds(items)).not.toContain("assessment.due-date");
  });
});

describe("evaluateAssessmentReadiness — purity", () => {
  it("returns identical results for identical input, called repeatedly (no clock, no database)", () => {
    const input = makeQuiz();
    const first = evaluateAssessmentReadiness(input);
    const second = evaluateAssessmentReadiness(input);
    expect(first).toEqual(second);
  });
});
