/**
 * Automatic completion of QUIZ and ASSIGNMENT lessons (audit A-01).
 *
 * A lesson of one of these types is finished by doing its assessment, not by
 * ticking a box: a quiz lesson completes when the learner passes the quiz, an
 * assignment lesson when they submit their work. Before this, no attempt or
 * submission path wrote a `LessonProgress` row at all, so the lesson was
 * either skippable ("Mark complete" without passing) or a dead end (no manual
 * control, and every later lesson locked for good).
 *
 * `completeAssessmentLessons` runs INSIDE the caller's transaction, next to
 * the attempt/submission write it follows, so a pass and the completion it
 * earns commit or roll back together. It never moves an existing row: a
 * lesson already completed (a staff override, an earlier pass) keeps its own
 * source and timestamp.
 *
 * This module imports nothing from `@/server/permissions`: authorization is
 * the calling service's job, already done before its transaction opens.
 */

import { writeDomainEvent, type DomainEventTxClient } from "@/server/services/domain-event-service";

/** Lesson types whose completion is earned through their assessment. */
export const ASSESSMENT_COMPLETED_LESSON_TYPES: readonly string[] = Object.freeze(["QUIZ", "ASSIGNMENT"]);

/** `LessonProgress.source` for a completion written by this module. */
export const AUTO_ASSESSMENT_SOURCE = "AUTO_ASSESSMENT";

export function isAssessmentCompletedLessonType(type: string): boolean {
  return ASSESSMENT_COMPLETED_LESSON_TYPES.includes(type);
}

/** The transactional surface this module needs; the real Prisma transaction client satisfies it. */
export type AssessmentLessonCompletionTx = DomainEventTxClient & {
  lesson: {
    findMany(args: {
      where: { assessmentId: string; withdrawnAt: null; type: { in: string[] } };
      select: { id: true };
    }): Promise<{ id: string }[]>;
  };
  lessonProgress: {
    findUnique(args: {
      where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
    }): Promise<{ lessonId: string } | null>;
    create(args: {
      data: { enrolmentId: string; lessonId: string; source: string; completedAt: Date };
    }): Promise<unknown>;
  };
};

export type CompleteAssessmentLessonsArgs = {
  enrolmentId: string;
  assessmentId: string;
  now: Date;
};

/**
 * Completes, for this enrolment, every live QUIZ/ASSIGNMENT lesson that
 * carries the assessment. Returns the ids of the lessons completed by THIS
 * call (empty when they were all complete already). The caller re-evaluates
 * course completion afterwards, in the same transaction.
 */
export async function completeAssessmentLessons(
  tx: AssessmentLessonCompletionTx,
  args: CompleteAssessmentLessonsArgs,
  writeEvent: typeof writeDomainEvent = writeDomainEvent,
): Promise<string[]> {
  const lessons = await tx.lesson.findMany({
    where: {
      assessmentId: args.assessmentId,
      withdrawnAt: null,
      type: { in: [...ASSESSMENT_COMPLETED_LESSON_TYPES] },
    },
    select: { id: true },
  });

  const completed: string[] = [];
  for (const lesson of lessons) {
    const key = { enrolmentId: args.enrolmentId, lessonId: lesson.id };
    const existing = await tx.lessonProgress.findUnique({ where: { enrolmentId_lessonId: key } });
    if (existing) continue;

    await tx.lessonProgress.create({
      data: { ...key, source: AUTO_ASSESSMENT_SOURCE, completedAt: args.now },
    });
    await writeEvent(tx, {
      type: "lesson.completed",
      payload: { ...key, source: AUTO_ASSESSMENT_SOURCE },
      occurredAt: args.now,
    });
    completed.push(lesson.id);
  }
  return completed;
}
