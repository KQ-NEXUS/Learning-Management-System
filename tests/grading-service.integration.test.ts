/**
 * Real-Postgres proof for the grading service (plan 10-07/10-09,
 * ASM-05/ASM-06).
 *
 * The unit tests for `grading-service.ts`/`grade-override-service.ts` drive
 * every rule against an in-memory staged fake. That fake cannot prove that a
 * COHORT-scoped grant is genuinely DENIED — as opposed to merely filtered to
 * an empty result — against a sibling cohort's submission (the "silently
 * filtered" failure mode a fake cannot distinguish from a real denial);
 * cannot raise a real unique/FK constraint or roll back a `$transaction`
 * when a batch release partially fails; and cannot prove the released-grade
 * write boundary holds when the rows are real. This file starts a throwaway
 * `postgres:16-alpine` (`tests/support/pg.ts`), deploys the checked-in
 * migrations, and exercises the real schema — mirroring
 * `tests/attendance-service.integration.test.ts`'s own D-21 cross-cohort
 * denial proof for this phase's grading domain.
 *
 * `grading-service.ts` and `grade-override-service.ts` export only their
 * injectable factory functions (`createGradingService`,
 * `createGradeOverrideService`) plus a `prisma`-app-singleton-bound live
 * binding — there is no `createPrismaBacked*` convenience factory the way
 * `attendance-service.ts`/`attempt-service.ts` have. Every test below builds
 * its own instance directly against `testDb.prisma`-backed delegates and a
 * `tests/support/harness.ts` `withPermission`, never the live singleton
 * binding (mirrors `tests/attendance-service.integration.test.ts`'s
 * `serviceWithGrants`).
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — never a silent
 * pass, never a weakened mock. Docker is confirmed healthy in this
 * environment (10-RESEARCH.md Environment Availability).
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
  createGradeOverrideService,
  GradeNotReleasedError,
  type GradeOverrideDeps,
  type GradeOverrideTx,
} from "@/server/services/grade-override-service";
import { AuthorizationError, type RawGrant } from "@/server/permissions/with-permission";
import {
  createCohortScopeResolvers,
  type CohortScopeDelegate,
  type SessionScopeDelegate,
  type EnrolmentScopeDelegate,
} from "@/server/services/cohort-scope";
import { writeDomainEvent } from "@/server/services/domain-event-service";

let testDb: TestDatabase;
const DAY_MS = 86_400_000;
let uidCounter = 0;
const uid = (prefix: string) => `${prefix}-${(uidCounter += 1)}`;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Service builders — mirror the live `built` bindings at the bottom of
// grading-service.ts/grade-override-service.ts, but bound to testDb.prisma
// and a test-harness withPermission instead of the app singleton.
// ---------------------------------------------------------------------------

function scopeResolvers() {
  return createCohortScopeResolvers({
    cohort: testDb.prisma.cohort as unknown as CohortScopeDelegate,
    session: testDb.prisma.scheduledSession as unknown as SessionScopeDelegate,
    enrolment: testDb.prisma.enrolment as unknown as EnrolmentScopeDelegate,
  });
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

function buildGradingService(grants: RawGrant[], opts?: { userId?: string; grade?: GradingServiceDeps["grade"] }) {
  const { withPermission } = createTestWithPermission(grants, opts);
  const { enrolmentCohortScope, cohortResourceScope } = scopeResolvers();

  return createGradingService({
    grade: opts?.grade ?? testDb.prisma.grade as unknown as GradingServiceDeps["grade"],
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

function buildOverrideService(grants: RawGrant[], opts?: { userId?: string }) {
  const { withPermission } = createTestWithPermission(grants, opts);
  const { enrolmentCohortScope } = scopeResolvers();

  return createGradeOverrideService({
    grade: testDb.prisma.grade as unknown as GradeOverrideDeps["grade"],
    enrolmentScope: enrolmentCohortScope,
    withPermission,
    runInTransaction: (fn) => testDb.prisma.$transaction((tx) => fn(tx as unknown as GradeOverrideTx)),
    writeEvent: writeDomainEvent,
    audit: auditSink,
    // Plan 11-10's certificate-flag hook is out of this file's scope
    // (grading behaviour only) — a no-op fake keeps this suite compiling.
    reactToGradeOverride: async () => {},
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A shared Course under one Programme, with TWO Cohorts (A, B) each pinned
 * to the Programme (not the course directly) and each carrying a
 * `CohortCourse` row for the shared course — the shape that makes a
 * PROGRAMME-scoped or COURSE-scoped grant reach BOTH cohorts through
 * `cohortResourceScope`'s three-key resolution, while a COHORT-scoped grant
 * still reaches only its own cohort. One published ASSIGNMENT Assessment on
 * the shared course, with one READY Submission in each cohort.
 */
