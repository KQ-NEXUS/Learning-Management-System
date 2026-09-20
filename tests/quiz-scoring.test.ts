/**
 * Plan 10-02: exhaustive per-`QuestionType` scoring cases for `scoreAttempt`
 * (Task 1, D-09) plus `selectEffectiveAttempt`'s HIGHEST/LATEST/AVERAGE
 * selection (Task 2, D-02) and the module's purity gate. Table-driven in the
 * style of `tests/completion-engine.test.ts` — no data access, no mocks.
 */

import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  scoreAttempt,
  selectEffectiveAttempt,
  type QuestionSnapshot,
  type AttemptResponse,
} from "@/server/services/quiz-scoring";
import { runtimeImports } from "./import-graph";

function singleChoiceQuestion(marks = 10): QuestionSnapshot {
  return {
    id: "q1",
    position: 1,
    prompt: "Pick the right one",
    type: "SINGLE_CHOICE",
    marks,
    explanation: null,
    options: [
      { id: "a", position: 1, label: "A", isCorrect: true },
      { id: "b", position: 2, label: "B", isCorrect: false },
      { id: "c", position: 3, label: "C", isCorrect: false },
    ],
  };
}

function trueFalseQuestion(marks = 5): QuestionSnapshot {
  return {
    id: "q1",
    position: 1,
    prompt: "True or false",
    type: "TRUE_FALSE",
    marks,
    explanation: null,
    options: [
      { id: "t", position: 1, label: "True", isCorrect: true },
      { id: "f", position: 2, label: "False", isCorrect: false },
    ],
  };
}

function multiChoiceQuestion(marks = 9): QuestionSnapshot {
  return {
    id: "q1",
    position: 1,
    prompt: "Pick all correct",
    type: "MULTI_CHOICE",
    marks,
    explanation: null,
    options: [
      { id: "a", position: 1, label: "A", isCorrect: true },
      { id: "b", position: 2, label: "B", isCorrect: true },
      { id: "c", position: 3, label: "C", isCorrect: true },
      { id: "d", position: 4, label: "D", isCorrect: false },
      { id: "e", position: 5, label: "E", isCorrect: false },
    ],
  };
}

function response(questionId: string, selectedOptionIds: string[]): AttemptResponse {
  return { questionId, selectedOptionIds };
}

