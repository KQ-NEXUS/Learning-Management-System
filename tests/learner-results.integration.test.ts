/**
 * Real-Postgres proof for the learner-facing results read (plan 10-09,
 * ASM-05/ASM-06/ASM-07's learner-visible half).
 *
 * The unit test for `learner-results-service.ts` drives `getOwnResults`
 * against an in-memory fake `grade.findMany` that simply never returns a
 * DRAFT row — it cannot prove the `status: "RELEASED"` filter is genuinely
 * applied by the DATABASE rather than by a later in-memory step, because the
 * fake has no way to hold a DRAFT row that the query might have leaked. This
 * file starts a throwaway `postgres:16-alpine` (`tests/support/pg.ts`),
 * deploys the checked-in migrations, seeds a REAL DRAFT `Grade` row
 * alongside a REAL RELEASED one, and asserts the DRAFT row is directly
 * readable through `testDb.prisma` (proving it exists) while being absent
 * from `getOwnResults`'s serialised output (proving the absence is a filter,
 * not missing data) — mirroring `tests/learner-journey.integration.test.ts`'s
 * DD-6 "read the real column, don't infer" discipline.
 *
 * None of `learner-access.ts`, `attempt-service.ts`, `submission-service.ts`
 * or `learner-results-service.ts` export a `createPrismaBacked*` convenience
 * factory that takes just a Prisma client — except `attempt-service.ts`,
 * which does (`createPrismaBackedAttemptService`, used below). Every other
 * service here is built directly from its injectable factory
 * (`createLearnerAccessService`, `createSubmissionService`,
 * `createLearnerResultsService`) against `testDb.prisma`-backed delegates,
 * mirroring `tests/grading-service.integration.test.ts`'s own approach for
 * the services that lack that convenience factory. `getOwnSubmissions` (the
 * one `submission-service.ts` export this file needs) never touches object
 * storage, so the storage/presign/audit dependencies it's still typed to
 * require are supplied as loud throwing stubs — if a future edit ever makes
 * it call one, this file fails immediately rather than silently hitting the
 * real `storage-service.ts` S3 client with no `S3_*` env vars configured.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — never a silent
 * pass, never a weakened mock. Docker is confirmed healthy in this
 * environment (10-RESEARCH.md Environment Availability).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import { createPrismaBackedAttemptService } from "@/server/services/attempt-service";
import {
  createSubmissionService,
  type SubmissionDelegate,
  type SubmissionStore,
  type SubmissionStorage,
  type SubmissionTxClient,
} from "@/server/services/submission-service";
import {
  createLearnerAccessService,
  type LearnerAccessStore,
} from "@/server/services/learner-access";
import {
  createLearnerResultsService,
  type LearnerResultsDeps,
} from "@/server/services/learner-results-service";
import {
  createGradeOverrideService,
  type GradeOverrideDeps,
  type GradeOverrideTx,
} from "@/server/services/grade-override-service";
import {
  createCohortScopeResolvers,
  type CohortScopeDelegate,
  type SessionScopeDelegate,
  type EnrolmentScopeDelegate,
} from "@/server/services/cohort-scope";
import { writeDomainEvent } from "@/server/services/domain-event-service";

let testDb: TestDatabase;
let uidCounter = 0;
const uid = (prefix: string) => `${prefix}-${(uidCounter += 1)}`;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Service builders — every one bound to testDb.prisma, never the app
// singleton (mirrors tests/grading-service.integration.test.ts).
// ---------------------------------------------------------------------------

async function auditSink(entry: {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome: string;
  reason?: string | null;
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

function buildSubmissionsReader() {
  const throwStub = (): never => {
    throw new Error("getOwnSubmissions never calls storage/presign/audit — this stub must never run");
  };
  const svc = createSubmissionService({
    delegate: testDb.prisma.submission as unknown as SubmissionDelegate,
    resolveAssessment: (assessmentId) =>
      testDb.prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: {
          id: true,
          courseId: true,
          type: true,
          status: true,
          version: true,
          dueAt: true,
          availableUntil: true,
          allowedFileTypes: true,
          maxFileSizeBytes: true,
          allowResubmission: true,
        },
      }) as never,
    store: testDb.prisma as unknown as SubmissionStore,
    storage: {
      presign: throwStub,
      inspect: throwStub,
      promote: throwStub,
      remove: throwStub,
      stagedKey: throwStub,
      finalKey: throwStub,
    } as unknown as SubmissionStorage,
    presignDownload: throwStub as never,
    audit: throwStub as never,
    writeEvent: writeDomainEvent,
    runInTransaction: (fn) => testDb.prisma.$transaction((tx) => fn(tx as unknown as SubmissionTxClient)),
  });
  return svc.getOwnSubmissions;
}

function buildResultsService() {
  const accessSvc = createLearnerAccessService({ store: testDb.prisma as unknown as LearnerAccessStore });
  const attemptSvc = createPrismaBackedAttemptService(testDb.prisma, auditSink);
  const getOwnSubmissions = buildSubmissionsReader();

  const resultsSvc = createLearnerResultsService({
    enrolment: testDb.prisma.enrolment as unknown as LearnerResultsDeps["enrolment"],
    loadPath: accessSvc.loadLearnerPath,
    assessment: testDb.prisma.assessment as unknown as LearnerResultsDeps["assessment"],
    grade: testDb.prisma.grade as unknown as LearnerResultsDeps["grade"],
    quizResult: attemptSvc.getOwnAssessmentResult,
    submissions: getOwnSubmissions,
    user: testDb.prisma.user as unknown as LearnerResultsDeps["user"],
    attempt: testDb.prisma.attempt as unknown as LearnerResultsDeps["attempt"],
  });

  return { resultsSvc, attemptSvc, accessSvc };
}

function buildOverrideService(graderId: string) {
  const { withPermission } = createTestWithPermission([grant("grades.manage")], { userId: graderId });
  const { enrolmentCohortScope } = createCohortScopeResolvers({
    cohort: testDb.prisma.cohort as unknown as CohortScopeDelegate,
    session: testDb.prisma.scheduledSession as unknown as SessionScopeDelegate,
    enrolment: testDb.prisma.enrolment as unknown as EnrolmentScopeDelegate,
  });
  return createGradeOverrideService({
    grade: testDb.prisma.grade as unknown as GradeOverrideDeps["grade"],
    enrolmentScope: enrolmentCohortScope,
    withPermission,
    runInTransaction: (fn) => testDb.prisma.$transaction((tx) => fn(tx as unknown as GradeOverrideTx)),
    writeEvent: writeDomainEvent,
    audit: auditSink,
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal, VALID `CourseObligationPayload` (`schema`, `completionRuleVersion`, empty `modules`) — this file needs `loadLearnerPath` to resolve `path.courses` to a non-empty list, not a real lesson tree. */
async function seedPinnedCourse() {
  const course = await testDb.prisma.course.create({
    data: { slug: uid("results-course"), title: "Results Fixture Course" },
    select: { id: true },
  });
  const publisher = await testDb.prisma.user.create({
    data: { email: `${uid("results-publisher")}@fixture.test`, name: "Fixture Publisher", isStaff: true },
    select: { id: true },
  });
  const publication = await testDb.prisma.coursePublication.create({
    data: {
      courseId: course.id,
      version: 1,
      payload: { schema: 1, completionRuleVersion: 1, modules: [] },
      payloadSchema: 1,
      publishedById: publisher.id,
    },
    select: { id: true },
  });
  return { courseId: course.id, publicationId: publication.id };
}