async function seedTwoCohortFixture() {
  const course = await testDb.prisma.course.create({
    data: { slug: uid("grading-fixture-course"), title: "Grading Fixture Course" },
    select: { id: true },
  });
  const programme = await testDb.prisma.programme.create({
    data: { slug: uid("grading-fixture-programme"), title: "Grading Fixture Programme" },
    select: { id: true },
  });

  const now = Date.now();
  const cohortBase = {
    deliveryMode: "INSTRUCTOR_LED" as const,
    timezone: "Africa/Lagos",
    startsAt: new Date(now + 7 * DAY_MS),
    endsAt: new Date(now + 30 * DAY_MS),
    enrolmentOpensAt: new Date(now - 7 * DAY_MS),
    enrolmentClosesAt: new Date(now + 5 * DAY_MS),
    capacity: 5,
    priceMinor: 0,
  };

  const cohortA = await testDb.prisma.cohort.create({
    data: { code: uid("COH-A"), title: "Cohort A", programmeId: programme.id, ...cohortBase },
    select: { id: true },
  });
  const cohortB = await testDb.prisma.cohort.create({
    data: { code: uid("COH-B"), title: "Cohort B", programmeId: programme.id, ...cohortBase },
    select: { id: true },
  });

  await testDb.prisma.cohortCourse.create({
    data: { cohortId: cohortA.id, courseId: course.id, position: 0, contentVersion: 1 },
  });
  await testDb.prisma.cohortCourse.create({
    data: { cohortId: cohortB.id, courseId: course.id, position: 0, contentVersion: 1 },
  });

  const assessment = await testDb.prisma.assessment.create({
    data: {
      courseId: course.id,
      type: "ASSIGNMENT",
      title: "Fixture Assignment",
      status: "PUBLISHED",
      version: 1,
      totalMarks: 100,
      passMark: 50,
      allowedFileTypes: ["pdf"],
    },
    select: { id: true },
  });

  const enrA = await seedEnrolmentFixture(testDb.prisma, { cohortId: cohortA.id });
  const enrB = await seedEnrolmentFixture(testDb.prisma, { cohortId: cohortB.id });

  const subA = await testDb.prisma.submission.create({
    data: {
      assessmentId: assessment.id,
      enrolmentId: enrA.enrolmentId,
      attemptNumber: 1,
      versionUsed: 1,
      storageKey: uid("submissions/a"),
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      uploadStatus: "READY",
    },
  });
  const subB = await testDb.prisma.submission.create({
    data: {
      assessmentId: assessment.id,
      enrolmentId: enrB.enrolmentId,
      attemptNumber: 1,
      versionUsed: 1,
      storageKey: uid("submissions/b"),
      filename: "b.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      uploadStatus: "READY",
    },
  });

  return {
    courseId: course.id,
    programmeId: programme.id,
    cohortAId: cohortA.id,
    cohortBId: cohortB.id,
    assessmentId: assessment.id,
    enrA,
    enrB,
    subA,
    subB,
  };
}

