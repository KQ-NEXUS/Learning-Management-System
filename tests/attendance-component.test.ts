/**
 * Task 2 (plan 05-02): the pure attendance component calculator (D-20,
 * ATT-02).
 *
 * Exhaustive unit coverage of the earned/required computation and the
 * discriminated third states (`no-rule`, `no-sessions`) — mirrors the
 * pure-evaluator style of `tests/readiness.test.ts`. No data access.
 */

import { describe, expect, it } from "vitest";
import {
  computeAttendanceComponent,
  type AttendanceComponentEntry,
  type AttendanceStateValue,
} from "@/server/services/attendance-component";

function entry(
  state: AttendanceStateValue,
  overrides: Partial<AttendanceComponentEntry> = {},
): AttendanceComponentEntry {
  return {
    state,
    attendanceExpected: overrides.attendanceExpected ?? true,
    cancelledAt: overrides.cancelledAt ?? null,
  };
}

describe("computeAttendanceComponent", () => {
  it("PRESENT/PRESENT/LATE/ABSENT at threshold 75 → earned 75, required 75, meets", () => {
    const result = computeAttendanceComponent({
      thresholdPct: 75,
      entries: [entry("PRESENT"), entry("PRESENT"), entry("LATE"), entry("ABSENT")],
    });
    expect(result).toEqual({
      kind: "computed",
      earnedPct: 75,
      requiredPct: 75,
      attendedCount: 3,
      countableCount: 4,
      meetsThreshold: true,
    });
  });

  it("LATE counts as attended; EXCUSED leaves the denominator", () => {
    const result = computeAttendanceComponent({
      thresholdPct: 50,
      entries: [entry("LATE"), entry("EXCUSED"), entry("ABSENT")],
    });
    // countable = LATE + ABSENT = 2; attended = 1 → 50
    expect(result).toEqual({
      kind: "computed",
      earnedPct: 50,
      requiredPct: 50,
      attendedCount: 1,
      countableCount: 2,
      meetsThreshold: true,
    });
  });

  it("NOT_RECORDED counts against the learner (denominator, not earned)", () => {
    const result = computeAttendanceComponent({
      thresholdPct: 80,
      entries: [entry("PRESENT"), entry("NOT_RECORDED")],
    });
    expect(result).toMatchObject({
      kind: "computed",
      earnedPct: 50,
      attendedCount: 1,
      countableCount: 2,
      meetsThreshold: false,
    });
  });

  it("null threshold → { kind: 'no-rule' }, never a zero percentage", () => {
    const result = computeAttendanceComponent({
      thresholdPct: null,
      entries: [entry("ABSENT"), entry("ABSENT")],
    });
    expect(result).toEqual({ kind: "no-rule" });
  });

  it("threshold set but zero countable sessions → { kind: 'no-sessions' }, never NaN or 0", () => {
    expect(computeAttendanceComponent({ thresholdPct: 75, entries: [] })).toEqual({
      kind: "no-sessions",
    });
    expect(
      computeAttendanceComponent({
        thresholdPct: 75,
        entries: [entry("EXCUSED"), entry("EXCUSED")],
      }),
    ).toEqual({ kind: "no-sessions" });
  });

  it("excludes sessions with attendanceExpected: false or a non-null cancelledAt", () => {
    const result = computeAttendanceComponent({
      thresholdPct: 50,
      entries: [
        entry("PRESENT"),
        entry("ABSENT", { attendanceExpected: false }),
        entry("ABSENT", { cancelledAt: new Date("2026-05-01T00:00:00.000Z") }),
        entry("ABSENT", { cancelledAt: "2026-05-02T00:00:00.000Z" }),
      ],
    });
    expect(result).toEqual({
      kind: "computed",
      earnedPct: 100,
      requiredPct: 50,
      attendedCount: 1,
      countableCount: 1,
      meetsThreshold: true,
    });
  });

  it("rounds earnedPct to the nearest integer", () => {
    const result = computeAttendanceComponent({
      thresholdPct: 60,
      entries: [entry("PRESENT"), entry("PRESENT"), entry("ABSENT")],
    });
    // 2/3 = 66.66… → 67
    expect(result).toMatchObject({ kind: "computed", earnedPct: 67, meetsThreshold: true });
  });

  it("does not return a completion verdict", () => {
    const result = computeAttendanceComponent({
      thresholdPct: 75,
      entries: [entry("PRESENT")],
    });
    expect(result).not.toHaveProperty("completed");
    expect(result).not.toHaveProperty("verdict");
  });
});
