/**
 * The pure completion-rule evaluator (D-10, D-12, LRN-07).
 *
 * PURE MODULE — no runtime imports at all. `import type` only, for
 * `CompletionRuleV1` and `AttendanceComponent` — a type-only import does not
 * enter the runtime closure `tests/boundary.test.ts` walks (the walk
 * already skips `isTypeOnly` clauses), so this module stays off the worker
 * import closure exactly like `readiness-service.ts` and
 * `attendance-component.ts`.
 *
 * This module NEVER recomputes attendance. It consumes
 * `computeAttendanceComponent`'s output (from `attendance-component.ts`,
 * read via the `"attendance changed"` `DomainEvent` payload's `component`
 * field per that module's own instruction) — Phase 9 reads the payload,
 * it does not re-derive it.
 *
 * LRN-07 + UI-SPEC §7.1: the two D-10 rule components (required-lessons,
 * attendance) are NEVER collapsed into one composite percentage. LRN-07
 * requires each satisfied/unmet rule to be individually identified, and the
 * dashboard renders two independent, identically-styled bars — "the two
 * rule components are evaluated and displayed separately." A future Phase
 * 10 assessment rule type means appending one more item builder here plus
 * one more key in `completion-rule.ts`'s `RECOGNISED_V1_KEYS` (bumped to
 * v2) — not re-architecting this function.
 */

import type { CompletionRule } from "./completion-rule";
import type { AttendanceComponent } from "./attendance-component";

export type CompletionVerdictItem = {
  id: "required-lessons" | "attendance" | "assessments";
  label: string;
  satisfied: boolean;
  /**
   * `NOT_YET_CHECKED` is a THIRD state — neither a grey SATISFIED nor a
   * grey UNMET (same discipline as `readiness-service.ts`'s
   * `NOT_YET_CHECKED`). It marks evidence that has not been gathered yet
   * (no countable sessions, or the attendance component was never
   * computed) — this must never be silently read as a pass.
   */
  state: "SATISFIED" | "UNMET" | "NOT_YET_CHECKED";
  detail: string;
};

/** One pinned assessment's standing for this enrolment: `passed` is null when the assessment has no pass mark. */
export type AssessmentEvidence = { assessmentId: string; released: boolean; passed: boolean | null };

export type CompletionVerdict = {
  items: CompletionVerdictItem[];
  satisfied: boolean;
};

function buildRequiredLessonsItem(
  requiredLessonIds: string[],
  completedLessonIds: ReadonlySet<string>,
): CompletionVerdictItem {
  const total = requiredLessonIds.length;
  const completed = requiredLessonIds.filter((id) => completedLessonIds.has(id)).length;
  const satisfied = completed === total;

  return {
    id: "required-lessons",
    label: "All required lessons complete",
    satisfied,
    state: satisfied ? "SATISFIED" : "UNMET",
    detail: `${completed} of ${total} complete`,
  };
}

function buildAttendanceItem(attendance: AttendanceComponent | null): CompletionVerdictItem {
  if (attendance === null || attendance.kind === "no-sessions" || attendance.kind === "no-rule") {
    return {
      id: "attendance",
      label: "Attendance threshold met",
      satisfied: false,
      state: "NOT_YET_CHECKED",
      detail:
        attendance !== null && attendance.kind === "no-sessions"
          ? "No countable sessions exist yet — attendance cannot be evaluated"
          : "Attendance has not been evaluated yet",
    };
  }

  return {
    id: "attendance",
    label: "Attendance threshold met",
    satisfied: attendance.meetsThreshold,
    state: attendance.meetsThreshold ? "SATISFIED" : "UNMET",
    detail: `${attendance.earnedPct}% of ${attendance.requiredPct}% required`,
  };
}

function buildAssessmentsItem(assessments: AssessmentEvidence[] | undefined): CompletionVerdictItem {
  const label = "Required assessments passed";
  if (assessments === undefined) {
    return { id: "assessments", label, satisfied: false, state: "NOT_YET_CHECKED", detail: "Assessment results have not been evaluated yet" };
  }
  if (assessments.length === 0) {
    return { id: "assessments", label, satisfied: true, state: "SATISFIED", detail: "No assessments to pass" };
  }
  // A released result with no pass mark (passed === null) counts; a released fail or anything unreleased does not.
  const passed = assessments.filter((a) => a.released && a.passed !== false).length;
  const satisfied = passed === assessments.length;
  return {
    id: "assessments",
    label,
    satisfied,
    state: satisfied ? "SATISFIED" : "UNMET",
    detail: `${passed} of ${assessments.length} passed`,
  };
}

/**
 * Evaluates a v1/v2 `completionRule` against a learner's evidence, returning a
 * per-rule-component item list plus an overall satisfied boolean. Item
 * order is stable: required-lessons first, attendance second (when
 * present). An attendance item is emitted ONLY when
 * `rule.attendanceThresholdPct` is non-null — a cohort with no attendance
 * threshold produces no attendance item at all, never a fake pass.
 */
export function evaluateCompletion(
  rule: CompletionRule,
  evidence: {
    requiredLessonIds: string[];
    completedLessonIds: ReadonlySet<string>;
    attendance: AttendanceComponent | null;
    /** Required only for a v2 rule with `requirePassingAssessments`; absent means not gathered. */
    assessments?: AssessmentEvidence[];
  },
): CompletionVerdict {
  const items: CompletionVerdictItem[] = [
    buildRequiredLessonsItem(evidence.requiredLessonIds, evidence.completedLessonIds),
  ];

  if (rule.attendanceThresholdPct !== null) {
    items.push(buildAttendanceItem(evidence.attendance));
  }

  if (rule.version === 2 && rule.requirePassingAssessments) {
    items.push(buildAssessmentsItem(evidence.assessments));
  }

  return {
    items,
    satisfied: items.every((item) => item.satisfied),
  };
}
