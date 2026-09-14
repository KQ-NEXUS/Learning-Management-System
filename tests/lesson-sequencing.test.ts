/**
 * Task 1 (plan 09-02): the pure lesson-sequencing / prerequisite-lock
 * evaluator (D-04, D-05, D-06, LRN-02).
 *
 * Exhaustive unit coverage of the whole-course walk, the blocking-lesson
 * naming, optional-lesson non-blocking, withdrawn-lesson exclusion, the
 * lazy re-lock/unlock behavior, and `isLessonUnlocked`'s unknown-id
 * default-locked guard. Mirrors the pure-evaluator style of
 * `tests/readiness.test.ts` / `tests/attendance-component.test.ts`. No data
 * access.
 */

import { describe, expect, it } from "vitest";
import {
  evaluateLessonSequencing,
  isLessonUnlocked,
  type SequencingLesson,
} from "@/server/services/lesson-sequencing";

function lesson(overrides: Partial<SequencingLesson> & { id: string; title: string }): SequencingLesson {
  return {
    required: true,
    position: 0,
    moduleId: "module-1",
    withdrawnAt: null,
    ...overrides,
  };
}

describe("evaluateLessonSequencing", () => {
  it("empty lesson list -> empty result array", () => {
    expect(evaluateLessonSequencing([], new Set())).toEqual([]);
  });

  it("first lesson is never locked", () => {
    const lessons = [lesson({ id: "l1", title: "Intro", position: 1 })];
    const result = evaluateLessonSequencing(lessons, new Set());
    expect(result).toEqual([{ lessonId: "l1", locked: false, blockingLessonTitle: null }]);
  });

  it("walks in whole-course order by position ascending across modules (D-05)", () => {
    const lessons = [
      lesson({ id: "l3", title: "Module 2 Lesson 1", position: 3, moduleId: "module-2" }),
      lesson({ id: "l1", title: "Module 1 Lesson 1", position: 1, moduleId: "module-1" }),
      lesson({ id: "l2", title: "Module 1 Lesson 2", position: 2, moduleId: "module-1" }),
    ];
    // l1 incomplete required -> blocks l2 and l3, regardless of module.
    const result = evaluateLessonSequencing(lessons, new Set());
    expect(result).toEqual([
      { lessonId: "l1", locked: false, blockingLessonTitle: null },
      { lessonId: "l2", locked: true, blockingLessonTitle: "Module 1 Lesson 1" },
      { lessonId: "l3", locked: true, blockingLessonTitle: "Module 1 Lesson 1" },
    ]);
  });

  it("sorts by position then id as a tiebreak", () => {
    const lessons = [
      lesson({ id: "z-second", title: "Second", position: 1 }),
      lesson({ id: "a-first", title: "First", position: 1 }),
    ];
    const result = evaluateLessonSequencing(lessons, new Set());
    // a-first sorts before z-second at the same position, so a-first is
    // first (unlocked) and z-second is blocked by it.
    expect(result).toEqual([
      { lessonId: "a-first", locked: false, blockingLessonTitle: null },
      { lessonId: "z-second", locked: true, blockingLessonTitle: "First" },
    ]);
  });

  it("a required incomplete lesson blocks every lesson after it, naming it by title (D-06)", () => {
    const lessons = [
      lesson({ id: "l1", title: "Foundations", position: 1 }),
      lesson({ id: "l2", title: "Next Steps", position: 2 }),
      lesson({ id: "l3", title: "Advanced", position: 3 }),
    ];
    const result = evaluateLessonSequencing(lessons, new Set());
    expect(result[1]).toEqual({ lessonId: "l2", locked: true, blockingLessonTitle: "Foundations" });
    expect(result[2]).toEqual({ lessonId: "l3", locked: true, blockingLessonTitle: "Foundations" });
  });

  it("the FIRST incomplete required lesson is the blocker; later incomplete required lessons do not overwrite it", () => {
    const lessons = [
      lesson({ id: "l1", title: "First Gate", position: 1 }),
      lesson({ id: "l2", title: "Second Gate", position: 2 }),
      lesson({ id: "l3", title: "After Both", position: 3 }),
    ];
    const result = evaluateLessonSequencing(lessons, new Set());
    expect(result[2]).toEqual({ lessonId: "l3", locked: true, blockingLessonTitle: "First Gate" });
  });

  it("an optional (required: false) incomplete lesson never blocks anything (D-04)", () => {
    const lessons = [
      lesson({ id: "l1", title: "Optional Extra", position: 1, required: false }),
      lesson({ id: "l2", title: "Main Content", position: 2 }),
    ];
    const result = evaluateLessonSequencing(lessons, new Set());
    expect(result).toEqual([
      { lessonId: "l1", locked: false, blockingLessonTitle: null },
      { lessonId: "l2", locked: false, blockingLessonTitle: null },
    ]);
  });

  it("an optional incomplete lesson leaves every later lesson locked: false when nothing else blocks", () => {
    const lessons = [
      lesson({ id: "l1", title: "Required First", position: 1 }),
      lesson({ id: "l2", title: "Optional Middle", position: 2, required: false }),
      lesson({ id: "l3", title: "Later", position: 3 }),
    ];
    const completed = new Set(["l1"]);
    const result = evaluateLessonSequencing(lessons, completed);
    expect(result).toEqual([
      { lessonId: "l1", locked: false, blockingLessonTitle: null },
      { lessonId: "l2", locked: false, blockingLessonTitle: null },
      { lessonId: "l3", locked: false, blockingLessonTitle: null },
    ]);
  });

  it("completing the blocking lesson unlocks everything after it on the next evaluation", () => {
    const lessons = [
      lesson({ id: "l1", title: "Gate", position: 1 }),
      lesson({ id: "l2", title: "After Gate", position: 2 }),
    ];
    const beforeCompletion = evaluateLessonSequencing(lessons, new Set());
    expect(beforeCompletion[1].locked).toBe(true);

    const afterCompletion = evaluateLessonSequencing(lessons, new Set(["l1"]));
    expect(afterCompletion).toEqual([
      { lessonId: "l1", locked: false, blockingLessonTitle: null },
      { lessonId: "l2", locked: false, blockingLessonTitle: null },
    ]);
  });

  it("withdrawn lessons are excluded before the walk and appear in no result row", () => {
    const lessons = [
      lesson({ id: "l1", title: "Live One", position: 1 }),
      lesson({ id: "l2", title: "Withdrawn", position: 2, withdrawnAt: new Date("2026-01-01T00:00:00.000Z") }),
      lesson({ id: "l3", title: "Live Two", position: 3 }),
    ];
    const result = evaluateLessonSequencing(lessons, new Set());
    expect(result.map((r) => r.lessonId)).toEqual(["l1", "l3"]);
    // l1 incomplete required still blocks l3, skipping straight past the
    // withdrawn l2 as though it never existed.
    expect(result[1]).toEqual({ lessonId: "l3", locked: true, blockingLessonTitle: "Live One" });
  });

  it("withdrawn lessons accept a string withdrawnAt too", () => {
    const lessons = [
      lesson({ id: "l1", title: "Live", position: 1 }),
      lesson({ id: "l2", title: "Withdrawn", position: 2, withdrawnAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const result = evaluateLessonSequencing(lessons, new Set());
    expect(result.map((r) => r.lessonId)).toEqual(["l1"]);
  });

  it("does not mutate the caller's input array order", () => {
    const lessons = [
      lesson({ id: "l3", title: "Third", position: 3 }),
      lesson({ id: "l1", title: "First", position: 1 }),
      lesson({ id: "l2", title: "Second", position: 2 }),
    ];
    const original = [...lessons];
    evaluateLessonSequencing(lessons, new Set());
    expect(lessons).toEqual(original);
  });
});

describe("isLessonUnlocked", () => {
  it("returns true for a lesson with locked: false", () => {
    const results = [{ lessonId: "l1", locked: false, blockingLessonTitle: null }];
    expect(isLessonUnlocked(results, "l1")).toBe(true);
  });

  it("returns false for a lesson with locked: true", () => {
    const results = [{ lessonId: "l1", locked: true, blockingLessonTitle: "Gate" }];
    expect(isLessonUnlocked(results, "l1")).toBe(false);
  });

  it("returns false for an unknown lesson id (T-09-13 — never default-open)", () => {
    const results = [{ lessonId: "l1", locked: false, blockingLessonTitle: null }];
    expect(isLessonUnlocked(results, "does-not-exist")).toBe(false);
  });

  it("returns false for an unknown lesson id against an empty results array", () => {
    expect(isLessonUnlocked([], "does-not-exist")).toBe(false);
  });
});
