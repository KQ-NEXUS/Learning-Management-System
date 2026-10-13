/**
 * Real-Postgres concurrency proof for grading (plan 15-12, NFR-03 / NFR-14).
 *
 * `saveDraftGrade` reads the submission's grade and then either updates it or
 * creates one. Two graders (or one grader's retried request) saving the same
 * submission at the same moment both read "no grade yet" and both insert, so
 * the submission ends up with two Grade rows. The partial unique index
 * `Grade_submissionId_key` (migration 20261006120000_grade_completion_uniqueness)
 * makes the second insert fail, and the service turns that failure into an
 * update of the winner's draft, or into the existing `GradeAlreadyReleasedError`
 * when the winner's grade has already been released. Neither caller ever sees
 * a raw Prisma error.
 *
 * The race is made deterministic: a wrapper around the grade delegate holds
 * each of the first two `findFirst` reads until both callers have read, so
 * both are guaranteed to take the create path. Without the index this test
 * leaves two rows (the RED run recorded in 15-12-SUMMARY.md).
 *
 * SAFETY: the only database here is a disposable Testcontainers instance from
 * `startTestDatabase()`. Nothing reads `.env` or reaches a shared database.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED, never a silent pass.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture } from "./support/cohort-fixtures";
import {
  createGradingService,
  GradeAlreadyReleasedError,
  type GradingServiceDeps,
  type GradingTxClient,
} from "@/server/services/grading-service";
import {
  createCohortScopeResolvers,
  type CohortScopeDelegate,
  type EnrolmentScopeDelegate,
  type SessionScopeDelegate,
} from "@/server/services/cohort-scope";
import { writeDomainEvent } from "@/server/services/domain-event-service";

let testDb: TestDatabase;
let counter = 0;
const uid = (prefix: string) => `${prefix}-${(counter += 1)}`;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

type GradeDelegate = GradingServiceDeps["grade"];

function realGradeDelegate(): GradeDelegate {
  return testDb.prisma.grade as unknown as GradeDelegate;
}

/**
 * Holds each of the first `parties` callers until all of them have arrived,
 * then releases them together. Later callers pass straight through.
 */
function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    if (arrived <= parties) await gate;
  };
}

/** A grade delegate whose first two `findFirst` reads both complete before either caller writes. */
function racingGradeDelegate(): GradeDelegate {
  const real = realGradeDelegate();
  const bothRead = barrier(2);
  return {
    findUnique: (args) => real.findUnique(args),
    findFirst: async (args) => {
      const row = await real.findFirst(args);
      await bothRead();
      return row;
    },
    findMany: (args) => real.findMany(args),
    create: (args) => real.create(args),
    update: (args) => real.update(args),
  };
}

async function auditSink(entry: {
  action: string;
  targetType: string;
  targetId: string | null;
  actorId: string | null;
  outcome: string;
  reason: string | null;
  before?: unknown;
  after?: unknown;
}) {
  await testDb.prisma.auditEvent.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: (entry.before ?? undefined) as never,
      after: (entry.after ?? undefined) as never,
      reason: entry.reason ?? null,
      outcome: entry.outcome,
    },
  });
}

function buildGradingService(userId: string, grade: GradeDelegate = realGradeDelegate()) {
  const { withPermission } = createTestWithPermission([grant("grades.manage")], { userId });
  const { enrolmentCohortScope, cohortResourceScope } = createCohortScopeResolvers({
    cohort: testDb.prisma.cohort as unknown as CohortScopeDelegate,
    session: testDb.prisma.scheduledSession as unknown as SessionScopeDelegate,
    enrolment: testDb.prisma.enrolment as unknown as EnrolmentScopeDelegate,
  });

  return createGradingService({
    grade,
    submission: testDb.prisma.submission as unknown as GradingServiceDeps["submission"],
    assessment: testDb.prisma.assessment as unknown as GradingServiceDeps["assessment"],
    enrolment: testDb.prisma.enrolment as unknown as GradingServiceDeps["enrolment"],
    user: testDb.prisma.user as unknown as GradingServiceDeps["user"],
    cohort: testDb.prisma.cohort as unknown as GradingServiceDeps["cohort"],
    cohortCourse: testDb.prisma.cohortCourse as unknown as GradingServiceDeps["cohortCourse"],
    gradeOverride: testDb.prisma.gradeOverride as unknown as GradingServiceDeps["gradeOverride"],
    audit: auditSink,
    writeEvent: writeDomainEvent,
    runInTransaction: (fn) => testDb.prisma.$transaction((tx) => fn(tx as unknown as GradingTxClient)),
    enrolmentScope: enrolmentCohortScope,
    cohortScope: cohortResourceScope,
    withPermission,
  });
}

