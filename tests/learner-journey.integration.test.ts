/**
 * Real-Postgres proof for the whole learner journey (09-14, LRN-01..LRN-07).
 *
 * Every phase-9 unit test drives its service through an in-memory staged
 * fake. None of them can prove: a real `LessonProgress`/`CompletionRecord`
 * unique-index round trip, a real transaction committing the lesson-progress
 * write and the completion recalculation atomically, or that
 * `Enrolment.status` genuinely never moves in the live schema (DD-6). This
 * file starts a throwaway `postgres:16-alpine` (`tests/support/pg.ts`),
 * deploys the checked-in migrations, and drives one learner through the
 * whole delivery path against the real schema: sequencing/locking, the
 * idempotent double-mark, the free undo and its re-lock, the video 90%
 * auto-completion threshold, attendance-gated completion with a real
 * supersede-then-resatisfy cycle, the DD-6 read-back, the LRN-03 ownership
 * predicate, and the LRN-06 meeting-link visibility gate — then proves
 * cross-learner isolation (LRN-01, T-09-01) against a second real learner.
 *
 * `learner-access.ts`, `lesson-progress-service.ts`,
 * `enrolment-dashboard-service.ts` and `learner-session-service.ts` all bind
 * their exported functions to the singleton `prisma` client exported by
 * `@/server/db`, constructed the FIRST time that module is evaluated,
 * reading `process.env.DATABASE_URL` at that instant (the same hazard
 * `tests/checkout-webhook.integration.test.ts`'s own header documents for
 * the Stripe webhook route). This file therefore takes NO static top-level
 * import of any of those four modules — every one is imported dynamically
 * inside `beforeAll`, AFTER `process.env.DATABASE_URL` is pointed at the
 * Testcontainers instance, so their writes land in the same container this
 * file's assertions read from.
 *
 * `attendance-service.ts` is the one exception: its `createPrismaBackedAttendanceService`
 * factory takes an explicit Prisma client (the same shape
 * `tests/attendance-service.integration.test.ts` already uses), so this file
 * builds its own instance directly against `testDb.prisma` with a real
 * harness `withPermission` — no live-singleton binding involved.
 *
 * LRN-03 is proved via `learner-access.ts`'s `hasActiveEnrolmentCoveringCourse`
 * — the exact ownership predicate `lesson-resource-service.ts`'s
 * `getDownloadableResourceForLearner` calls before ever reading a resource
 * row — rather than through that service's own export. This environment has
 * `@aws-sdk/client-s3` declared in package.json but not installed in
 * `node_modules` (a pre-existing sandbox gap, unrelated to this plan's
 * changes; a package install is not an auto-fixable action per the executor's
 * own package-legitimacy rule), and `lesson-resource-service.ts` imports
 * `storage-service.ts`, which imports that package at module load — so
 * dynamically importing it here would fail on an environment gap that has
 * nothing to do with the ownership logic LRN-03 actually asks this file to
 * prove.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — never a silent
 * pass, never a weakened mock (`.planning/STATE.md` "Blockers/Concerns"
 * records this exact gate for Phase 6's own integration suite in a
 * Docker-less sandbox; this file follows the identical honesty rule).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";
import {
  seedCohortFixture,
  seedEnrolmentFixture,
  seedLearnerFixture,
  seedSessionFixture,
} from "./support/cohort-fixtures";

type PrismaLike = TestDatabase["prisma"];

type LearnerAccessModule = typeof import("@/server/services/learner-access");
type LessonProgressModule = typeof import("@/server/services/lesson-progress-service");
type DashboardModule = typeof import("@/server/services/enrolment-dashboard-service");
type LearnerSessionModule = typeof import("@/server/services/learner-session-service");
type AttendanceModule = typeof import("@/server/services/attendance-service");

let testDb: TestDatabase;

// Bound inside beforeAll, AFTER process.env.DATABASE_URL points at the
// Testcontainers instance — see file header.
let getOwnActiveEnrolment: LearnerAccessModule["getOwnActiveEnrolment"];
let loadLearnerPath: LearnerAccessModule["loadLearnerPath"];
let hasActiveEnrolmentCoveringCourse: LearnerAccessModule["hasActiveEnrolmentCoveringCourse"];
let markLessonComplete: LessonProgressModule["markLessonComplete"];
let undoLessonComplete: LessonProgressModule["undoLessonComplete"];
let recordWatchProgress: LessonProgressModule["recordWatchProgress"];
let loadLearnerDashboard: DashboardModule["loadLearnerDashboard"];
let listOwnCohortSessions: LearnerSessionModule["listOwnCohortSessions"];
let markAttendance: ReturnType<AttendanceModule["createPrismaBackedAttendanceService"]>["markAttendance"];

const HOUR_MS = 3_600_000;
let uidCounter = 0;
const uid = (prefix: string) => `${prefix}-${(uidCounter += 1)}`;

// A deliberately long blocking-lesson title — LRN-02 names the blocker by
// TITLE, never a position, and this proves the real string round-trips
// through the pinned publication payload and back out of `loadLearnerPath`
// unchanged.
const LESSON_1_TITLE =
  "Foundations of Practical Assessment Design for Working Professionals in Regulated Industries";

/**
 * One published Course with two modules and four lessons (three required,
 * one optional, one of the required ones VIDEO) — the exact shape this
 * plan's fixture behavior bullet describes. Lesson `position` values are
 * MODULE-LOCAL and reset to 0 in module B (0,1 in module A; 0,1 again in
 * module B) — this is how every real published course is authored (module
 * position and lesson-within-module position are independent columns; see
 * `prisma/seed.ts`), not an edge case to avoid. `learner-access.ts`'s
 * `loadLearnerPath` (and `lesson-progress-service.ts`'s duplicate walk)
 * once collided these module-local resets into the same synthesised global
 * position — found via the 09-14 human walkthrough against real seed data,
 * fixed by replacing the synthesised position with a running index over
 * the already-correctly-ordered course/module/lesson walk. Keeping this
 * fixture's positions module-local (rather than the globally-increasing
 * 0,1,2,3 an earlier version of this file used) is what makes this
 * real-Postgres suite independently exercise that exact defect class,
 * rather than only the unit-level regression in `tests/learner-access.test.ts`.
 */
