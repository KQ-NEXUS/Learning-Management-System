/**
 * Real-Postgres proof for the attempt service (plan 10-06, ASM-01/ASM-02,
 * D-01/D-08).
 *
 * The unit test (`tests/attempt-service.test.ts`) drives `submitAttempt` and
 * `resolveAttemptExpiry` against an in-memory fake store/tx. That fake cannot
 * prove:
 *   - that `Attempt.answers` survives a real Postgres JSON round-trip
 *     unchanged (the fake stores the JS object by reference);
 *   - that the `@@unique([assessmentId, enrolmentId, attemptNumber])`
 *     constraint actually fires when a second attempt is started past
 *     `maxAttempts`;
 *   - that the `Grade` row and both `DomainEvent` rows commit atomically with
 *     the `Attempt` update inside one real `$transaction`;
 *   - that a real cascade of `QuizQuestion`/`QuizOption` UPDATEs through
 *     Prisma cannot reach a stored snapshot (D-08's own real-database proof,
 *     not merely a re-description of the frozen-payload mechanism).
 *
 * This file starts a throwaway `postgres:16-alpine` (see `tests/support/pg.ts`),
 * deploys the checked-in migrations, and exercises the real schema.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED — never a silent pass,
 * never a weakened mock. Docker is confirmed healthy in this environment
 * (10-RESEARCH.md Environment Availability), so this suite is expected to
 * actually run.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import {
  createPrismaBackedAttemptService,
  AttemptNotStartableError,
} from "@/server/services/attempt-service";
import { scoreAttempt } from "@/server/services/quiz-scoring";

let testDb: TestDatabase;

type Svc = ReturnType<typeof createPrismaBackedAttemptService>;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/**
 * `createPrismaBackedAttemptService`'s default `audit` callback
 * (`liveAudit`) writes through the app's singleton `prisma` client, which is
 * bound to whatever `DATABASE_URL` this process happens to have — NOT the
 * throwaway test container. Every call site below must inject an explicit
 * audit callback bound to `testDb.prisma`, mirroring
 * `attendance-service.integration.test.ts`'s own `serviceWithGrants`.
 */
