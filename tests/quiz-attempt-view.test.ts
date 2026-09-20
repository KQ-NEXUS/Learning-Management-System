import { describe, expect, it } from "vitest";
import { toSafeQuizAttempt } from "@/server/services/learner-quiz-service";
import type { AttemptRow } from "@/server/services/attempt-service";

describe("quiz browser payload", () => {
  it("removes the answer key and explanations before serialization", () => {
    const attempt = { id: "a", status: "IN_PROGRESS", attemptNumber: 1, answers: {
      responses: [], questionSnapshot: [{ id: "q", prompt: "Choose", marks: 1, type: "SINGLE_CHOICE", explanation: "secret explanation", options: [{ id: "o", label: "Answer", isCorrect: true }] }],
    } } as unknown as AttemptRow;
    const view = toSafeQuizAttempt(attempt);
    expect(view.questions[0].options[0]).toEqual({ id: "o", label: "Answer" });
    expect(JSON.stringify(view)).not.toMatch(/isCorrect|explanation|secret/);
    expect(view.responses).toEqual([]);
  });
});