async function seedLearnerJourneyCourse(prisma: PrismaLike) {
  const courseId = uid("course");
  await prisma.course.create({ data: { id: courseId, slug: uid("course-slug"), title: "Learner Journey Course" } });

  const moduleAId = uid("mod-a");
  const moduleBId = uid("mod-b");
  await prisma.module.create({ data: { id: moduleAId, courseId, title: "Module A", position: 0 } });
  await prisma.module.create({ data: { id: moduleBId, courseId, title: "Module B", position: 1 } });

  const lesson1Id = uid("lesson-req-1");
  const lesson2Id = uid("lesson-req-2");
  const lesson3Id = uid("lesson-req-video");
  const lesson4Id = uid("lesson-optional");

  await prisma.lesson.create({
    data: { id: lesson1Id, moduleId: moduleAId, title: LESSON_1_TITLE, type: "TEXT", position: 0, required: true, allowManualComplete: true },
  });
  await prisma.lesson.create({
    data: { id: lesson2Id, moduleId: moduleAId, title: "Required Lesson Two", type: "TEXT", position: 1, required: true, allowManualComplete: true },
  });
  await prisma.lesson.create({
    data: { id: lesson3Id, moduleId: moduleBId, title: "Required Video Lesson", type: "VIDEO", position: 0, required: true, allowManualComplete: true },
  });
  await prisma.lesson.create({
    data: { id: lesson4Id, moduleId: moduleBId, title: "Optional Wrap-up", type: "TEXT", position: 1, required: false, allowManualComplete: true },
  });

  const publisher = await prisma.user.create({
    data: { email: `${uid("publisher")}@fixture.test`, name: "Fixture Publisher", isStaff: true },
  });

  // DD-3's v1 shape — `{ version: 1, requireAllRequiredLessons: true }` —
  // the only keys `completion-rule.ts`'s RECOGNISED_V1_KEYS accepts.
  const payload = {
    schema: 1,
    completionRule: { version: 1, requireAllRequiredLessons: true },
    completionRuleVersion: 1,
    modules: [
      {
        id: moduleAId,
        position: 0,
        lessons: [
          { id: lesson1Id, position: 0, required: true, type: "TEXT", assessmentId: null },
          { id: lesson2Id, position: 1, required: true, type: "TEXT", assessmentId: null },
        ],
      },
      {
        id: moduleBId,
        position: 1,
        lessons: [
          { id: lesson3Id, position: 0, required: true, type: "VIDEO", assessmentId: null },
          { id: lesson4Id, position: 1, required: false, type: "TEXT", assessmentId: null },
        ],
      },
    ],
  };

  const publication = await prisma.coursePublication.create({
    data: { courseId, version: 1, payload, payloadSchema: 1, publishedById: publisher.id },
    select: { id: true },
  });

  return {
    courseId,
    lesson1Id,
    lesson2Id,
    lesson3Id,
    lesson4Id,
    publicationId: publication.id,
  };
}

