/**
 * The pure quiz-scoring core (ASM-02, D-02, D-09).
 *
 * PURE MODULE — zero runtime imports, and in fact zero import statements at
 * all: every type this module needs is declared locally rather than pulled
 * in via `import type`, so there is nothing for `tests/boundary.test.ts`'s
 * runtime-import-closure walk to find. A type-only import would not enter
 * that closure either (the walk already skips `isTypeOnly` clauses, same as
 * `completion-engine.ts`), but declaring the shapes locally keeps this
 * module self-contained and removes even the possibility of a future edit
 * accidentally upgrading a type-only import to a runtime one.
 *
 * This module must NEVER import `@prisma/client` or `withPermission` (or
 * anything that transitively imports them). It reads only the snapshot
 * passed to `scoreAttempt` and the scored-attempt records passed to
 * `selectEffectiveAttempt` — no database read, no clock, no random, no
 * permission check. That is what makes ASM-02's "reproducible calculation"
 * provable rather than merely asserted in a comment: `tests/quiz-scoring.test.ts`
 * scores the same input twice and asserts the results are deeply equal, and
 * a purity gate (mirroring `learning-phase-invariants.test.ts`'s use of
 * `runtimeImports` from `tests/import-graph.ts`) asserts this file's runtime
 * import list is empty. T-10-01/T-10-08/T-10-12 (10-02-PLAN.md threat model)
 * are all mitigated by this module's shape, not by a runtime check.
 *
 * Rounding rule (applied in exactly one place each, so it cannot drift):
 *   - `roundToTwoDecimals` rounds a single question's awarded marks to 2
 *     decimal places BEFORE summing — this is what keeps D-09's
 *     `M * max(0, (S - W) / C)` fraction from carrying binary-float noise
 *     into the total.
 *   - `roundToInteger` rounds the final summed `score` (and an AVERAGE
 *     selection's synthesised score/maxScore) to the nearest integer,
 *     because `Grade.score` and `Attempt.score` are both Prisma `Int`
 *     columns.
 */

export type OptionSnapshot = {
  id: string;
  position: number;
  label: string;
  isCorrect: boolean;
};

export type QuestionSnapshot = {
  id: string;
  position: number;
  prompt: string;
  type: "SINGLE_CHOICE" | "MULTI_CHOICE" | "TRUE_FALSE";
  marks: number;
  explanation: string | null;
  options: OptionSnapshot[];
};

export type AttemptResponse = {
  questionId: string;
  selectedOptionIds: string[];
};

export type AttemptScore = {
  score: number;
  maxScore: number;
  passed: boolean | null;
  perQuestion: Array<{
    questionId: string;
    awarded: number;
    marks: number;
    correct: boolean;
  }>;
};

/**
 * The input `scoreAttempt` accepts. Deliberately carries ONLY raw option-id
 * selections — no `score`, `maxScore`, or `passed` field is representable
 * here at all (T-10-01, 10-RESEARCH.md Pitfall 1). A learner-supplied
 * payload can request scoring only by naming which options it selected; it
 * cannot set the outcome, even by accident, because the type makes that
 * unrepresentable rather than merely unchecked at runtime.
 */