async function seedPinnedCohort() {
  const { courseId, publicationId } = await seedPinnedCourse();
  const { cohortId } = await seedCohortFixture(testDb.prisma, {
    courseId,
    coursePublicationId: publicationId,
    capacity: 10,
  });
  return { courseId, publicationId, cohortId };
}

/**
 * One pinned cohort with a published QUIZ (one 10-mark SINGLE_CHOICE
 * question, maxAttempts 2) and a published ASSIGNMENT (totalMarks 100,
 * passMark 50, feedbackBehaviour ON_RELEASE), plus two ACTIVE, activated
 * learner enrolments.
 */
async function seedResultsFixture() {
  const { courseId, cohortId } = await seedPinnedCohort();

  const quiz = await testDb.prisma.assessment.create({
    data: {
      courseId,
      type: "QUIZ",
      title: "Results Quiz",
      status: "PUBLISHED",
      version: 1,
      maxAttempts: 2,
      passMark: 5,
      totalMarks: 10,
      attemptGradingMethod: "HIGHEST",
    },
    select: { id: true },
  });
  const question = await testDb.prisma.quizQuestion.create({
    data: { assessmentId: quiz.id, position: 0, prompt: "Only question", type: "SINGLE_CHOICE", marks: 10 },
    select: { id: true },
  });
  const correctOption = await testDb.prisma.quizOption.create({
    data: { questionId: question.id, position: 0, label: "Correct", isCorrect: true },
    select: { id: true },
  });
  const wrongOption = await testDb.prisma.quizOption.create({
    data: { questionId: question.id, position: 1, label: "Wrong", isCorrect: false },
    select: { id: true },
  });

  const assignment = await testDb.prisma.assessment.create({
    data: {
      courseId,
      type: "ASSIGNMENT",
      title: "Results Assignment",
      status: "PUBLISHED",
      version: 1,
      totalMarks: 100,
      passMark: 50,
      allowedFileTypes: ["pdf"],
      allowResubmission: true,
      feedbackBehaviour: "ON_RELEASE",
    },
    select: { id: true },
  });

  const learner1 = await seedEnrolmentFixture(testDb.prisma, {
    cohortId,
    status: "ACTIVE",
    activatedAt: new Date(),
  });
  const learner2 = await seedEnrolmentFixture(testDb.prisma, {
    cohortId,
    status: "ACTIVE",
    activatedAt: new Date(),
  });

  return {
    courseId,
    cohortId,
    quizId: quiz.id,
    question: { id: question.id, correctOptionId: correctOption.id, wrongOptionId: wrongOption.id },
    assignmentId: assignment.id,
    learner1,
    learner2,
  };
}