/** One READY submission for a fresh enrolment on a published 100-mark assignment. */
async function seedSubmission() {
  const { cohortId, courseId } = await seedCohortFixture(testDb.prisma);
  const assessment = await testDb.prisma.assessment.create({
    data: {
      courseId,
      type: "ASSIGNMENT",
      title: "Concurrency assignment",
      status: "PUBLISHED",
      version: 1,
      totalMarks: 100,
      passMark: 50,
      allowedFileTypes: ["pdf"],
    },
    select: { id: true },
  });
  const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });
  const submission = await testDb.prisma.submission.create({
    data: {
      assessmentId: assessment.id,
      enrolmentId,
      attemptNumber: 1,
      versionUsed: 1,
      storageKey: uid("submissions/concurrency"),
      filename: "work.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      uploadStatus: "READY",
    },
    select: { id: true },
  });
  return { assessmentId: assessment.id, enrolmentId, submissionId: submission.id };
}

async function seedGrader(name: string) {
  return (await seedLearnerFixture(testDb.prisma, { name })).userId;
}

describe("saveDraftGrade under concurrent saves for one submission (NFR-03 / NFR-14)", { timeout: 60_000 }, () => {
  it("two graders saving at the same moment leave exactly one Grade row and both calls resolve", async () => {
    const f = await seedSubmission();
    const graderA = await seedGrader("Concurrent grader A");
    const graderB = await seedGrader("Concurrent grader B");
    const racing = racingGradeDelegate();
    const serviceA = buildGradingService(graderA, racing);
    const serviceB = buildGradingService(graderB, racing);

    const outcomes = await Promise.allSettled([
      serviceA.saveDraftGrade({ submissionId: f.submissionId, score: 70, feedback: "From A" }),
      serviceB.saveDraftGrade({ submissionId: f.submissionId, score: 80, feedback: "From B" }),
    ]);

    const rows = await testDb.prisma.grade.findMany({ where: { submissionId: f.submissionId } });
    expect(rows).toHaveLength(1);

    // Neither caller sees a raw database error: the loser's insert became an
    // update of the winner's draft, so both calls resolve to the same row.
    for (const outcome of outcomes) {
      expect(outcome.status, outcome.status === "rejected" ? String(outcome.reason) : "").toBe("fulfilled");
    }
    const ids = outcomes.map((o) => (o.status === "fulfilled" ? o.value.id : null));
    expect(new Set(ids)).toEqual(new Set([rows[0].id]));
    expect(rows[0].status).toBe("DRAFT");
    expect([70, 80]).toContain(rows[0].score);
  });

  it("ten unsynchronised saves for one submission still leave exactly one Grade row", async () => {
    const f = await seedSubmission();
    const graderId = await seedGrader("Retrying grader");
    const service = buildGradingService(graderId);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        service.saveDraftGrade({ submissionId: f.submissionId, score: 50 + i, feedback: `Retry ${i}` }),
      ),
    );

    const rows = await testDb.prisma.grade.findMany({ where: { submissionId: f.submissionId } });
    expect(rows).toHaveLength(1);
    for (const outcome of outcomes) {
      expect(outcome.status, outcome.status === "rejected" ? String(outcome.reason) : "").toBe("fulfilled");
    }
  });

  it("a losing insert whose winner is already RELEASED gets GradeAlreadyReleasedError and changes nothing", async () => {
    const f = await seedSubmission();
    const graderId = await seedGrader("Late grader");
    const real = realGradeDelegate();
    let releasedId = "";

    // The caller reads "no grade yet"; before its insert lands, another
    // grader's grade is saved and released for the same submission.
    const service = buildGradingService(graderId, {
      findUnique: (args) => real.findUnique(args),
      findFirst: (args) => real.findFirst(args),
      findMany: (args) => real.findMany(args),
      update: (args) => real.update(args),
      create: async (args) => {
        if (!releasedId) {
          const winner = await testDb.prisma.grade.create({
            data: {
              assessmentId: f.assessmentId,
              enrolmentId: f.enrolmentId,
              submissionId: f.submissionId,
              score: 90,
              maxScore: 100,
              passed: true,
              status: "RELEASED",
              releasedAt: new Date(),
            },
          });
          releasedId = winner.id;
        }
        return real.create(args);
      },
    });

    const error = await service
      .saveDraftGrade({ submissionId: f.submissionId, score: 10, feedback: "Too late" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GradeAlreadyReleasedError);
    expect((error as GradeAlreadyReleasedError).gradeId).toBe(releasedId);

    const rows = await testDb.prisma.grade.findMany({ where: { submissionId: f.submissionId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: releasedId, status: "RELEASED", score: 90 });
  });

  it("quiz attempt grades (submissionId null) are not limited by the index", async () => {
    const f = await seedSubmission();
    for (const score of [40, 60]) {
      await testDb.prisma.grade.create({
        data: { assessmentId: f.assessmentId, enrolmentId: f.enrolmentId, submissionId: null, score, maxScore: 100 },
      });
    }
    const rows = await testDb.prisma.grade.findMany({
      where: { assessmentId: f.assessmentId, enrolmentId: f.enrolmentId, submissionId: null },
    });
    expect(rows).toHaveLength(2);
  });
});