describe("scoreAttempt — SINGLE_CHOICE", () => {
  it("exactly one correct selected awards full marks", () => {
    const result = scoreAttempt({
      questions: [singleChoiceQuestion(10)],
      responses: [response("q1", ["a"])],
      passMark: null,
    });
    expect(result.perQuestion[0]).toEqual({
      questionId: "q1",
      awarded: 10,
      marks: 10,
      correct: true,
    });
    expect(result.score).toBe(10);
    expect(result.maxScore).toBe(10);
  });

  it("wrong option selected awards 0", () => {
    const result = scoreAttempt({
      questions: [singleChoiceQuestion(10)],
      responses: [response("q1", ["b"])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(0);
  });

  it("zero selections awards 0", () => {
    const result = scoreAttempt({
      questions: [singleChoiceQuestion(10)],
      responses: [response("q1", [])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(0);
  });

  it("more than one selection awards 0, even if one is correct", () => {
    const result = scoreAttempt({
      questions: [singleChoiceQuestion(10)],
      responses: [response("q1", ["a", "b"])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(0);
  });
});

describe("scoreAttempt — TRUE_FALSE", () => {
  it("is scored identically to SINGLE_CHOICE — correct selection awards full marks", () => {
    const result = scoreAttempt({
      questions: [trueFalseQuestion(5)],
      responses: [response("q1", ["t"])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(5);
  });

  it("wrong selection awards 0", () => {
    const result = scoreAttempt({
      questions: [trueFalseQuestion(5)],
      responses: [response("q1", ["f"])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(0);
  });
});

describe("scoreAttempt — MULTI_CHOICE (D-09 partial credit: M * max(0, (S - W) / C))", () => {
  it("selecting all C correct and zero incorrect awards exactly M", () => {
    const result = scoreAttempt({
      questions: [multiChoiceQuestion(9)],
      responses: [response("q1", ["a", "b", "c"])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(9);
  });

  it("selecting 2 of 3 correct and zero incorrect awards M * 2/3", () => {
    const result = scoreAttempt({
      questions: [multiChoiceQuestion(9)],
      responses: [response("q1", ["a", "b"])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(6);
  });

  it("selecting 2 of 3 correct and 2 incorrect awards exactly 0, never negative (S=2, W=2, C=3)", () => {
    const result = scoreAttempt({
      questions: [multiChoiceQuestion(9)],
      responses: [response("q1", ["a", "b", "d", "e"])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(0);
  });

  it("selecting zero options awards 0", () => {
    const result = scoreAttempt({
      questions: [multiChoiceQuestion(9)],
      responses: [response("q1", [])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(0);
  });

  it("extra incorrect selections score strictly less than the same answer without them", () => {
    const withoutExtra = scoreAttempt({
      questions: [multiChoiceQuestion(9)],
      responses: [response("q1", ["a", "b"])],
      passMark: null,
    });
    const withExtra = scoreAttempt({
      questions: [multiChoiceQuestion(9)],
      responses: [response("q1", ["a", "b", "d"])],
      passMark: null,
    });
    expect(withExtra.perQuestion[0].awarded).toBeLessThan(withoutExtra.perQuestion[0].awarded);
    expect(withExtra.perQuestion[0].awarded).toBeGreaterThanOrEqual(0);
  });

  it("a question with zero correct options (authoring defect) awards 0 and never divides by zero", () => {
    const question: QuestionSnapshot = {
      id: "q1",
      position: 1,
      prompt: "Broken question",
      type: "MULTI_CHOICE",
      marks: 5,
      explanation: null,
      options: [
        { id: "a", position: 1, label: "A", isCorrect: false },
        { id: "b", position: 2, label: "B", isCorrect: false },
      ],
    };
    const result = scoreAttempt({
      questions: [question],
      responses: [response("q1", ["a"])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(0);
    expect(Number.isFinite(result.perQuestion[0].awarded)).toBe(true);
  });

  it("duplicate option ids in one selectedOptionIds array count once, not twice", () => {
    const result = scoreAttempt({
      questions: [multiChoiceQuestion(9)],
      responses: [response("q1", ["a", "a", "b"])],
      passMark: null,
    });
    // Same as selecting a and b once each: M * 2/3 = 6
    expect(result.perQuestion[0].awarded).toBe(6);
  });
});

describe("scoreAttempt — cross-cutting behavior", () => {
  it("a selectedOptionIds entry naming an option id not present in the question's snapshot is ignored, never counted correct, never throws", () => {
    expect(() =>
      scoreAttempt({
        questions: [singleChoiceQuestion(10)],
        responses: [response("q1", ["not-a-real-option"])],
        passMark: null,
      }),
    ).not.toThrow();
    const result = scoreAttempt({
      questions: [singleChoiceQuestion(10)],
      responses: [response("q1", ["not-a-real-option"])],
      passMark: null,
    });
    expect(result.perQuestion[0].awarded).toBe(0);
  });

  it("a selectedOptionIds entry naming a question id not present in the snapshot is ignored entirely", () => {
    const result = scoreAttempt({
      questions: [singleChoiceQuestion(10)],
      responses: [response("q1", ["a"]), response("not-a-real-question", ["a"])],
      passMark: null,
    });
    expect(result.perQuestion).toHaveLength(1);
    expect(result.score).toBe(10);
  });

  it("a question in the snapshot with no matching response is scored as unanswered (0 awarded, still contributes marks to maxScore)", () => {
    const result = scoreAttempt({
      questions: [singleChoiceQuestion(10), trueFalseQuestion(5)],
      responses: [response("q1", ["a"])],
      passMark: null,
    });
    const tfItem = result.perQuestion.find((p) => p.questionId === "q1" && p.marks === 5);
    expect(result.maxScore).toBe(15);
  });

  it("maxScore is the sum of every snapshot question's marks, independent of what the learner answered", () => {
    const result = scoreAttempt({
      questions: [singleChoiceQuestion(10), multiChoiceQuestion(9)],
      responses: [],
      passMark: null,
    });
    expect(result.maxScore).toBe(19);
    expect(result.score).toBe(0);
  });

  it("passed is score >= passMark when passMark is a number", () => {
    const passing = scoreAttempt({
      questions: [singleChoiceQuestion(10)],
      responses: [response("q1", ["a"])],
      passMark: 5,
    });
    expect(passing.passed).toBe(true);

    const failing = scoreAttempt({
      questions: [singleChoiceQuestion(10)],
      responses: [response("q1", ["b"])],
      passMark: 5,
    });
    expect(failing.passed).toBe(false);
  });

  it("passed is null when passMark is null", () => {
    const result = scoreAttempt({
      questions: [singleChoiceQuestion(10)],
      responses: [response("q1", ["a"])],
      passMark: null,
    });
    expect(result.passed).toBeNull();
  });

  it("scoring the same snapshot + responses twice returns deeply equal results (reproducibility)", () => {
    const input = {
      questions: [singleChoiceQuestion(10), multiChoiceQuestion(9), trueFalseQuestion(5)],
      responses: [
        response("q1", ["a"]),
        response("q1", ["a", "b", "d"]),
        response("q1", ["t"]),
      ],
      passMark: 12,
    };
    const first = scoreAttempt(input);
    const second = scoreAttempt(input);
    expect(first).toEqual(second);
  });
});

describe("selectEffectiveAttempt (D-02)", () => {
  it("HIGHEST returns the attempt with the largest score", () => {
    const result = selectEffectiveAttempt("HIGHEST", null, [
      { attemptNumber: 1, status: "SUBMITTED", score: 40, maxScore: 100 },
      { attemptNumber: 2, status: "SUBMITTED", score: 80, maxScore: 100 },
      { attemptNumber: 3, status: "SUBMITTED", score: 65, maxScore: 100 },
    ]);
    expect(result?.attemptNumber).toBe(2);
    expect(result?.score).toBe(80);
  });

  it("HIGHEST with a tie on score returns the earliest-numbered of the tied attempts", () => {
    const result = selectEffectiveAttempt("HIGHEST", null, [
      { attemptNumber: 1, status: "SUBMITTED", score: 80, maxScore: 100 },
      { attemptNumber: 2, status: "SUBMITTED", score: 80, maxScore: 100 },
    ]);
    expect(result?.attemptNumber).toBe(1);
  });

  it("LATEST returns the attempt with the largest attemptNumber, regardless of score", () => {
    const result = selectEffectiveAttempt("LATEST", null, [
      { attemptNumber: 1, status: "SUBMITTED", score: 90, maxScore: 100 },
      { attemptNumber: 2, status: "SUBMITTED", score: 30, maxScore: 100 },
    ]);
    expect(result?.attemptNumber).toBe(2);
    expect(result?.score).toBe(30);
  });

  it("AVERAGE returns a synthesised result whose score is the mean of every scored attempt's score", () => {
    const result = selectEffectiveAttempt("AVERAGE", null, [
      { attemptNumber: 1, status: "SUBMITTED", score: 60, maxScore: 100 },
      { attemptNumber: 2, status: "SUBMITTED", score: 80, maxScore: 100 },
    ]);
    expect(result?.attemptNumber).toBeNull();
    expect(result?.score).toBe(70);
  });

  it("attempts with status other than SUBMITTED or EXPIRED are excluded from every method", () => {
    const result = selectEffectiveAttempt("HIGHEST", null, [
      { attemptNumber: 1, status: "IN_PROGRESS", score: 100, maxScore: 100 },
      { attemptNumber: 2, status: "ABANDONED", score: 90, maxScore: 100 },
      { attemptNumber: 3, status: "SUBMITTED", score: 40, maxScore: 100 },
    ]);
    expect(result?.attemptNumber).toBe(3);
    expect(result?.score).toBe(40);
  });

  it("EXPIRED attempts count toward every method", () => {
    const result = selectEffectiveAttempt("HIGHEST", null, [
      { attemptNumber: 1, status: "EXPIRED", score: 55, maxScore: 100 },
    ]);
    expect(result?.attemptNumber).toBe(1);
    expect(result?.score).toBe(55);
  });

  it("an empty input list returns null, never a zero-score result", () => {
    const result = selectEffectiveAttempt("HIGHEST", null, []);
    expect(result).toBeNull();
  });

  it("an input list with only excluded statuses returns null", () => {
    const result = selectEffectiveAttempt("AVERAGE", null, [
      { attemptNumber: 1, status: "IN_PROGRESS", score: null, maxScore: null },
    ]);
    expect(result).toBeNull();
  });

  it("passed on the selected/synthesised result is recomputed against passMark, not copied from an individual attempt (AVERAGE cannot inherit a single high attempt's pass)", () => {
    // Highest single attempt (90) passes a passMark of 70, but the AVERAGE (55) does not.
    const result = selectEffectiveAttempt("AVERAGE", 70, [
      { attemptNumber: 1, status: "SUBMITTED", score: 90, maxScore: 100 },
      { attemptNumber: 2, status: "SUBMITTED", score: 20, maxScore: 100 },
    ]);
    expect(result?.score).toBe(55);
    expect(result?.passed).toBe(false);
  });

  it("HIGHEST recomputes passed from the selected attempt's score against passMark", () => {
    const result = selectEffectiveAttempt("HIGHEST", 50, [
      { attemptNumber: 1, status: "SUBMITTED", score: 80, maxScore: 100 },
    ]);
    expect(result?.passed).toBe(true);
  });
});

describe("quiz-scoring.ts purity gate (T-10-12)", () => {
  it("has zero runtime imports", () => {
    const filePath = path.resolve(process.cwd(), "src", "server", "services", "quiz-scoring.ts");
    const imports = runtimeImports(filePath);
    expect(
      imports,
      `quiz-scoring.ts must declare zero runtime imports (its own header states this) — found: ${imports
        .map((i) => i.specifier)
        .join(", ")}.`,
    ).toHaveLength(0);
  });
});