// ---------------------------------------------------------------------------
// The card read — draft invisibility, cross-learner isolation, attempt
// selection, overrides, feedback gating
// ---------------------------------------------------------------------------

describe("getOwnResults — released-only read, draft invisibility, cross-learner isolation", () => {
  it(
    "returns the quiz result and the released assignment result but nothing from the draft-graded submission, follows attemptGradingMethod across two persisted attempts, reflects an override, gates feedback by feedbackBehaviour, and isolates a second learner",
    async () => {
      const f = await seedResultsFixture();
      const { resultsSvc, attemptSvc } = buildResultsService();
      const actor1 = { userId: f.learner1.userId };
      const actor2 = { userId: f.learner2.userId };

      // --- Two persisted quiz attempts: attempt 1 fully correct (score 10),
      // attempt 2 wrong (score 0) — set up BEFORE the card assertions so
      // both HIGHEST and LATEST can be exercised against real rows.
      const attempt1 = await attemptSvc.startAttempt(actor1, { assessmentId: f.quizId });
      await attemptSvc.submitAttempt(actor1, {
        attemptId: attempt1.id,
        responses: [{ questionId: f.question.id, selectedOptionIds: [f.question.correctOptionId] }],
      });
      const attempt2 = await attemptSvc.startAttempt(actor1, { assessmentId: f.quizId });
      await attemptSvc.submitAttempt(actor1, {
        attemptId: attempt2.id,
        responses: [{ questionId: f.question.id, selectedOptionIds: [f.question.wrongOptionId] }],
      });

      // --- Assignment: a DRAFT-graded first submission and a RELEASED
      // second submission for learner one.
      const staff = await seedLearnerFixture(testDb.prisma, { name: "Grading Staff" });
      const sub1 = await testDb.prisma.submission.create({
        data: {
          assessmentId: f.assignmentId,
          enrolmentId: f.learner1.enrolmentId,
          attemptNumber: 1,
          versionUsed: 1,
          storageKey: uid("submissions/l1-draft"),
          filename: "v1.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          uploadStatus: "READY",
        },
      });
      const draftGrade = await testDb.prisma.grade.create({
        data: {
          assessmentId: f.assignmentId,
          enrolmentId: f.learner1.enrolmentId,
          submissionId: sub1.id,
          score: 40,
          maxScore: 100,
          passed: false,
          status: "DRAFT",
          feedback: "draft-only-feedback-must-never-leak",
        },
      });
      const sub2 = await testDb.prisma.submission.create({
        data: {
          assessmentId: f.assignmentId,
          enrolmentId: f.learner1.enrolmentId,
          attemptNumber: 2,
          versionUsed: 1,
          storageKey: uid("submissions/l1-released"),
          filename: "v2.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          uploadStatus: "READY",
        },
      });
      const releasedGrade = await testDb.prisma.grade.create({
        data: {
          assessmentId: f.assignmentId,
          enrolmentId: f.learner1.enrolmentId,
          submissionId: sub2.id,
          score: 70,
          maxScore: 100,
          passed: true,
          status: "RELEASED",
          releasedAt: new Date(),
          releasedById: staff.userId,
          feedback: "Great improvement",
        },
      });

      // --- Learner two's OWN, independent released grade on the same
      // assessment — the cross-learner isolation fixture.
      const learner2Sub = await testDb.prisma.submission.create({
        data: {
          assessmentId: f.assignmentId,
          enrolmentId: f.learner2.enrolmentId,
          attemptNumber: 1,
          versionUsed: 1,
          storageKey: uid("submissions/l2-released"),
          filename: "l2.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          uploadStatus: "READY",
        },
      });
      await testDb.prisma.grade.create({
        data: {
          assessmentId: f.assignmentId,
          enrolmentId: f.learner2.enrolmentId,
          submissionId: learner2Sub.id,
          score: 20,
          maxScore: 100,
          passed: false,
          status: "RELEASED",
          releasedAt: new Date(),
          releasedById: staff.userId,
          feedback: "Learner two feedback",
        },
      });

      // -----------------------------------------------------------------
      // getOwnResults for learner one — HIGHEST (the default) picks
      // attempt 1 (score 10); the assignment card reflects the RELEASED
      // grade (70) and NOTHING from the DRAFT grade (40 / its feedback
      // string) anywhere in the serialised result.
      // -----------------------------------------------------------------
      const resultsBefore = await resultsSvc.getOwnResults(actor1, {});
      const quizCardBefore = resultsBefore.find((c) => c.assessmentId === f.quizId);
      const assignmentCardBefore = resultsBefore.find((c) => c.assessmentId === f.assignmentId);

      expect(quizCardBefore?.effectiveScore).toBe(10);
      expect(quizCardBefore?.maxScore).toBe(10);
      expect(quizCardBefore?.passed).toBe(true);

      expect(assignmentCardBefore?.effectiveScore).toBe(70);
      expect(assignmentCardBefore?.maxScore).toBe(100);
      expect(assignmentCardBefore?.passed).toBe(true);
      expect(assignmentCardBefore?.feedback).toBe("Great improvement");

      const serialisedBefore = JSON.stringify(resultsBefore);
      expect(serialisedBefore).not.toContain("draft-only-feedback-must-never-leak");
      expect(serialisedBefore.includes('"score":40')).toBe(false);

      // -----------------------------------------------------------------
      // The DRAFT row demonstrably exists in the database — the absence
      // above is a filter, not missing data.
      // -----------------------------------------------------------------
      const draftRow = await testDb.prisma.grade.findUniqueOrThrow({ where: { id: draftGrade.id } });
      expect(draftRow.status).toBe("DRAFT");
      expect(draftRow.score).toBe(40);

      // -----------------------------------------------------------------
      // D-02 — switching attemptGradingMethod to LATEST re-derives the
      // effective attempt fresh on the next read: attempt 2 (score 0) now
      // wins, even though attempt 1 scored higher.
      // -----------------------------------------------------------------
      await testDb.prisma.assessment.update({ where: { id: f.quizId }, data: { attemptGradingMethod: "LATEST" } });
      const resultsLatest = await resultsSvc.getOwnResults(actor1, {});
      const quizCardLatest = resultsLatest.find((c) => c.assessmentId === f.quizId);
      expect(quizCardLatest?.effectiveScore).toBe(0);
      expect(quizCardLatest?.passed).toBe(false);
      await testDb.prisma.assessment.update({ where: { id: f.quizId }, data: { attemptGradingMethod: "HIGHEST" } });

      // -----------------------------------------------------------------
      // Cross-learner isolation — learner two's card carries ONLY their
      // own 20, never learner one's 70/"Great improvement".
      // -----------------------------------------------------------------
      const results2 = await resultsSvc.getOwnResults(actor2, {});
      const assignmentCard2 = results2.find((c) => c.assessmentId === f.assignmentId);
      expect(assignmentCard2?.effectiveScore).toBe(20);
      const serialised2 = JSON.stringify(results2);
      expect(serialised2).not.toContain("Great improvement");
      expect(serialised2.includes('"score":70')).toBe(false);

      // -----------------------------------------------------------------
      // An actor with no enrolment anywhere in this cohort gets an empty
      // array, not an error and not another learner's data.
      // -----------------------------------------------------------------
      const stranger = await seedLearnerFixture(testDb.prisma, { name: "No Enrolment" });
      const strangerResults = await resultsSvc.getOwnResults({ userId: stranger.userId }, {});
      expect(strangerResults).toEqual([]);

      // -----------------------------------------------------------------
      // ASM-06 — overrideGrade on the RELEASED assignment grade appears on
      // the card with previous/new scores and the overriding actor's
      // display name, and the card's own score reflects the override.
      // -----------------------------------------------------------------
      const overrideSvc = buildOverrideService(staff.userId);
      await overrideSvc.overrideGrade({
        gradeId: releasedGrade.id,
        newScore: 85,
        reason: "Recalculated after a manual remark request",
      });

      const resultsAfterOverride = await resultsSvc.getOwnResults(actor1, {});
      const assignmentCardAfterOverride = resultsAfterOverride.find((c) => c.assessmentId === f.assignmentId);
      expect(assignmentCardAfterOverride?.effectiveScore).toBe(85);
      expect(assignmentCardAfterOverride?.overrides).toHaveLength(1);
      expect(assignmentCardAfterOverride?.overrides[0]).toMatchObject({
        previousScore: 70,
        newScore: 85,
        actorName: "Grading Staff",
      });

      // -----------------------------------------------------------------
      // Feedback gating — absent when feedbackBehaviour is NEVER, present
      // again once it reverts to ON_RELEASE.
      // -----------------------------------------------------------------
      await testDb.prisma.assessment.update({ where: { id: f.assignmentId }, data: { feedbackBehaviour: "NEVER" } });
      const resultsFeedbackOff = await resultsSvc.getOwnResults(actor1, {});
      expect(resultsFeedbackOff.find((c) => c.assessmentId === f.assignmentId)?.feedback).toBeNull();

      await testDb.prisma.assessment.update({
        where: { id: f.assignmentId },
        data: { feedbackBehaviour: "ON_RELEASE" },
      });
      const resultsFeedbackOn = await resultsSvc.getOwnResults(actor1, {});
      expect(resultsFeedbackOn.find((c) => c.assessmentId === f.assignmentId)?.feedback).toBe("Great improvement");
    },
    TEST_DB_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// getOwnAssessmentObligations
// ---------------------------------------------------------------------------

describe("getOwnAssessmentObligations — not-yet-attempted/not-submitted assessments", () => {
  it("lists both assessments for a freshly seeded enrolment and returns an empty array once every assessment has been attempted or submitted", async () => {
    const f = await seedResultsFixture();
    const { resultsSvc, attemptSvc } = buildResultsService();

    const third = await seedEnrolmentFixture(testDb.prisma, {
      cohortId: f.cohortId,
      status: "ACTIVE",
      activatedAt: new Date(),
    });
    const actor = { userId: third.userId };

    const before = await resultsSvc.getOwnAssessmentObligations(actor, { enrolmentId: third.enrolmentId });
    expect(before.map((o) => o.assessmentId).sort()).toEqual([f.assignmentId, f.quizId].sort());

    const attempt = await attemptSvc.startAttempt(actor, { assessmentId: f.quizId });
    await attemptSvc.submitAttempt(actor, {
      attemptId: attempt.id,
      responses: [{ questionId: f.question.id, selectedOptionIds: [f.question.correctOptionId] }],
    });
    await testDb.prisma.submission.create({
      data: {
        assessmentId: f.assignmentId,
        enrolmentId: third.enrolmentId,
        attemptNumber: 1,
        versionUsed: 1,
        storageKey: uid("submissions/third"),
        filename: "v1.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        uploadStatus: "READY",
      },
    });

    const after = await resultsSvc.getOwnAssessmentObligations(actor, { enrolmentId: third.enrolmentId });
    expect(after).toEqual([]);
  });
});