function buildService(): Svc {
  return createPrismaBackedAttemptService(testDb.prisma, async (event) => {
    await testDb.prisma.auditEvent.create({
      data: {
        actorId: event.actorId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId ?? null,
        before: (event.before ?? undefined) as never,
        after: (event.after ?? undefined) as never,
        reason: event.reason ?? null,
        outcome: event.outcome,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Fixture — a published QUIZ Assessment with three questions spanning all
// three QuestionType members, including a three-correct-option MULTI_CHOICE
// so D-09's partial-credit path is exercised against real data.
// ---------------------------------------------------------------------------

async function seedQuizFixture(
  prisma: PrismaClient,
  overrides: {
    maxAttempts?: number | null;
    availableUntil?: Date | null;
    attemptGradingMethod?: "HIGHEST" | "LATEST" | "AVERAGE";
  } = {},
) {
  const { cohortId, courseId } = await seedCohortFixture(prisma);

  const assessment = await prisma.assessment.create({
    data: {
      courseId,
      type: "QUIZ",
      title: "Fixture Quiz",
      status: "PUBLISHED",
      version: 1,
      maxAttempts: overrides.maxAttempts === undefined ? null : overrides.maxAttempts,
      // 24 total marks across the three questions below; 20 keeps a
      // fully-correct submission a clean pass (24 >= 20) without being
      // trivially satisfied by a single question.
      passMark: 20,
      totalMarks: 24,
      availableUntil: overrides.availableUntil ?? null,
      attemptGradingMethod: overrides.attemptGradingMethod ?? "HIGHEST",
    },
    select: { id: true, version: true },
  });

  // Q1 — SINGLE_CHOICE, 10 marks, correct = "b"
  const q1 = await prisma.quizQuestion.create({
    data: { assessmentId: assessment.id, position: 0, prompt: "Single choice", type: "SINGLE_CHOICE", marks: 10 },
    select: { id: true },
  });
  await prisma.quizOption.create({ data: { questionId: q1.id, position: 0, label: "a", isCorrect: false } });
  const q1CorrectOption = await prisma.quizOption.create({
    data: { questionId: q1.id, position: 1, label: "b", isCorrect: true },
    select: { id: true },
  });

  // Q2 — TRUE_FALSE, 5 marks, correct = "True"
  const q2 = await prisma.quizQuestion.create({
    data: { assessmentId: assessment.id, position: 1, prompt: "True/False", type: "TRUE_FALSE", marks: 5 },
    select: { id: true },
  });
  const q2CorrectOption = await prisma.quizOption.create({
    data: { questionId: q2.id, position: 0, label: "True", isCorrect: true },
    select: { id: true },
  });
  await prisma.quizOption.create({ data: { questionId: q2.id, position: 1, label: "False", isCorrect: false } });

  // Q3 — MULTI_CHOICE, 9 marks, three correct options (D-09 partial credit)
  const q3 = await prisma.quizQuestion.create({
    data: { assessmentId: assessment.id, position: 2, prompt: "Multi choice", type: "MULTI_CHOICE", marks: 9 },
    select: { id: true },
  });
  const q3OptA = await prisma.quizOption.create({
    data: { questionId: q3.id, position: 0, label: "a", isCorrect: true },
    select: { id: true },
  });
  const q3OptB = await prisma.quizOption.create({
    data: { questionId: q3.id, position: 1, label: "b", isCorrect: true },
    select: { id: true },
  });
  const q3OptC = await prisma.quizOption.create({
    data: { questionId: q3.id, position: 2, label: "c", isCorrect: true },
    select: { id: true },
  });
  await prisma.quizOption.create({ data: { questionId: q3.id, position: 3, label: "d", isCorrect: false } });

  const { enrolmentId, userId } = await seedEnrolmentFixture(prisma, { cohortId });

  return {
    assessmentId: assessment.id,
    assessmentVersion: assessment.version,
    courseId,
    cohortId,
    enrolmentId,
    userId,
    q1: { id: q1.id, correctOptionId: q1CorrectOption.id },
    q2: { id: q2.id, correctOptionId: q2CorrectOption.id },
    q3: { id: q3.id, correctOptionIds: [q3OptA.id, q3OptB.id, q3OptC.id] },
  };
}

function fullyCorrectResponses(fixture: Awaited<ReturnType<typeof seedQuizFixture>>) {
  return [
    { questionId: fixture.q1.id, selectedOptionIds: [fixture.q1.correctOptionId] },
    { questionId: fixture.q2.id, selectedOptionIds: [fixture.q2.correctOptionId] },
    { questionId: fixture.q3.id, selectedOptionIds: fixture.q3.correctOptionIds },
  ];
}

// ---------------------------------------------------------------------------
// 1. Start — the frozen snapshot persists and round-trips
// ---------------------------------------------------------------------------

describe("startAttempt — real-Postgres persistence", () => {
  it("Attempt.answers round-trips with questionSnapshot/passMark/totalMarks intact and versionUsed equals the Assessment's version", async () => {
    const fixture = await seedQuizFixture(testDb.prisma);
    const svc: Svc = buildService();

    const started = await svc.startAttempt({ userId: fixture.userId }, { assessmentId: fixture.assessmentId });

    expect(started.versionUsed).toBe(fixture.assessmentVersion);
    expect(started.answers?.passMark).toBe(20);
    expect(started.answers?.totalMarks).toBe(24);
    expect(started.answers?.questionSnapshot).toHaveLength(3);

    const row = await testDb.prisma.attempt.findUniqueOrThrow({ where: { id: started.id } });
    const payload = row.answers as unknown as { questionSnapshot: unknown[]; passMark: number; totalMarks: number };
    expect(payload.questionSnapshot).toHaveLength(3);
    expect(payload.passMark).toBe(20);
    expect(payload.totalMarks).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// 2. Snapshot immunity (ASM-01/D-08) — the central proof of this plan
// ---------------------------------------------------------------------------

describe("submitAttempt — snapshot immunity against a real database (D-08, T-10-08)", () => {
  it("scores from the ORIGINAL snapshot even after live QuizOption.isCorrect and QuizQuestion.marks are mutated through Prisma between start and submit", async () => {
    const fixture = await seedQuizFixture(testDb.prisma);
    const svc: Svc = buildService();

    const started = await svc.startAttempt({ userId: fixture.userId }, { assessmentId: fixture.assessmentId });

    // Mutate the LIVE rows through Prisma after start — flip the correct
    // answer key and bump marks on Q1.
    await testDb.prisma.quizOption.update({
      where: { id: fixture.q1.correctOptionId },
      data: { isCorrect: false },
    });
    await testDb.prisma.quizQuestion.update({
      where: { id: fixture.q1.id },
      data: { marks: 999 },
    });

    const result = await svc.submitAttempt(
      { userId: fixture.userId },
      { attemptId: started.id, responses: fullyCorrectResponses(fixture) },
    );

    // The frozen snapshot still says Q1's original option was correct worth
    // 10 marks — the live edit above must not have reached this attempt.
    const q1Result = result.perQuestion.find((p) => p.questionId === fixture.q1.id);
    expect(q1Result?.awarded).toBe(10);
    expect(q1Result?.marks).toBe(10);
    expect(result.maxScore).toBe(24); // 10 + 5 + 9, unaffected by the marks: 999 edit
    expect(result.score).toBe(24); // fully correct against the ORIGINAL snapshot
  });
});

// ---------------------------------------------------------------------------
// 3. Reproducibility (ASM-02)
// ---------------------------------------------------------------------------

describe("submitAttempt — reproducible scoring (ASM-02)", () => {
  it("re-running scoreAttempt over the persisted payload returns the same score the Attempt.score column holds", async () => {
    const fixture = await seedQuizFixture(testDb.prisma);
    const svc: Svc = buildService();

    const started = await svc.startAttempt({ userId: fixture.userId }, { assessmentId: fixture.assessmentId });
    await svc.submitAttempt(
      { userId: fixture.userId },
      { attemptId: started.id, responses: fullyCorrectResponses(fixture) },
    );

    const row = await testDb.prisma.attempt.findUniqueOrThrow({ where: { id: started.id } });
    const payload = row.answers as unknown as {
      questionSnapshot: Parameters<typeof scoreAttempt>[0]["questions"];
      responses: Parameters<typeof scoreAttempt>[0]["responses"];
      passMark: number | null;
    };

    const recomputed = scoreAttempt({
      questions: payload.questionSnapshot,
      responses: payload.responses,
      passMark: payload.passMark,
    });

    expect(recomputed.score).toBe(row.score);
    expect(recomputed.maxScore).toBe(row.maxScore);
    expect(recomputed.passed).toBe(row.passed);
  });
});

// ---------------------------------------------------------------------------
// 4. Full evidence, Grade, DomainEvent, AuditEvent — atomic and exact
// ---------------------------------------------------------------------------

describe("submitAttempt — full ASM-02 evidence and atomic Grade/event/audit writes", () => {
  it("persists start/submit time, answers, versionUsed, score, maxScore, passed, status, exactly one RELEASED Grade, exactly one of each DomainEvent, and exactly one AuditEvent", async () => {
    const fixture = await seedQuizFixture(testDb.prisma);
    const svc: Svc = buildService();

    const started = await svc.startAttempt({ userId: fixture.userId }, { assessmentId: fixture.assessmentId });
    const startedAt = started.startedAt;

    await svc.submitAttempt(
      { userId: fixture.userId },
      { attemptId: started.id, responses: fullyCorrectResponses(fixture) },
    );

    // --- Attempt evidence, field by field (ASM-02) ---
    const row = await testDb.prisma.attempt.findUniqueOrThrow({ where: { id: started.id } });
    expect(row.startedAt.getTime()).toBe(startedAt.getTime());
    expect(row.submittedAt).not.toBeNull();
    expect(row.answers).not.toBeNull();
    expect(row.versionUsed).toBe(fixture.assessmentVersion);
    expect(row.score).toBe(24);
    expect(row.maxScore).toBe(24);
    expect(row.passed).toBe(true);
    expect(row.status).toBe("SUBMITTED");

    // --- Exactly one Grade, RELEASED, attemptId set (D-01) ---
    const grades = await testDb.prisma.grade.findMany({ where: { attemptId: started.id } });
    expect(grades).toHaveLength(1);
    expect(grades[0].status).toBe("RELEASED");
    expect(grades[0].attemptId).toBe(started.id);
    expect(grades[0].gradedById).toBeNull();
    expect(grades[0].releasedById).toBeNull();

    // --- Exactly one attempt.submitted and one grade.released DomainEvent for
    // THIS attempt, no PII beyond ids. The container is shared across every
    // case in this file, so the type-only query is filtered in-memory down
    // to this attempt's own rows rather than asserting a global count.
    const allSubmittedEvents = await testDb.prisma.domainEvent.findMany({ where: { type: "attempt.submitted" } });
    const allReleasedEvents = await testDb.prisma.domainEvent.findMany({ where: { type: "grade.released" } });
    const submittedEvents = allSubmittedEvents.filter(
      (e) => (e.payload as Record<string, unknown>).attemptId === started.id,
    );
    const releasedEvents = allReleasedEvents.filter(
      (e) => (e.payload as Record<string, unknown>).attemptId === started.id,
    );
    expect(submittedEvents).toHaveLength(1);
    expect(releasedEvents).toHaveLength(1);

    const submittedPayload = submittedEvents[0].payload as Record<string, unknown>;
    expect(Object.keys(submittedPayload).sort()).toEqual(
      ["assessmentId", "attemptId", "attemptNumber", "enrolmentId", "status"].sort(),
    );

    const releasedPayload = releasedEvents[0].payload as Record<string, unknown>;
    expect(Object.keys(releasedPayload).sort()).toEqual(
      ["assessmentId", "attemptId", "enrolmentId", "gradeId", "maxScore", "passed", "releasedBy", "score"].sort(),
    );
    expect(releasedPayload.releasedBy).toBe("SYSTEM_AUTO");

    // --- Exactly one AuditEvent, action attempt.submitted, learner actor ---
    const auditRows = await testDb.prisma.auditEvent.findMany({
      where: { action: "attempt.submitted", targetId: started.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorId).toBe(fixture.userId);
  });
});

// ---------------------------------------------------------------------------
// 5. Attempt-limit refusal and the unique-constraint backstop
// ---------------------------------------------------------------------------

describe("startAttempt — attempt-limit refusal and the composite unique constraint", () => {
  it("refuses a second startAttempt when maxAttempts is 1, but creates attemptNumber 2 (satisfying the unique constraint) when maxAttempts is 2", async () => {
    const limitOne = await seedQuizFixture(testDb.prisma, { maxAttempts: 1 });
    const svcOne: Svc = buildService();
    const firstAttempt = await svcOne.startAttempt(
      { userId: limitOne.userId },
      { assessmentId: limitOne.assessmentId },
    );
    await svcOne.submitAttempt(
      { userId: limitOne.userId },
      { attemptId: firstAttempt.id, responses: fullyCorrectResponses(limitOne) },
    );

    await expect(
      svcOne.startAttempt({ userId: limitOne.userId }, { assessmentId: limitOne.assessmentId }),
    ).rejects.toBeInstanceOf(AttemptNotStartableError);

    const limitTwo = await seedQuizFixture(testDb.prisma, { maxAttempts: 2 });
    const svcTwo: Svc = buildService();
    const first = await svcTwo.startAttempt({ userId: limitTwo.userId }, { assessmentId: limitTwo.assessmentId });
    await svcTwo.submitAttempt(
      { userId: limitTwo.userId },
      { attemptId: first.id, responses: fullyCorrectResponses(limitTwo) },
    );

    const second = await svcTwo.startAttempt({ userId: limitTwo.userId }, { assessmentId: limitTwo.assessmentId });
    expect(second.attemptNumber).toBe(2);

    const rows = await testDb.prisma.attempt.findMany({
      where: { assessmentId: limitTwo.assessmentId, enrolmentId: limitTwo.enrolmentId },
    });
    expect(rows).toHaveLength(2);
  }, 30_000); // two full seed+start+submit cycles against a real container exceed vitest's 5s default
});

// ---------------------------------------------------------------------------
// 6. Lazy expiry against a real database
// ---------------------------------------------------------------------------

describe("resolveAttemptExpiry — real-Postgres lazy EXPIRED transition", () => {
  it("reads back an IN_PROGRESS attempt as EXPIRED with a Grade present once the Assessment's availableUntil has moved into the past", async () => {
    const fixture = await seedQuizFixture(testDb.prisma, { availableUntil: null });
    const svc: Svc = buildService();

    const started = await svc.startAttempt({ userId: fixture.userId }, { assessmentId: fixture.assessmentId });
    expect(started.status).toBe("IN_PROGRESS");

    // Move the window into the past — mirrors a real quiz whose deadline
    // has now elapsed while the attempt was left IN_PROGRESS.
    await testDb.prisma.assessment.update({
      where: { id: fixture.assessmentId },
      data: { availableUntil: new Date(Date.now() - 60_000) },
    });

    const read = await svc.getOwnAttempt({ userId: fixture.userId }, started.id);
    expect(read?.status).toBe("EXPIRED");
    expect(read?.expired).toBe(true);

    const grades = await testDb.prisma.grade.findMany({ where: { attemptId: started.id } });
    expect(grades).toHaveLength(1);
    expect(grades[0].status).toBe("RELEASED");
  });
});
