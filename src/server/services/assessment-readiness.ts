/**
 * The Assessment draft-validation evaluator (ASM-01, ASM-03).
 *
 * Pure module: no data-access import, no clock read. Mirrors
 * `readiness-service.ts`'s single-evaluator discipline — this function has
 * (at least) two call sites, the authoring panel's rendered checklist
 * (plan 10-08) and `publishAssessment`'s server-side publish refusal
 * (`assessment-service.ts`), and they must never be able to drift apart. A
 * UI-only copy would leave the server-side gate unenforced; a server-only
 * copy would leave the authoring panel unable to show staff what is wrong
 * before they attempt to publish.
 */

import type { ReadinessCategory, ReadinessItem, ReadinessState } from "./readiness-service";

/**
 * `Assessment.feedbackBehaviour` is a raw `String @default("ON_RELEASE")` in
 * Prisma, NOT an enum — Prisma enforces nothing on it. This allow-list is
 * the only place the closed set is enforced, the same way `isPermission`
 * guards the permission catalogue (10-RESEARCH.md Anti-Patterns). Per A4 in
 * 10-RESEARCH.md's Assumptions Log, this field controls how much detail a
 * learner sees after D-01's automatic quiz release, not whether release
 * happens.
 */
export const FEEDBACK_BEHAVIOURS = Object.freeze(["ON_RELEASE", "IMMEDIATE", "NEVER"] as const);
export type FeedbackBehaviour = (typeof FEEDBACK_BEHAVIOURS)[number];

export type AssessmentReadinessOptionInput = {
  position: number;
  label: string;
  isCorrect: boolean;
};

export type AssessmentReadinessQuestionInput = {
  position: number;
  prompt: string;
  /** `QuestionType`: `"SINGLE_CHOICE" | "MULTI_CHOICE" | "TRUE_FALSE"`, carried
   *  as a plain string so this module takes no Prisma-generated-type import. */
  type: string;
  marks: number;
  options: AssessmentReadinessOptionInput[];
};

export type AssessmentReadinessInput = {
  type: "QUIZ" | "ASSIGNMENT";
  title: string | null;
  instructions: string | null;
  availableFrom: Date | string | null;
  availableUntil: Date | string | null;
  dueAt: Date | string | null;
  maxAttempts: number | null;
  passMark: number | null;
  totalMarks: number | null;
  attemptGradingMethod: string;
  feedbackBehaviour: string;
  allowedFileTypes: string[];
  maxFileSizeBytes: number | null;
  allowResubmission: boolean;
  questions: AssessmentReadinessQuestionInput[];
};

function blank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

/** Converts a Date-or-ISO-string field to epoch millis, or `null` when the
 *  field is absent/unparsable. Never reads the clock — only parses the
 *  caller-supplied value. */
function toTime(value: Date | string | null): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

const CONTENT: ReadinessCategory = "Content";
const GRADING: ReadinessCategory = "Grading";
const SCHEDULE: ReadinessCategory = "Schedule";

/**
 * Evaluates an Assessment draft's readiness to publish. Every bullet in the
 * plan's `<behavior>` block corresponds to exactly one item below (or one
 * item per question, for the per-question checks). Never reads a database
 * or the clock — every fact it needs is on `input`.
 */
