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
} from "@/server/services/completion-rule";

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
