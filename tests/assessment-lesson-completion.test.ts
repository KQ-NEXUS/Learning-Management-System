/**
 * Unit coverage for the A-01 completion helper against a fake transaction.
 * The real-Postgres proof that it commits with a passing attempt lives in
 * `tests/attempt-service.integration.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ASSESSMENT_COMPLETED_LESSON_TYPES,
  AUTO_ASSESSMENT_SOURCE,
  completeAssessmentLessons,
  isAssessmentCompletedLessonType,
  type AssessmentLessonCompletionTx,
} from "@/server/services/assessment-lesson-completion";

const NOW = new Date("2026-10-03T09:00:00.000Z");

function fakeTx(lessonIds: string[], alreadyComplete: string[] = []) {
  const created: Array<Record<string, unknown>> = [];
  const findMany = vi.fn(async () => lessonIds.map((id) => ({ id })));
  const tx = {
    lesson: { findMany },
    lessonProgress: {
      findUnique: vi.fn(async (args: { where: { enrolmentId_lessonId: { lessonId: string } } }) =>
        alreadyComplete.includes(args.where.enrolmentId_lessonId.lessonId)
          ? { lessonId: args.where.enrolmentId_lessonId.lessonId }
          : null,
      ),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
      }),
    },
  } as unknown as AssessmentLessonCompletionTx;
  return { tx, created, findMany };
}

describe("isAssessmentCompletedLessonType", () => {
  it("is true for QUIZ and ASSIGNMENT only", () => {
    expect([...ASSESSMENT_COMPLETED_LESSON_TYPES]).toEqual(["QUIZ", "ASSIGNMENT"]);
    for (const type of ["TEXT", "FILE", "IMAGE", "VIDEO", "EMBED", "LINK", ""]) {
      expect(isAssessmentCompletedLessonType(type)).toBe(false);
    }
    expect(isAssessmentCompletedLessonType("QUIZ")).toBe(true);
    expect(isAssessmentCompletedLessonType("ASSIGNMENT")).toBe(true);
  });
});

describe("completeAssessmentLessons", () => {
  const args = { enrolmentId: "enr-1", assessmentId: "assess-1", now: NOW };

  it("looks up only live quiz/assignment lessons carrying the assessment", async () => {
    const { tx, findMany } = fakeTx([]);
    await completeAssessmentLessons(tx, args, vi.fn());
    expect(findMany).toHaveBeenCalledWith({
      where: { assessmentId: "assess-1", withdrawnAt: null, type: { in: ["QUIZ", "ASSIGNMENT"] } },
      select: { id: true },
    });
  });

  it("creates an AUTO_ASSESSMENT row and a lesson.completed event per lesson not yet complete", async () => {
    const { tx, created } = fakeTx(["les-a", "les-b"], ["les-a"]);
    const writeEvent = vi.fn();

    const completed = await completeAssessmentLessons(tx, args, writeEvent);

    expect(completed).toEqual(["les-b"]);
    expect(created).toEqual([
      { enrolmentId: "enr-1", lessonId: "les-b", source: AUTO_ASSESSMENT_SOURCE, completedAt: NOW },
    ]);
    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent).toHaveBeenCalledWith(tx, {
      type: "lesson.completed",
      payload: { enrolmentId: "enr-1", lessonId: "les-b", source: "AUTO_ASSESSMENT" },
      occurredAt: NOW,
    });
  });

  it("is a no-op when every lesson is already complete or the assessment sits on no lesson", async () => {
    for (const { tx, created } of [fakeTx(["les-a"], ["les-a"]), fakeTx([])]) {
      const writeEvent = vi.fn();
      expect(await completeAssessmentLessons(tx, args, writeEvent)).toEqual([]);
      expect(created).toEqual([]);
      expect(writeEvent).not.toHaveBeenCalled();
    }
  });
});