/** `count` READY submissions for a fresh enrolment each, all in ONE cohort, for one published ASSIGNMENT assessment — the shape the batch-release cases need. */
async function seedBatchFixture(count: number) {
  const { cohortId, courseId } = await seedCohortFixture(testDb.prisma);
  const assessment = await testDb.prisma.assessment.create({
    data: {
      courseId,
      type: "ASSIGNMENT",
      title: "Batch Fixture Assignment",
      status: "PUBLISHED",
      version: 1,
      totalMarks: 100,
      passMark: 50,
      allowedFileTypes: ["pdf"],
    },
    select: { id: true },
  });

  const submissions = [];
  for (let i = 0; i < count; i += 1) {
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });
    const sub = await testDb.prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        enrolmentId,
        attemptNumber: 1,
        versionUsed: 1,
        storageKey: uid("submissions/batch"),
        filename: `f${i}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 10,
        uploadStatus: "READY",
      },
    });
    submissions.push(sub);
  }

  return { cohortId, courseId, assessmentId: assessment.id, submissions };
}

async function seedGrader(name: string) {
  return (await seedLearnerFixture(testDb.prisma, { name })).userId;
}

// ---------------------------------------------------------------------------
// D-21 / T-10-03 — Cohort scoping
// ---------------------------------------------------------------------------

describe("listGradingQueue / saveDraftGrade — COHORT scoping (T-10-03)", () => {
  it("refuses a stale draft save when release wins between the read and write", async () => {
    const f = await seedBatchFixture(1);
    const graderId = await seedGrader("Concurrent release grader");
    const grants = [grant("grades.manage")];
    const releaseService = buildGradingService(grants, { userId: graderId });
    const draft = await releaseService.saveDraftGrade({ submissionId: f.submissions[0].id, score: 75, feedback: "Original feedback" });
    const delegate = testDb.prisma.grade as unknown as GradingServiceDeps["grade"];
    const staleSave = buildGradingService(grants, { userId: graderId, grade: {
      findUnique: args => delegate.findUnique(args),
      findFirst: args => delegate.findFirst(args),
      findMany: args => delegate.findMany(args),
      create: args => delegate.create(args),
      update: async args => {
        await releaseService.releaseGrade({ gradeId: draft.id });
        return delegate.update(args);
      },
    } });
    await expect(staleSave.saveDraftGrade({ submissionId: f.submissions[0].id, score: 10, feedback: "Stale feedback" }))
      .rejects.toBeInstanceOf(GradeAlreadyReleasedError);
    const persisted = await testDb.prisma.grade.findUniqueOrThrow({ where: { id: draft.id } });
    expect(persisted).toMatchObject({ status: "RELEASED", score: 75, feedback: "Original feedback" });
    expect(persisted.releasedAt).not.toBeNull();
  });
  it("a COHORT-scoped submissions.view grant for Cohort A returns only Cohort A's rows and throws AuthorizationError for Cohort B", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Grader Cohort A");
    const svc = buildGradingService([grant("submissions.view", "COHORT", f.cohortAId)], {
      userId: graderId,
    });

    const rowsA = await svc.listGradingQueue({ cohortId: f.cohortAId, assessmentId: f.assessmentId });
    expect(rowsA.map((r) => r.submissionId)).toEqual([f.subA.id]);

    await expect(
      svc.listGradingQueue({ cohortId: f.cohortBId, assessmentId: f.assessmentId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a COHORT-scoped grades.manage grant for Cohort A throws AuthorizationError on saveDraftGrade for a Cohort B submission and writes no Grade row", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Grader Cohort A Only");
    const svc = buildGradingService([grant("grades.manage", "COHORT", f.cohortAId)], {
      userId: graderId,
    });

    await expect(
      svc.saveDraftGrade({ submissionId: f.subB.id, score: 10, feedback: null }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const grades = await testDb.prisma.grade.findMany({ where: { submissionId: f.subB.id } });
    expect(grades).toHaveLength(0);
  });

  it("a PROGRAMME-scoped grant covering both cohorts succeeds on both (three-key scope resolution)", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Programme Manager");
    const svc = buildGradingService([grant("grades.manage", "PROGRAMME", f.programmeId)], {
      userId: graderId,
    });

    const gradeA = await svc.saveDraftGrade({ submissionId: f.subA.id, score: 60, feedback: null });
    expect(gradeA.status).toBe("DRAFT");
    const gradeB = await svc.saveDraftGrade({ submissionId: f.subB.id, score: 70, feedback: null });
    expect(gradeB.status).toBe("DRAFT");
  });

  it("a COURSE-scoped grant likewise succeeds on both cohorts", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Course Manager");
    const svc = buildGradingService([grant("grades.manage", "COURSE", f.courseId)], {
      userId: graderId,
    });

    const gradeA = await svc.saveDraftGrade({ submissionId: f.subA.id, score: 60, feedback: null });
    expect(gradeA.status).toBe("DRAFT");
    const gradeB = await svc.saveDraftGrade({ submissionId: f.subB.id, score: 70, feedback: null });
    expect(gradeB.status).toBe("DRAFT");
  });
});

// ---------------------------------------------------------------------------
// T-10-04 — the draft/release boundary
// ---------------------------------------------------------------------------

describe("saveDraftGrade / releaseGrade — the draft/release write boundary", () => {
  it("saveDraftGrade writes a DRAFT grade with null releasedAt/releasedById and no DomainEvent row", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Draft Saver");
    const svc = buildGradingService([grant("grades.manage")], { userId: graderId });

    const before = await testDb.prisma.domainEvent.count();
    const grade = await svc.saveDraftGrade({ submissionId: f.subA.id, score: 55, feedback: "Nice work" });
    expect(grade.status).toBe("DRAFT");
    expect(grade.releasedAt).toBeNull();
    expect(grade.releasedById).toBeNull();

    const after = await testDb.prisma.domainEvent.count();
    expect(after).toBe(before);
  });

  it("releaseGrade writes RELEASED with the acting user as releasedById, one grade.released DomainEvent and one grade.released AuditEvent", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Releaser");
    const svc = buildGradingService([grant("grades.manage")], { userId: graderId });

    const draft = await svc.saveDraftGrade({ submissionId: f.subA.id, score: 55, feedback: null });
    const released = await svc.releaseGrade({ gradeId: draft.id });
    expect(released.status).toBe("RELEASED");
    expect(released.releasedById).toBe(graderId);

    const events = await testDb.prisma.domainEvent.findMany({ where: { type: "grade.released" } });
    const ownEvents = events.filter((e) => (e.payload as Record<string, unknown>).gradeId === draft.id);
    expect(ownEvents).toHaveLength(1);

    const audits = await testDb.prisma.auditEvent.findMany({
      where: { action: "grade.released", targetId: draft.id },
    });
    expect(audits).toHaveLength(1);
  });

  it("saveDraftGrade on a RELEASED grade throws GradeAlreadyReleasedError and leaves the persisted score unchanged", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Draft After Release");
    const svc = buildGradingService([grant("grades.manage")], { userId: graderId });

    const draft = await svc.saveDraftGrade({ submissionId: f.subA.id, score: 60, feedback: null });
    const released = await svc.releaseGrade({ gradeId: draft.id });

    await expect(
      svc.saveDraftGrade({ submissionId: f.subA.id, score: 99, feedback: "changed" }),
    ).rejects.toBeInstanceOf(GradeAlreadyReleasedError);

    const row = await testDb.prisma.grade.findUniqueOrThrow({ where: { id: released.id } });
    expect(row.score).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// D-06 / T-10-09 — batch release atomicity and all-or-nothing authorization
// ---------------------------------------------------------------------------

describe("releaseGradesBatch — atomicity and all-or-nothing authorization (D-06, T-10-09)", () => {
  it("releases three DRAFT grades, writing exactly three grade updates, three grade.released outbox rows, three per-grade audit rows, plus the batch-level entry", async () => {
    const f = await seedBatchFixture(3);
    const graderId = await seedGrader("Batch Releaser");
    const svc = buildGradingService([grant("grades.manage", "COHORT", f.cohortId)], { userId: graderId });

    const drafts: Array<{ id: string }> = [];
    for (const sub of f.submissions) {
      drafts.push(await svc.saveDraftGrade({ submissionId: sub.id, score: 60, feedback: null }));
    }

    const result = await svc.releaseGradesBatch({ gradeIds: drafts.map((d) => d.id) });
    expect(result.released.sort()).toEqual(drafts.map((d) => d.id).sort());
    expect(result.skipped).toHaveLength(0);

    const rows = await testDb.prisma.grade.findMany({ where: { id: { in: drafts.map((d) => d.id) } } });
    expect(rows.every((r) => r.status === "RELEASED")).toBe(true);

    const events = await testDb.prisma.domainEvent.findMany({ where: { type: "grade.released" } });
    const ownEvents = events.filter((e) =>
      drafts.some((d) => d.id === (e.payload as Record<string, unknown>).gradeId),
    );
    expect(ownEvents).toHaveLength(3);

    const perGradeAudits = await testDb.prisma.auditEvent.findMany({
      where: { action: "grade.released", targetId: { in: drafts.map((d) => d.id) } },
    });
    expect(perGradeAudits).toHaveLength(3);

    const batchAudits = await testDb.prisma.auditEvent.findMany({ where: { action: "grade.released_batch" } });
    const ownBatchAudits = batchAudits.filter((a) => {
      const after = a.after as Record<string, unknown> | null;
      const released = (after?.released as string[] | undefined) ?? [];
      return drafts.every((d) => released.includes(d.id));
    });
    expect(ownBatchAudits).toHaveLength(1);
  });

  it("refuses a batch spanning Cohort A and Cohort B under a Cohort-A-only grant and leaves every grade's status unchanged", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Mixed Batch Attempt");
    const globalSvc = buildGradingService([grant("grades.manage")], { userId: graderId });

    const gradeA = await globalSvc.saveDraftGrade({ submissionId: f.subA.id, score: 60, feedback: null });
    const gradeB = await globalSvc.saveDraftGrade({ submissionId: f.subB.id, score: 70, feedback: null });

    const scopedSvc = buildGradingService([grant("grades.manage", "COHORT", f.cohortAId)], {
      userId: graderId,
    });

    await expect(
      scopedSvc.releaseGradesBatch({ gradeIds: [gradeA.id, gradeB.id] }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const rows = await testDb.prisma.grade.findMany({ where: { id: { in: [gradeA.id, gradeB.id] } } });
    expect(rows.every((r) => r.status === "DRAFT")).toBe(true);
  });

  it("releases only the DRAFT ids in a mixed DRAFT/already-RELEASED batch, reports the rest as skipped, and writes no second event for the already-released one", async () => {
    const f = await seedBatchFixture(2);
    const graderId = await seedGrader("Mixed Status Batch");
    const svc = buildGradingService([grant("grades.manage", "COHORT", f.cohortId)], { userId: graderId });

    const draft1 = await svc.saveDraftGrade({ submissionId: f.submissions[0].id, score: 60, feedback: null });
    const draft2 = await svc.saveDraftGrade({ submissionId: f.submissions[1].id, score: 70, feedback: null });
    const alreadyReleased = await svc.releaseGrade({ gradeId: draft2.id });

    const beforeEvents = await testDb.prisma.domainEvent.findMany({ where: { type: "grade.released" } });
    const beforeCount = beforeEvents.filter(
      (e) => (e.payload as Record<string, unknown>).gradeId === alreadyReleased.id,
    ).length;

    const result = await svc.releaseGradesBatch({ gradeIds: [draft1.id, alreadyReleased.id] });
    expect(result.released).toEqual([draft1.id]);
    expect(result.skipped).toEqual([alreadyReleased.id]);

    const afterEvents = await testDb.prisma.domainEvent.findMany({ where: { type: "grade.released" } });
    const afterCount = afterEvents.filter(
      (e) => (e.payload as Record<string, unknown>).gradeId === alreadyReleased.id,
    ).length;
    expect(afterCount).toBe(beforeCount);
  });
});

// ---------------------------------------------------------------------------
// ASM-06 / T-10-05 — the override boundary
// ---------------------------------------------------------------------------

describe("overrideGrade — the ONLY path that may change an already-released score (ASM-06)", () => {
  it("succeeds on a RELEASED grade with a reason, writes a GradeOverride row whose previousScore matches the pre-override database value, keeps status RELEASED, and writes one grade.overridden event and audit row", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Override Grader");
    const gradingSvc = buildGradingService([grant("grades.manage")], { userId: graderId });

    const draft = await gradingSvc.saveDraftGrade({ submissionId: f.subA.id, score: 60, feedback: null });
    const released = await gradingSvc.releaseGrade({ gradeId: draft.id });

    const overrideSvc = buildOverrideService([grant("grades.manage")], { userId: graderId });
    const result = await overrideSvc.overrideGrade({
      gradeId: released.id,
      newScore: 75,
      reason: "Recalculated after appeal review",
    });

    expect(result.grade.status).toBe("RELEASED");
    expect(result.override.previousScore).toBe(60);
    expect(result.override.newScore).toBe(75);

    const overrideRows = await testDb.prisma.gradeOverride.findMany({ where: { gradeId: released.id } });
    expect(overrideRows).toHaveLength(1);

    const events = await testDb.prisma.domainEvent.findMany({ where: { type: "grade.overridden" } });
    const ownEvents = events.filter((e) => (e.payload as Record<string, unknown>).gradeId === released.id);
    expect(ownEvents).toHaveLength(1);

    const audits = await testDb.prisma.auditEvent.findMany({
      where: { action: "grade.overridden", targetId: released.id },
    });
    expect(audits).toHaveLength(1);
  });

  it("throws GradeNotReleasedError on a DRAFT grade and writes no GradeOverride row", async () => {
    const f = await seedTwoCohortFixture();
    const graderId = await seedGrader("Override On Draft");
    const gradingSvc = buildGradingService([grant("grades.manage")], { userId: graderId });
    const draft = await gradingSvc.saveDraftGrade({ submissionId: f.subA.id, score: 60, feedback: null });

    const overrideSvc = buildOverrideService([grant("grades.manage")], { userId: graderId });
    await expect(
      overrideSvc.overrideGrade({ gradeId: draft.id, newScore: 75, reason: "Attempted override on a draft grade" }),
    ).rejects.toBeInstanceOf(GradeNotReleasedError);

    const overrideRows = await testDb.prisma.gradeOverride.findMany({ where: { gradeId: draft.id } });
    expect(overrideRows).toHaveLength(0);
  });
});