export function evaluateAssessmentReadiness(input: AssessmentReadinessInput): ReadinessItem[] {
  const items: ReadinessItem[] = [];

  if (input.type === "QUIZ") {
    items.push({
      id: "assessment.questions.present",
      category: CONTENT,
      label: "At least one question",
      blocking: true,
      state: input.questions.length > 0 ? "PASS" : "FAIL",
      detail: input.questions.length > 0 ? undefined : "This quiz has no questions yet.",
    });

    for (const question of input.questions) {
      const promptOk = !blank(question.prompt);
      items.push({
        id: `assessment.question.${question.position}.prompt`,
        category: CONTENT,
        label: `Question ${question.position + 1}: prompt`,
        blocking: true,
        state: promptOk ? "PASS" : "FAIL",
        detail: promptOk
          ? undefined
          : `Question at position ${question.position} has a blank prompt.`,
      });

      const optionCountOk = question.options.length >= 2;
      items.push({
        id: `assessment.question.${question.position}.option-count`,
        category: CONTENT,
        label: `Question ${question.position + 1}: at least two options`,
        blocking: true,
        state: optionCountOk ? "PASS" : "FAIL",
        detail: optionCountOk
          ? undefined
          : `Question at position ${question.position} has fewer than two options.`,
      });

      const correctCount = question.options.filter((option) => option.isCorrect).length;
      const correctOptionCountOk =
        question.type === "MULTI_CHOICE" ? correctCount >= 1 : correctCount === 1;
      items.push({
        id: `assessment.question.${question.position}.correct-option-count`,
        category: CONTENT,
        label: `Question ${question.position + 1}: correct option count`,
        blocking: true,
        state: correctOptionCountOk ? "PASS" : "FAIL",
        detail: correctOptionCountOk
          ? undefined
          : `Question at position ${question.position} (${question.type}) has ${correctCount} option(s) marked correct.`,
      });

      const marksOk = question.marks >= 1;
      items.push({
        id: `assessment.question.${question.position}.marks`,
        category: CONTENT,
        label: `Question ${question.position + 1}: marks`,
        blocking: true,
        state: marksOk ? "PASS" : "FAIL",
        detail: marksOk
          ? undefined
          : `Question at position ${question.position} has marks less than 1.`,
      });
    }

    const sumOfMarks = input.questions.reduce((total, question) => total + question.marks, 0);
    const totalMarksOk = input.totalMarks == null || input.totalMarks === sumOfMarks;
    items.push({
      id: "assessment.total-marks-match",
      category: CONTENT,
      label: "Total marks match the sum of question marks",
      blocking: true,
      state: totalMarksOk ? "PASS" : "FAIL",
      detail: totalMarksOk
        ? undefined
        : `Total marks is set to ${input.totalMarks}, but the questions sum to ${sumOfMarks}.`,
    });
  }

  if (input.type === "ASSIGNMENT") {
    const fileTypesOk = input.allowedFileTypes.length > 0;
    items.push({
      id: "assessment.assignment.file-types",
      category: CONTENT,
      label: "At least one permitted file type",
      blocking: true,
      state: fileTypesOk ? "PASS" : "FAIL",
      detail: fileTypesOk ? undefined : "No permitted file types are set.",
    });

    const fileSizeOk = input.maxFileSizeBytes != null && input.maxFileSizeBytes >= 1;
    items.push({
      id: "assessment.assignment.file-size",
      category: CONTENT,
      label: "Maximum file size set",
      blocking: true,
      state: fileSizeOk ? "PASS" : "FAIL",
      detail: fileSizeOk ? undefined : "The maximum file size is not set to a positive value.",
    });

    const instructionsOk = !blank(input.instructions);
    items.push({
      id: "assessment.assignment.instructions",
      category: CONTENT,
      label: "Instructions provided",
      blocking: true,
      state: instructionsOk ? "PASS" : "FAIL",
      detail: instructionsOk ? undefined : "This assignment has no instructions yet.",
    });
  }

  // passMark — both types. Null is allowed (an ungraded-threshold
  // assessment) but worth surfacing; a passMark above totalMarks is a hard
  // defect regardless of type.
  let passMarkState: ReadinessState;
  let passMarkDetail: string | undefined;
  if (input.passMark == null) {
    passMarkState = "WARN";
    passMarkDetail = "No pass mark is set — this assessment has no pass/fail threshold.";
  } else if (input.totalMarks != null && input.passMark > input.totalMarks) {
    passMarkState = "FAIL";
    passMarkDetail = `Pass mark ${input.passMark} exceeds total marks ${input.totalMarks}.`;
  } else {
    passMarkState = "PASS";
  }
  items.push({
    id: "assessment.pass-mark",
    category: GRADING,
    label: "Pass mark",
    blocking: true,
    state: passMarkState,
    detail: passMarkDetail,
  });

  // maxAttempts — both types. Null means unlimited and passes.
  const maxAttemptsOk = input.maxAttempts == null || input.maxAttempts >= 1;
  items.push({
    id: "assessment.max-attempts",
    category: GRADING,
    label: "Maximum attempts",
    blocking: true,
    state: maxAttemptsOk ? "PASS" : "FAIL",
    detail: maxAttemptsOk ? undefined : "Maximum attempts must be at least 1 (or left unlimited).",
  });

  // attemptGradingMethod is always present (schema default HIGHEST) so it
  // never blocks; it is only worth a non-blocking nudge when maxAttempts is
  // exactly 1, where the setting has no effect (D-02).
  items.push({
    id: "assessment.attempt-grading-method",
    category: GRADING,
    label: "Attempt grading method",
    blocking: false,
    state: input.maxAttempts === 1 ? "WARN" : "PASS",
    detail:
      input.maxAttempts === 1
        ? "This setting has no effect when only a single attempt is allowed."
        : undefined,
  });

  // feedbackBehaviour — both types. The Prisma column has no closed-set
  // constraint, so this is the trust-boundary check (T-10-13).
  const feedbackOk = (FEEDBACK_BEHAVIOURS as readonly string[]).includes(input.feedbackBehaviour);
  items.push({
    id: "assessment.feedback-behaviour",
    category: GRADING,
    label: "Feedback behaviour",
    blocking: true,
    state: feedbackOk ? "PASS" : "FAIL",
    detail: feedbackOk
      ? undefined
      : `"${input.feedbackBehaviour}" is not one of the allowed feedback behaviours.`,
  });

  // availableFrom / availableUntil — both types.
  const fromMs = toTime(input.availableFrom);
  const untilMs = toTime(input.availableUntil);
  const windowOk = fromMs == null || untilMs == null || fromMs <= untilMs;
  items.push({
    id: "assessment.availability-window",
    category: SCHEDULE,
    label: "Availability window",
    blocking: true,
    state: windowOk ? "PASS" : "FAIL",
    detail: windowOk ? undefined : "The available-from date is later than the available-until date.",
  });

  // dueAt vs availableUntil (D-03) — informational only, never blocking.
  const dueMs = toTime(input.dueAt);
  const dueOk = dueMs == null || untilMs == null || dueMs <= untilMs;
  items.push({
    id: "assessment.due-date",
    category: SCHEDULE,
    label: "Due date within the availability window",
    blocking: false,
    state: dueOk ? "PASS" : "WARN",
    detail: dueOk
      ? undefined
      : "The due date is later than the availability window's cutoff — the window still governs access.",
  });

  return items;
}
