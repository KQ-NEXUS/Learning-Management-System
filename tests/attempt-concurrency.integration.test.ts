/**
 * Real-Postgres concurrency proof for quiz attempt starts (plan 15-12, NFR-03).
 *
 * `startAttempt` reads the learner's attempts and creates attempt number
 * highest + 1 inside a transaction. A double-clicked "Start quiz", or a
 * retried request, can run that twice at once. The guards are the
 * `Attempt @@unique([assessmentId, enrolmentId, attemptNumber])` key and the
 * single retry in `startAttempt`, which re-reads after a collision and then
 * resumes the attempt the winner created. This file proves that concurrent
 * starts never produce two attempts with the same number: resuming starts
 * converge on one attempt, and concurrent "start a new attempt" calls produce
 * distinct, gap-free attempt numbers with exactly one left in progress.
 *
 * SAFETY: the only database here is a disposable Testcontainers instance from
 * `startTestDatabase()`. Nothing reads `.env` or reaches a shared database.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED, never a silent pass.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { createPrismaBackedAttemptService } from "@/server/services/attempt-service";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/** An explicit audit sink bound to the container (the default writes through the app singleton). */
function buildService() {
  return createPrismaBackedAttemptService(testDb.prisma, async (event) => {
    await testDb.prisma.auditEvent.create({
      data: {
        actorId: event.actorId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId ?? null,
        after: (event.after ?? undefined) as never,
        reason: event.reason ?? null,
        outcome: event.outcome,
      },
    });
  });
}

/** A published one-question quiz with unlimited attempts, and an ACTIVE enrolment that reaches it. */
async function seedQuiz() {
  const { cohortId, courseId } = await seedCohortFixture(testDb.prisma);
  const assessment = await testDb.prisma.assessment.create({
    data: {
      courseId,
      type: "QUIZ",
      title: "Concurrency quiz",
      status: "PUBLISHED",
      version: 1,
      maxAttempts: null,
      passMark: 1,
      totalMarks: 1,
    },
    select: { id: true },
  });
  const question = await testDb.prisma.quizQuestion.create({
    data: { assessmentId: assessment.id, position: 0, prompt: "Pick one", type: "SINGLE_CHOICE", marks: 1 },
    select: { id: true },
  });
  await testDb.prisma.quizOption.create({ data: { questionId: question.id, position: 0, label: "a", isCorrect: true } });
  await testDb.prisma.quizOption.create({ data: { questionId: question.id, position: 1, label: "b", isCorrect: false } });
  const { enrolmentId, userId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });
  return { assessmentId: assessment.id, enrolmentId, userId };
}

async function attemptsFor(assessmentId: string, enrolmentId: string) {
  return testDb.prisma.attempt.findMany({ where: { assessmentId, enrolmentId }, orderBy: { attemptNumber: "asc" } });
}

describe("startAttempt under concurrent starts for one learner and quiz (NFR-03)", { timeout: 60_000 }, () => {
  it("ten concurrent starts converge on one attempt: every call resolves to the same attempt, never a duplicate number", async () => {
    const f = await seedQuiz();
    const svc = buildService();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => svc.startAttempt({ userId: f.userId }, { assessmentId: f.assessmentId })),
    );

    for (const outcome of outcomes) {
      expect(outcome.status, outcome.status === "rejected" ? String(outcome.reason) : "").toBe("fulfilled");
    }
    const rows = await attemptsFor(f.assessmentId, f.enrolmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attemptNumber: 1, status: "IN_PROGRESS" });
    const ids = new Set(outcomes.map((o) => (o.status === "fulfilled" ? o.value.id : null)));
    expect(ids).toEqual(new Set([rows[0].id]));
  });

  it("two concurrent 'start a new attempt' calls produce distinct attempt numbers and leave exactly one in progress", async () => {
    const f = await seedQuiz();
    const svc = buildService();
    await svc.startAttempt({ userId: f.userId }, { assessmentId: f.assessmentId });

    const outcomes = await Promise.allSettled([
      svc.startAttempt({ userId: f.userId }, { assessmentId: f.assessmentId, startNew: true }),
      svc.startAttempt({ userId: f.userId }, { assessmentId: f.assessmentId, startNew: true }),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status, outcome.status === "rejected" ? String(outcome.reason) : "").toBe("fulfilled");
    }
    const rows = await attemptsFor(f.assessmentId, f.enrolmentId);
    const numbers = rows.map((r) => r.attemptNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    expect(rows.filter((r) => r.status === "IN_PROGRESS")).toHaveLength(1);
  });
});