export type ScoreAttemptInput = {
  questions: QuestionSnapshot[];
  responses: AttemptResponse[];
  passMark: number | null;
};

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToInteger(value: number): number {
  return Math.round(value);
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Selected option ids, deduplicated and filtered to ids that actually exist on this question's snapshot — an unknown id is ignored, never counted, never throws. */
function validSelectedIds(question: QuestionSnapshot, response: AttemptResponse | undefined): string[] {
  if (!response) return [];
  const knownIds = new Set(question.options.map((option) => option.id));
  return dedupe(response.selectedOptionIds).filter((id) => knownIds.has(id));
}

/** SINGLE_CHOICE and TRUE_FALSE share exact-single-correct-option semantics: exactly one selected id, and that id must be `isCorrect`. Anything else — zero selections, a wrong option, more than one selection — awards 0. */
function scoreExactSingleCorrect(question: QuestionSnapshot, response: AttemptResponse | undefined): number {
  const selected = validSelectedIds(question, response);
  if (selected.length !== 1) return 0;

  const option = question.options.find((candidate) => candidate.id === selected[0]);
  return option?.isCorrect ? question.marks : 0;
}

/** D-09's locked MULTI_CHOICE formula: `M * max(0, (S - W) / C)`, where M is the question's marks, C is the count of `isCorrect` options in the snapshot, S is the count of selected options that are correct, and W is the count of selected options that are not. `C === 0` (an authoring defect) is guarded before dividing and awards 0. */
function scoreMultiChoice(question: QuestionSnapshot, response: AttemptResponse | undefined): number {
  const correctOptionIds = new Set(
    question.options.filter((option) => option.isCorrect).map((option) => option.id),
  );
  const correctOptionCount = correctOptionIds.size;
  if (correctOptionCount === 0) return 0;

  const selected = validSelectedIds(question, response);
  const selectedCorrectCount = selected.filter((id) => correctOptionIds.has(id)).length;
  const selectedIncorrectCount = selected.length - selectedCorrectCount;

  const raw =
    question.marks * Math.max(0, (selectedCorrectCount - selectedIncorrectCount) / correctOptionCount);
  return roundToTwoDecimals(raw);
}

function scoreQuestion(question: QuestionSnapshot, response: AttemptResponse | undefined): number {
  switch (question.type) {
    case "SINGLE_CHOICE":
    case "TRUE_FALSE":
      return scoreExactSingleCorrect(question, response);
    case "MULTI_CHOICE":
      return scoreMultiChoice(question, response);
  }
}

/**
 * Scores a frozen question snapshot against a learner's raw option-id
 * selections. Only `questions` drives what is scored and what `maxScore`
 * is — a response naming a question id absent from the snapshot is ignored
 * entirely, and a snapshot question with no matching response is scored as
 * unanswered (0 awarded, its `marks` still counted into `maxScore`).
 * Calling this twice with the same input always returns deeply equal
 * results (no clock, no random, no data access).
 */
export function scoreAttempt(input: ScoreAttemptInput): AttemptScore {
  const responsesByQuestionId = new Map(input.responses.map((response) => [response.questionId, response]));

  const perQuestion = input.questions.map((question) => {
    const response = responsesByQuestionId.get(question.id);
    const awarded = scoreQuestion(question, response);
    return {
      questionId: question.id,
      awarded,
      marks: question.marks,
      correct: awarded === question.marks,
    };
  });

  const maxScore = input.questions.reduce((sum, question) => sum + question.marks, 0);
  const score = roundToInteger(perQuestion.reduce((sum, item) => sum + item.awarded, 0));

  return {
    score,
    maxScore,
    passed: input.passMark === null ? null : score >= input.passMark,
    perQuestion,
  };
}

/** The three `attemptGradingMethod` values (D-02). Declared as a local string union, NOT imported from `@prisma/client` — that import would break this module's purity. */
export type AttemptGradingMethod = "HIGHEST" | "LATEST" | "AVERAGE";

export type ScoredAttemptRecord = {
  attemptNumber: number;
  status: string;
  score: number | null;
  maxScore: number | null;
};

export type EffectiveAttemptResult = {
  attemptNumber: number | null;
  score: number;
  maxScore: number;
  passed: boolean | null;
};

/** Only `SUBMITTED` and `EXPIRED` attempts were ever actually scored: an `EXPIRED` attempt was auto-submitted and scored per the UI contract, while `IN_PROGRESS`/`ABANDONED` attempts never completed. Records missing a score/maxScore are excluded defensively even if their status qualifies. */
function eligibleAttempts(
  attempts: ScoredAttemptRecord[],
): Array<ScoredAttemptRecord & { score: number; maxScore: number }> {
  return attempts.filter(
    (attempt): attempt is ScoredAttemptRecord & { score: number; maxScore: number } =>
      (attempt.status === "SUBMITTED" || attempt.status === "EXPIRED") &&
      attempt.score !== null &&
      attempt.maxScore !== null,
  );
}

function recomputePassed(score: number, passMark: number | null): boolean | null {
  return passMark === null ? null : score >= passMark;
}

/**
 * Selects which of several scored attempts is the "effective" one shown to
 * the learner, used for pass/fail, and reported to staff (D-02). `passed`
 * on the result is ALWAYS recomputed from the resulting score against
 * `passMark` — never copied from an individual attempt — so an AVERAGE
 * synthesis can never report a "passed" verdict borrowed from one high
 * attempt. Returns `null` (never a zero-score result) when no attempt
 * qualifies.
 */
export function selectEffectiveAttempt(
  method: AttemptGradingMethod,
  passMark: number | null,
  attempts: ScoredAttemptRecord[],
): EffectiveAttemptResult | null {
  const eligible = eligibleAttempts(attempts);
  if (eligible.length === 0) return null;

  if (method === "HIGHEST") {
    // Tie-break: the earliest-numbered (lowest attemptNumber) of the tied
    // attempts wins — deterministic, and documented here rather than left
    // to insertion order.
    const winner = eligible.reduce((best, candidate) => {
      if (candidate.score > best.score) return candidate;
      if (candidate.score === best.score && candidate.attemptNumber < best.attemptNumber) return candidate;
      return best;
    });
    return {
      attemptNumber: winner.attemptNumber,
      score: winner.score,
      maxScore: winner.maxScore,
      passed: recomputePassed(winner.score, passMark),
    };
  }

  if (method === "LATEST") {
    const winner = eligible.reduce((latest, candidate) =>
      candidate.attemptNumber > latest.attemptNumber ? candidate : latest,
    );
    return {
      attemptNumber: winner.attemptNumber,
      score: winner.score,
      maxScore: winner.maxScore,
      passed: recomputePassed(winner.score, passMark),
    };
  }

  // AVERAGE: synthesised from every eligible attempt, so it belongs to none
  // of them — `attemptNumber` is null, matching `selectEffectiveAttempt`'s
  // contract.
  const averageScore = roundToInteger(
    eligible.reduce((sum, attempt) => sum + attempt.score, 0) / eligible.length,
  );
  const averageMaxScore = roundToInteger(
    eligible.reduce((sum, attempt) => sum + attempt.maxScore, 0) / eligible.length,
  );
  return {
    attemptNumber: null,
    score: averageScore,
    maxScore: averageMaxScore,
    passed: recomputePassed(averageScore, passMark),
  };
}
