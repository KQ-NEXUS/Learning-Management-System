/**
 * Task 2 & Task 3 (plan 09-02): the v1 `completionRule` payload parser
 * (D-10, D-03/DD-3) and the pure completion-rule evaluator (D-10, D-12,
 * LRN-07).
 *
 * `describe("parseCompletionRule")` covers Task 2's shape/versioning
 * discipline. `describe("evaluateCompletion")` (added by Task 3) covers the
 * per-rule-item verdict evaluator. Mirrors the pure-evaluator test style of
 * `tests/readiness.test.ts` / `tests/attendance-component.test.ts`. No data
 * access.
 */

import { describe, expect, it } from "vitest";
import {
  parseCompletionRule,
  UnsupportedCompletionRuleFieldError,
  UnsupportedCompletionRuleVersionError,
  type CompletionRuleV1,
} from "@/server/services/completion-rule";
import { evaluateCompletion } from "@/server/services/completion-engine";
import type { AttendanceComponent } from "@/server/services/attendance-component";

describe("parseCompletionRule", () => {
  it("null json, ruleVersion 1, null cohort threshold -> v1 shape with attendanceThresholdPct: null", () => {
    const result = parseCompletionRule({
      json: null,
      ruleVersion: 1,
      cohortAttendanceThresholdPct: null,
    });
    expect(result).toEqual({
      version: 1,
      requireAllRequiredLessons: true,
      attendanceThresholdPct: null,
    });
  });

  it("null json still always requires all required lessons (D-10(a))", () => {
    const result = parseCompletionRule({
      json: null,
      ruleVersion: 1,
      cohortAttendanceThresholdPct: null,
    });
    expect(result.requireAllRequiredLessons).toBe(true);
  });

  it("cohortAttendanceThresholdPct 75 -> attendanceThresholdPct: 75", () => {
    const result = parseCompletionRule({
      json: null,
      ruleVersion: 1,
      cohortAttendanceThresholdPct: 75,
    });
    expect(result.attendanceThresholdPct).toBe(75);
  });

  it("json { version: 1, requireAllRequiredLessons: true } parses to the same v1 shape", () => {
    const result = parseCompletionRule({
      json: { version: 1, requireAllRequiredLessons: true },
      ruleVersion: 1,
      cohortAttendanceThresholdPct: 60,
    });
    expect(result).toEqual({
      version: 1,
      requireAllRequiredLessons: true,
      attendanceThresholdPct: 60,
    });
  });

  it("json { version: 2, ... } throws UnsupportedCompletionRuleVersionError, never falls back to v1", () => {
    expect(() =>
      parseCompletionRule({
        json: { version: 2, requireAllRequiredLessons: true },
        ruleVersion: 1,
        cohortAttendanceThresholdPct: null,
      }),
    ).toThrow(UnsupportedCompletionRuleVersionError);

    try {
      parseCompletionRule({
        json: { version: 2, requireAllRequiredLessons: true },
        ruleVersion: 1,
        cohortAttendanceThresholdPct: null,
      });
      expect.unreachable("expected parseCompletionRule to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedCompletionRuleVersionError);
      expect((err as UnsupportedCompletionRuleVersionError).version).toBe(2);
    }
  });

  it("json { version: 1, assessmentCriteria: [...] } throws UnsupportedCompletionRuleFieldError naming the unknown key", () => {
    try {
      parseCompletionRule({
        json: { version: 1, assessmentCriteria: [{ id: "q1" }] },
        ruleVersion: 1,
        cohortAttendanceThresholdPct: null,
      });
      expect.unreachable("expected parseCompletionRule to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedCompletionRuleFieldError);
      expect((err as UnsupportedCompletionRuleFieldError).key).toBe("assessmentCriteria");
    }
  });

  it("a non-object, non-null json (string) throws UnsupportedCompletionRuleVersionError", () => {
    expect(() =>
      parseCompletionRule({
        json: "not-an-object",
        ruleVersion: 1,
        cohortAttendanceThresholdPct: null,
      }),
    ).toThrow(UnsupportedCompletionRuleVersionError);
  });

  it("a non-object, non-null json (number) throws UnsupportedCompletionRuleVersionError", () => {
    expect(() =>
      parseCompletionRule({
        json: 42,
        ruleVersion: 1,
        cohortAttendanceThresholdPct: null,
      }),
    ).toThrow(UnsupportedCompletionRuleVersionError);
  });

  it("a non-object, non-null json (array) throws UnsupportedCompletionRuleVersionError", () => {
    expect(() =>
      parseCompletionRule({
        json: [1, 2, 3],
        ruleVersion: 1,
        cohortAttendanceThresholdPct: null,
      }),
    ).toThrow(UnsupportedCompletionRuleVersionError);
  });

  it("an outer ruleVersion other than 1 throws UnsupportedCompletionRuleVersionError even with null json", () => {
    expect(() =>
      parseCompletionRule({
        json: null,
        ruleVersion: 2,
        cohortAttendanceThresholdPct: null,
      }),
    ).toThrow(UnsupportedCompletionRuleVersionError);
  });
});

function ruleWithThreshold(attendanceThresholdPct: number | null): CompletionRuleV1 {
  return { version: 1, requireAllRequiredLessons: true, attendanceThresholdPct };
}

describe("evaluateCompletion", () => {
  it("always emits a required-lessons item with an 'N of M complete' detail", () => {
    const verdict = evaluateCompletion(ruleWithThreshold(null), {
      requiredLessonIds: ["l1", "l2", "l3"],
      completedLessonIds: new Set(["l1", "l2"]),
      attendance: null,
    });
    expect(verdict.items[0]).toEqual({
      id: "required-lessons",
      label: "All required lessons complete",
      satisfied: false,
      state: "UNMET",
      detail: "2 of 3 complete",
    });
  });

  it("zero required lessons -> satisfied: true with detail '0 of 0 complete'", () => {
    const verdict = evaluateCompletion(ruleWithThreshold(null), {
      requiredLessonIds: [],
      completedLessonIds: new Set(),
      attendance: null,
    });
    expect(verdict.items[0]).toEqual({
      id: "required-lessons",
      label: "All required lessons complete",
      satisfied: true,
      state: "SATISFIED",
      detail: "0 of 0 complete",
    });
    expect(verdict.satisfied).toBe(true);
  });

  it("attendanceThresholdPct null -> no attendance item at all, items array has length exactly 1", () => {
    const verdict = evaluateCompletion(ruleWithThreshold(null), {
      requiredLessonIds: ["l1"],
      completedLessonIds: new Set(["l1"]),
      attendance: { kind: "computed", earnedPct: 40, requiredPct: 75, attendedCount: 2, countableCount: 5, meetsThreshold: false },
    });
    expect(verdict.items).toHaveLength(1);
    expect(verdict.items.find((i) => i.id === "attendance")).toBeUndefined();
  });

  it("attendanceThresholdPct set and attendance computed meeting threshold -> satisfied item naming earned/required percentages", () => {
    const attendance: AttendanceComponent = {
      kind: "computed",
      earnedPct: 80,
      requiredPct: 75,
      attendedCount: 4,
      countableCount: 5,
      meetsThreshold: true,
    };
    const verdict = evaluateCompletion(ruleWithThreshold(75), {
      requiredLessonIds: ["l1"],
      completedLessonIds: new Set(["l1"]),
      attendance,
    });
    expect(verdict.items[1]).toEqual({
      id: "attendance",
      label: "Attendance threshold met",
      satisfied: true,
      state: "SATISFIED",
      detail: "80% of 75% required",
    });
    expect(verdict.satisfied).toBe(true);
  });

  it("attendanceThresholdPct set and attendance computed NOT meeting threshold -> unmet item", () => {
    const attendance: AttendanceComponent = {
      kind: "computed",
      earnedPct: 60,
      requiredPct: 75,
      attendedCount: 3,
      countableCount: 5,
      meetsThreshold: false,
    };
    const verdict = evaluateCompletion(ruleWithThreshold(75), {
      requiredLessonIds: ["l1"],
      completedLessonIds: new Set(["l1"]),
      attendance,
    });
    expect(verdict.items[1]).toEqual({
      id: "attendance",
      label: "Attendance threshold met",
      satisfied: false,
      state: "UNMET",
      detail: "60% of 75% required",
    });
    expect(verdict.satisfied).toBe(false);
  });

  it("attendanceThresholdPct set and attendance kind 'no-sessions' -> NOT_YET_CHECKED, satisfied: false, never a pass", () => {
    const verdict = evaluateCompletion(ruleWithThreshold(75), {
      requiredLessonIds: ["l1"],
      completedLessonIds: new Set(["l1"]),
      attendance: { kind: "no-sessions" },
    });
    expect(verdict.items[1]).toMatchObject({
      id: "attendance",
      satisfied: false,
      state: "NOT_YET_CHECKED",
    });
    expect(verdict.items[1].detail).toMatch(/no countable sessions/i);
    expect(verdict.satisfied).toBe(false);
  });

  it("attendanceThresholdPct set and attendance null (evidence not gathered) -> NOT_YET_CHECKED, satisfied: false", () => {
    const verdict = evaluateCompletion(ruleWithThreshold(75), {
      requiredLessonIds: ["l1"],
      completedLessonIds: new Set(["l1"]),
      attendance: null,
    });
    expect(verdict.items[1]).toMatchObject({
      id: "attendance",
      satisfied: false,
      state: "NOT_YET_CHECKED",
    });
    expect(verdict.satisfied).toBe(false);
  });

  it("overall satisfied is true only when every emitted item is satisfied", () => {
    const allSatisfied = evaluateCompletion(ruleWithThreshold(75), {
      requiredLessonIds: ["l1"],
      completedLessonIds: new Set(["l1"]),
      attendance: { kind: "computed", earnedPct: 100, requiredPct: 75, attendedCount: 5, countableCount: 5, meetsThreshold: true },
    });
    expect(allSatisfied.satisfied).toBe(true);

    const requiredLessonsUnmet = evaluateCompletion(ruleWithThreshold(75), {
      requiredLessonIds: ["l1", "l2"],
      completedLessonIds: new Set(["l1"]),
      attendance: { kind: "computed", earnedPct: 100, requiredPct: 75, attendedCount: 5, countableCount: 5, meetsThreshold: true },
    });
    expect(requiredLessonsUnmet.satisfied).toBe(false);
  });

  it("the returned item order is stable: required-lessons first, attendance second", () => {
    const verdict = evaluateCompletion(ruleWithThreshold(75), {
      requiredLessonIds: ["l1"],
      completedLessonIds: new Set(["l1"]),
      attendance: { kind: "computed", earnedPct: 100, requiredPct: 75, attendedCount: 5, countableCount: 5, meetsThreshold: true },
    });
    expect(verdict.items.map((i) => i.id)).toEqual(["required-lessons", "attendance"]);
  });

  it("does not merge the two rule components into one composite percentage (UI-SPEC 7.1)", () => {
    const verdict = evaluateCompletion(ruleWithThreshold(75), {
      requiredLessonIds: ["l1"],
      completedLessonIds: new Set(["l1"]),
      attendance: { kind: "computed", earnedPct: 100, requiredPct: 75, attendedCount: 5, countableCount: 5, meetsThreshold: true },
    });
    expect(verdict).not.toHaveProperty("percentage");
    expect(verdict).not.toHaveProperty("overallPct");
    expect(verdict.items).toHaveLength(2);
  });
});