/** A SELF_PACED cohort pinned to `courseId`/`publicationId`, with the D-10(b) attendance threshold (75%) and a 30-day access window. */
async function seedSelfPacedCohort(
  prisma: PrismaLike,
  args: { courseId: string; publicationId: string },
) {
  const { cohortId } = await seedCohortFixture(prisma, {
    courseId: args.courseId,
    deliveryMode: "SELF_PACED",
    accessDurationDays: 30,
    attendanceThresholdPct: 75,
    coursePublicationId: args.publicationId,
    capacity: 10,
  });
  return { cohortId };
}

/** An ACTIVE, already-activated enrolment (SELF_PACED's access window needs `activatedAt` set — a `null` value reads as D-01's named "not-started" gap, which would refuse every lesson). */
async function seedActivatedEnrolment(
  prisma: PrismaLike,
  args: { cohortId: string; userId?: string },
) {
  return seedEnrolmentFixture(prisma, {
    cohortId: args.cohortId,
    userId: args.userId,
    status: "ACTIVE",
    activatedAt: new Date(),
  });
}

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before any dynamic import below — see file header.
  process.env.DATABASE_URL = testDb.url;

  const learnerAccess: LearnerAccessModule = await import("@/server/services/learner-access");
  const lessonProgress: LessonProgressModule = await import("@/server/services/lesson-progress-service");
  const dashboardModule: DashboardModule = await import("@/server/services/enrolment-dashboard-service");
  const sessionModule: LearnerSessionModule = await import("@/server/services/learner-session-service");
  const attendanceModule: AttendanceModule = await import("@/server/services/attendance-service");

  getOwnActiveEnrolment = learnerAccess.getOwnActiveEnrolment;
  loadLearnerPath = learnerAccess.loadLearnerPath;
  hasActiveEnrolmentCoveringCourse = learnerAccess.hasActiveEnrolmentCoveringCourse;
  markLessonComplete = lessonProgress.markLessonComplete;
  undoLessonComplete = lessonProgress.undoLessonComplete;
  recordWatchProgress = lessonProgress.recordWatchProgress;
  loadLearnerDashboard = dashboardModule.loadLearnerDashboard;
  listOwnCohortSessions = sessionModule.listOwnCohortSessions;

  const attendanceActorId = (await seedLearnerFixture(testDb.prisma, { name: "Ops Staff" })).userId;
  const { withPermission: attendanceWithPermission } = createTestWithPermission(
    [grant("attendance.manage"), grant("attendance.view")],
    { userId: attendanceActorId },
  );
  markAttendance = attendanceModule.createPrismaBackedAttendanceService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    testDb.prisma as any,
    attendanceWithPermission,
  ).markAttendance;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("the learner journey — real Postgres (LRN-01..LRN-07)", () => {
  it(
    "sequencing/lock, idempotent double-mark, free undo + re-lock, video 90% auto-completion, attendance-gated completion with a real supersede-then-resatisfy cycle, and DD-6",
    async () => {
      const { courseId, lesson1Id, lesson2Id, lesson3Id, publicationId } =
        await seedLearnerJourneyCourse(testDb.prisma);
      const { cohortId } = await seedSelfPacedCohort(testDb.prisma, { courseId, publicationId });
      const { enrolmentId, userId } = await seedActivatedEnrolment(testDb.prisma, { cohortId });
      const learner = { userId };

      const baseNow = new Date();

      // -----------------------------------------------------------------
      // LRN-02 — the second required lesson is locked with the first's
      // title, and unlocks after the first is completed.
      // -----------------------------------------------------------------
      const findLesson = (path: NonNullable<Awaited<ReturnType<typeof loadLearnerPath>>>, lessonId: string) => {
        for (const course of path.courses) {
          for (const mod of course.modules) {
            for (const lesson of mod.lessons) {
              if (lesson.id === lessonId) return lesson;
            }
          }
        }
        throw new Error(`lesson ${lessonId} not found in path`);
      };

      const pathBefore = await loadLearnerPath(learner, enrolmentId);
      expect(pathBefore).not.toBeNull();
      expect(findLesson(pathBefore!, lesson2Id).locked).toBe(true);
      expect(findLesson(pathBefore!, lesson2Id).blockingLessonTitle).toBe(LESSON_1_TITLE);

      // -----------------------------------------------------------------
      // LRN-05 — manual mark, then LRN-04/05 — marking twice yields ONE
      // LessonProgress row (idempotent no-op, never a second row/error).
      // -----------------------------------------------------------------
      await markLessonComplete(learner, { enrolmentId, lessonId: lesson1Id });
      await markLessonComplete(learner, { enrolmentId, lessonId: lesson1Id });
      expect(
        await testDb.prisma.lessonProgress.count({ where: { enrolmentId, lessonId: lesson1Id } }),
      ).toBe(1);

      const pathAfterLesson1 = await loadLearnerPath(learner, enrolmentId);
      expect(findLesson(pathAfterLesson1!, lesson2Id).locked).toBe(false);

      // -----------------------------------------------------------------
      // LRN-05/D-16 — undo removes the row and re-locks lesson 2.
      // -----------------------------------------------------------------
      await undoLessonComplete(learner, { enrolmentId, lessonId: lesson1Id });
      expect(
        await testDb.prisma.lessonProgress.count({ where: { enrolmentId, lessonId: lesson1Id } }),
      ).toBe(0);
      const pathAfterUndo = await loadLearnerPath(learner, enrolmentId);
      expect(findLesson(pathAfterUndo!, lesson2Id).locked).toBe(true);
      expect(findLesson(pathAfterUndo!, lesson2Id).blockingLessonTitle).toBe(LESSON_1_TITLE);

      // Re-complete lesson 1 and 2 so the journey can proceed to lesson 3.
      await markLessonComplete(learner, { enrolmentId, lessonId: lesson1Id });
      await markLessonComplete(learner, { enrolmentId, lessonId: lesson2Id });

      // -----------------------------------------------------------------
      // LRN-04 (video, D-17) — 50% creates no LessonProgress row; 91%
      // creates one with source AUTO_VIDEO.
      // -----------------------------------------------------------------
      await recordWatchProgress(learner, {
        enrolmentId,
        lessonId: lesson3Id,
        secondsWatched: 50,
        durationSeconds: 100,
      });
      expect(
        await testDb.prisma.lessonProgress.findUnique({
          where: { enrolmentId_lessonId: { enrolmentId, lessonId: lesson3Id } },
        }),
      ).toBeNull();

      const watchResult = await recordWatchProgress(learner, {
        enrolmentId,
        lessonId: lesson3Id,
        secondsWatched: 91,
        durationSeconds: 100,
      });
      expect(watchResult.completed).toBe(true);
      const videoProgressRow = await testDb.prisma.lessonProgress.findUnique({
        where: { enrolmentId_lessonId: { enrolmentId, lessonId: lesson3Id } },
      });
      expect(videoProgressRow?.source).toBe("AUTO_VIDEO");

      // -----------------------------------------------------------------
      // LRN-07 — all three required lessons are now complete, but
      // attendance is still 0% (no sessions marked yet) — below the 75%
      // threshold — so the verdict is unsatisfied and NO CompletionRecord
      // exists.
      // -----------------------------------------------------------------
      expect(
        await testDb.prisma.completionRecord.count({ where: { enrolmentId, scope: "COURSE" } }),
      ).toBe(0);

      // -----------------------------------------------------------------
      // LRN-07 — recording enough attendance (3 of 4 countable sessions =
      // 75%, exactly meeting the threshold) satisfies the verdict and
      // writes exactly one CompletionRecord with the pinned ruleVersion and
      // per-item evidence.
      // -----------------------------------------------------------------
      const session1 = await seedSessionFixture(testDb.prisma, {
        cohortId,
        startsAt: new Date(baseNow.getTime() - 5 * HOUR_MS),
        endsAt: new Date(baseNow.getTime() - 4 * HOUR_MS),
      });
      const session2 = await seedSessionFixture(testDb.prisma, {
        cohortId,
        startsAt: new Date(baseNow.getTime() - 4 * HOUR_MS),
        endsAt: new Date(baseNow.getTime() - 3 * HOUR_MS),
      });
      const session3 = await seedSessionFixture(testDb.prisma, {
        cohortId,
        startsAt: new Date(baseNow.getTime() - 3 * HOUR_MS),
        endsAt: new Date(baseNow.getTime() - 2 * HOUR_MS),
      });
      // A fourth countable session, deliberately left NOT_RECORDED — it
      // still counts in the denominator (only EXCUSED is excluded), which
      // is what keeps 3-of-4 at exactly 75% rather than 100%.
      await seedSessionFixture(testDb.prisma, {
        cohortId,
        startsAt: new Date(baseNow.getTime() - 2 * HOUR_MS),
        endsAt: new Date(baseNow.getTime() - 1 * HOUR_MS),
      });

      await markAttendance({ sessionId: session1.sessionId, enrolmentId, state: "PRESENT" });
      await markAttendance({ sessionId: session2.sessionId, enrolmentId, state: "PRESENT" });
      await markAttendance({ sessionId: session3.sessionId, enrolmentId, state: "PRESENT" });

      const recordsAfterSatisfy = await testDb.prisma.completionRecord.findMany({
        where: { enrolmentId, scope: "COURSE" },
      });
      expect(recordsAfterSatisfy).toHaveLength(1);
      expect(recordsAfterSatisfy[0].ruleVersion).toBe(1);
      expect(recordsAfterSatisfy[0].supersededAt).toBeNull();
      const evidence = recordsAfterSatisfy[0].evidence as { schema: number; items: Array<{ id: string; satisfied: boolean }> };
      expect(evidence.schema).toBe(1);
      expect(evidence.items.find((i) => i.id === "required-lessons")?.satisfied).toBe(true);
      expect(evidence.items.find((i) => i.id === "attendance")?.satisfied).toBe(true);

      // -----------------------------------------------------------------
      // DD-6 — Enrolment.status is still ACTIVE after full completion, read
      // directly from the database row (never inferred from CompletionRecord
      // alone) — completion-service.ts must never write this column.
      // -----------------------------------------------------------------
      const enrolmentAfterSatisfy = await testDb.prisma.enrolment.findUniqueOrThrow({
        where: { id: enrolmentId },
      });
      expect(enrolmentAfterSatisfy.status).toBe("ACTIVE");

      // -----------------------------------------------------------------
      // "Double satisfaction" — re-marking an already-complete lesson
      // re-triggers recalculateCompletion (it runs unconditionally inside
      // markLessonComplete's transaction), and the verdict is still
      // satisfied with a record already open — applyVerdict's idempotent
      // branch must leave exactly one row, never a duplicate.
      // -----------------------------------------------------------------
      await markLessonComplete(learner, { enrolmentId, lessonId: lesson1Id });
      expect(
        await testDb.prisma.completionRecord.count({ where: { enrolmentId, scope: "COURSE" } }),
      ).toBe(1);

      // -----------------------------------------------------------------
      // LRN-07/D-12 — an attendance correction dropping the learner below
      // 75% (2 of 4 = 50%) stamps supersededAt on the open record without
      // deleting it.
      // -----------------------------------------------------------------
      await markAttendance({ sessionId: session3.sessionId, enrolmentId, state: "ABSENT" });

      const recordsAfterSupersede = await testDb.prisma.completionRecord.findMany({
        where: { enrolmentId, scope: "COURSE" },
      });
      expect(recordsAfterSupersede).toHaveLength(1);
      expect(recordsAfterSupersede[0].id).toBe(recordsAfterSatisfy[0].id);
      expect(recordsAfterSupersede[0].supersededAt).not.toBeNull();

      // -----------------------------------------------------------------
      // LRN-07/D-12 — a further correction back above threshold creates a
      // SECOND record while the first stays superseded.
      // -----------------------------------------------------------------
      await markAttendance({ sessionId: session3.sessionId, enrolmentId, state: "PRESENT" });

      const recordsAfterResatisfy = await testDb.prisma.completionRecord.findMany({
        where: { enrolmentId, scope: "COURSE" },
        orderBy: { completedAt: "asc" },
      });
      expect(recordsAfterResatisfy).toHaveLength(2);
      expect(recordsAfterResatisfy[0].id).toBe(recordsAfterSatisfy[0].id);
      expect(recordsAfterResatisfy[0].supersededAt).not.toBeNull();
      expect(recordsAfterResatisfy[1].supersededAt).toBeNull();

      // DD-6, re-confirmed after the supersede/resatisfy cycle — still no
      // Enrolment.status write anywhere in this path.
      const enrolmentAfterCycle = await testDb.prisma.enrolment.findUniqueOrThrow({
        where: { id: enrolmentId },
      });
      expect(enrolmentAfterCycle.status).toBe("ACTIVE");

      // -----------------------------------------------------------------
      // LRN-03 — `getDownloadableResourceForLearner`'s own ownership gate
      // (DD-14/RESEARCH Pitfall 1) is exactly `hasActiveEnrolmentCoveringCourse`
      // — proved directly here (see file header for why the wrapping service
      // export itself is not called). A real READY LessonResource row exists
      // for the enrolled learner's course; the predicate authorizes the
      // enrolled learner and refuses a second, non-enrolled user for the
      // SAME resource id.
      // -----------------------------------------------------------------
      const resourceRow = await testDb.prisma.lessonResource.create({
        data: {
          lessonId: lesson1Id,
          title: "Handout",
          storageKey: "lesson-uploads/journey/opaque",
          filename: "handout.pdf",
          mimeType: "application/pdf",
          sizeBytes: BigInt(2048),
          uploadStatus: "READY",
        },
      });
      expect(resourceRow.uploadStatus).toBe("READY");

      expect(await hasActiveEnrolmentCoveringCourse(userId, courseId)).toBe(true);

      const strangerLearner = await seedLearnerFixture(testDb.prisma);
      expect(await hasActiveEnrolmentCoveringCourse(strangerLearner.userId, courseId)).toBe(false);

      // -----------------------------------------------------------------
      // LRN-06 — a session's meetingUrl is absent from
      // listOwnCohortSessions before its visibility window, and present
      // once the window opens. `attendanceExpected: false` keeps this
      // session out of the LRN-07 attendance calculation above.
      // -----------------------------------------------------------------
      const meetingSession = await seedSessionFixture(testDb.prisma, {
        cohortId,
        startsAt: new Date(baseNow.getTime() + 2 * HOUR_MS),
        endsAt: new Date(baseNow.getTime() + 3 * HOUR_MS),
        meetingUrl: "https://example.test/meeting/journey",
        linkVisibleFromMinutes: 60,
        attendanceExpected: false,
      });

      const findSession = (
        result: NonNullable<Awaited<ReturnType<typeof listOwnCohortSessions>>>,
        sessionId: string,
      ) => [...result.upcoming, ...result.past].find((s) => s.id === sessionId);

      const beforeWindow = await listOwnCohortSessions(learner, enrolmentId, baseNow);
      const beforeView = findSession(beforeWindow!, meetingSession.sessionId);
      expect(beforeView?.meetingUrl).toBeUndefined();
      expect(beforeView?.meetingUrlAvailableFrom).toBeDefined();

      const insideWindow = await listOwnCohortSessions(
        learner,
        enrolmentId,
        new Date(baseNow.getTime() + 90 * 60_000),
      );
      const insideView = findSession(insideWindow!, meetingSession.sessionId);
      expect(insideView?.meetingUrl).toBe("https://example.test/meeting/journey");
    },
    TEST_DB_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // LRN-01 / T-09-01 — the isolated authorization assertion: a second real
  // learner co-enrolled in the SAME cohort never sees the first learner's
  // enrolment through the dashboard aggregate or the ownership lookup.
  // -------------------------------------------------------------------------
  it(
    "loadLearnerDashboard for a second learner contains none of the first learner's enrolments",
    async () => {
      const { courseId, publicationId } = await seedLearnerJourneyCourse(testDb.prisma);
      const { cohortId } = await seedSelfPacedCohort(testDb.prisma, { courseId, publicationId });

      const first = await seedActivatedEnrolment(testDb.prisma, { cohortId });
      const second = await seedActivatedEnrolment(testDb.prisma, { cohortId });

      const secondActor = { userId: second.userId };
      const secondDashboard = await loadLearnerDashboard(secondActor);
      const secondCardEnrolmentIds = secondDashboard.cards.map((c) => c.enrolmentId);

      expect(secondCardEnrolmentIds).not.toContain(first.enrolmentId);
      expect(secondCardEnrolmentIds).toContain(second.enrolmentId);

      // T-09-01 denial parity — a guessed/known enrolment id belonging to
      // another learner resolves identically to "does not exist".
      expect(await getOwnActiveEnrolment(secondActor, first.enrolmentId)).toBeNull();
    },
    TEST_DB_TIMEOUT_MS,
  );
});
