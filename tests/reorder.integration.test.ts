/**
 * Integration proof for the two-pass reorder against a REAL Postgres
 * (D-32) — the mock in `tests/reorder.test.ts` cannot raise
 * `duplicate key value violates unique constraint`, and a naive
 * single-statement renumbering does exactly that. This file starts a
 * throwaway `postgres:16-alpine` container (see `tests/support/pg.ts`),
 * deploys the checked-in migrations, and exercises the real unique indexes:
 * `Module_courseId_position_key`, `Lesson_moduleId_position_key`,
 * `ProgrammeCourse_programmeId_position_key`.
 *
 * PREREQUISITE: Docker must be running. This is a pre-flight condition for
 * this file, not a runtime fallback — if Docker is unavailable, `beforeAll`
 * fails with a container-start error and every case below reports BLOCKED,
 * never silently passed or weakened to a mock.
 *
 * Deviation from the plan text: Task 3's action described withdrawing and
 * restoring a lesson through `lessonService.archive`/`.restore`. Those
 * methods belong to `src/server/services/lesson-service.ts`, which is
 * plan 04-04's output — a sibling plan running in a separate, isolated
 * worktree in the same wave, not a declared dependency of this plan
 * (`depends_on: ["04-01","04-02","04-03"]`) and explicitly off-limits for
 * this worktree to create or edit. `withdrawLesson`/`restoreLesson` below
 * replicate the exact same band-contract computation those methods will
 * perform — `parkedWithdrawnPosition`/`nextAppendPosition` from
 * `src/lib/positions.ts`, the same pure functions `resource-service.ts`'s
 * `archiveData`/`restoreData` hooks are built on — so the cases below still
 * prove the real thing: that a withdrawal parked by the real band contract
 * survives a live reorder untouched, and that a restore lands cleanly at
 * the end of the live band. Nothing here writes `withdrawnAt` directly.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";
import {
  ArrangementMismatchError,
  createReorderService,
  parseOrderToken,
  serialiseOrderToken,
  StaleOrderError,
  type ReorderDb,
  type ReorderTx,
} from "@/server/services/reorder-service";
import { nextAppendPosition, parkedWithdrawnPosition } from "@/lib/positions";

let testDb: TestDatabase;
let service: ReturnType<typeof createReorderService>;

let seedCounter = 0;
function uid(prefix: string): string {
  seedCounter += 1;
  return `${prefix}-${seedCounter}`;
}

type PrismaLike = TestDatabase["prisma"];

/** Creates a Course with `moduleCount` Modules, each with 3 live Lessons at
 * contiguous positions 0,1,2. Returns the ids needed to build arrangements. */
async function seedCourse(prisma: PrismaLike, moduleCount = 3) {
  const courseId = uid("course");
  await prisma.course.create({
    data: { id: courseId, slug: uid("course-slug"), title: "Reorder Fixture Course" },
  });

  const moduleIds: string[] = [];
  const lessonIdsByModule: Record<string, string[]> = {};
  for (let m = 0; m < moduleCount; m++) {
    const moduleId = uid("m");
    moduleIds.push(moduleId);
    await prisma.module.create({
      data: { id: moduleId, courseId, title: `Module ${m}`, position: m },
    });
    const lessonIds: string[] = [];
    for (let l = 0; l < 3; l++) {
      const lessonId = uid("l");
      lessonIds.push(lessonId);
      await prisma.lesson.create({
        data: { id: lessonId, moduleId, title: `Lesson ${l}`, type: "TEXT", position: l },
      });
    }
    lessonIdsByModule[moduleId] = lessonIds;
  }

  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  return { courseId, moduleIds, lessonIdsByModule, updatedAt: course.updatedAt };
}

async function seedProgrammeWithCourses(prisma: PrismaLike, courseCount = 3) {
  const programmeId = uid("programme");
  await prisma.programme.create({
    data: { id: programmeId, slug: uid("programme-slug"), title: "Reorder Fixture Programme" },
  });

  const programmeCourseIds: string[] = [];
  for (let i = 0; i < courseCount; i++) {
    const courseId = uid("pc-course");
    await prisma.course.create({
      data: { id: courseId, slug: uid("pc-course-slug"), title: `Programme Course ${i}` },
    });
    const programmeCourseId = uid("pc");
    await prisma.programmeCourse.create({
      data: { id: programmeCourseId, programmeId, courseId, position: i },
    });
    programmeCourseIds.push(programmeCourseId);
  }

  const programme = await prisma.programme.findUniqueOrThrow({ where: { id: programmeId } });
  return { programmeId, programmeCourseIds, updatedAt: programme.updatedAt };
}

/** Withdraws a Lesson using the real band contract (src/lib/positions.ts) —
 * see the file-header deviation note: lesson-service.ts (plan 04-04) is not
 * available in this worktree, so this reproduces its archiveData
 * computation directly rather than writing withdrawnAt by hand. */
async function withdrawLesson(prisma: PrismaLike, lessonId: string): Promise<void> {
  const lesson = await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } });
  const minSibling = await prisma.lesson.aggregate({
    where: { moduleId: lesson.moduleId },
    _min: { position: true },
  });
  const parked = parkedWithdrawnPosition(minSibling._min.position ?? null);
  await prisma.lesson.update({
    where: { id: lessonId },
    data: { withdrawnAt: new Date(), position: parked },
  });
}

/** Restores a Lesson using the real band contract — see withdrawLesson. */
async function restoreLesson(prisma: PrismaLike, lessonId: string): Promise<void> {
  const lesson = await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } });
  const maxLive = await prisma.lesson.aggregate({
    where: { moduleId: lesson.moduleId, withdrawnAt: null },
    _max: { position: true },
  });
  const appended = nextAppendPosition(maxLive._max.position ?? null);
  await prisma.lesson.update({
    where: { id: lessonId },
    data: { withdrawnAt: null, position: appended },
  });
}

function buildDb(prisma: PrismaLike): ReorderDb {
  return {
    $transaction: (fn) => prisma.$transaction((tx) => fn(tx as unknown as ReorderTx)),
  };
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  const { withPermission } = createTestWithPermission([
    grant("courses.edit"),
    grant("programmes.manage"),
  ]);
  service = createReorderService({
    db: buildDb(testDb.prisma),
    withPermission,
    audit: async () => {},
  });
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("reorder-service — real Postgres (D-32)", () => {
  it("full reversal of a lesson list within one module succeeds against the real unique index", async () => {
    const { courseId, moduleIds, lessonIdsByModule, updatedAt } = await seedCourse(testDb.prisma);
    const moduleId = moduleIds[0];
    const [a, b, c] = lessonIdsByModule[moduleId];

    await service.commitLessonOrder({
      courseId,
      expectedUpdatedAt: updatedAt,
      arrangement: [{ moduleId, lessonIds: [c, b, a] }],
    });

    const rows = await testDb.prisma.lesson.findMany({
      where: { moduleId },
      orderBy: { position: "asc" },
    });
    expect(rows.map((r) => r.id)).toEqual([c, b, a]);
  });

  it("rotation by one is a guaranteed collision under a naive per-row update and succeeds here", async () => {
    const { courseId, moduleIds, lessonIdsByModule, updatedAt } = await seedCourse(testDb.prisma);
    const moduleId = moduleIds[1];
    const [a, b, c] = lessonIdsByModule[moduleId];

    await service.commitLessonOrder({
      courseId,
      expectedUpdatedAt: updatedAt,
      arrangement: [{ moduleId, lessonIds: [c, a, b] }],
    });

    const rows = await testDb.prisma.lesson.findMany({
      where: { moduleId },
      orderBy: { position: "asc" },
    });
    expect(rows.map((r) => r.id)).toEqual([c, a, b]);
  });

  it("moves the middle lesson of one module to the front of another module in one transaction (D-21)", async () => {
    const { courseId, moduleIds, lessonIdsByModule, updatedAt } = await seedCourse(testDb.prisma, 2);
    const [module0, module1] = moduleIds;
    const [a, b, c] = lessonIdsByModule[module0];
    const [d, e, f] = lessonIdsByModule[module1];

    await service.commitLessonOrder({
      courseId,
      expectedUpdatedAt: updatedAt,
      arrangement: [
        { moduleId: module0, lessonIds: [a, c] },
        { moduleId: module1, lessonIds: [b, d, e, f] },
      ],
    });

    const module0Rows = await testDb.prisma.lesson.findMany({
      where: { moduleId: module0 },
      orderBy: { position: "asc" },
    });
    const module1Rows = await testDb.prisma.lesson.findMany({
      where: { moduleId: module1 },
      orderBy: { position: "asc" },
    });

    expect(module0Rows.map((r) => r.id)).toEqual([a, c]);
    expect(module0Rows.map((r) => r.position)).toEqual([0, 1]);
    expect(module1Rows.map((r) => r.id)).toEqual([b, d, e, f]);
    expect(module1Rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);

    const moved = await testDb.prisma.lesson.findUniqueOrThrow({ where: { id: b } });
    expect(moved.moduleId).toBe(module1);

    const totalLessons = await testDb.prisma.lesson.count({
      where: { moduleId: { in: [module0, module1] } },
    });
    expect(totalLessons).toBe(6);
  });

  it("reverses a Course's Modules against Module_courseId_position_key", async () => {
    const { courseId, moduleIds, updatedAt } = await seedCourse(testDb.prisma);
    const reversed = [...moduleIds].reverse();

    await service.commitModuleOrder({
      courseId,
      expectedUpdatedAt: updatedAt,
      moduleIds: reversed,
    });

    const rows = await testDb.prisma.module.findMany({
      where: { courseId },
      orderBy: { position: "asc" },
    });
    expect(rows.map((r) => r.id)).toEqual(reversed);
  });

  it("reverses a Programme's Courses against ProgrammeCourse_programmeId_position_key", async () => {
    const { programmeId, programmeCourseIds, updatedAt } = await seedProgrammeWithCourses(
      testDb.prisma,
    );
    const reversed = [...programmeCourseIds].reverse();

    await service.commitProgrammeCourseOrder({
      programmeId,
      expectedUpdatedAt: updatedAt,
      programmeCourseIds: reversed,
    });

    const rows = await testDb.prisma.programmeCourse.findMany({
      where: { programmeId },
      orderBy: { position: "asc" },
    });
    expect(rows.map((r) => r.id)).toEqual(reversed);
  });

  it("refuses a stale token and leaves the stored order exactly as the winning commit wrote it", async () => {
    const { courseId, moduleIds, updatedAt: staleToken } = await seedCourse(testDb.prisma);
    const winningOrder = [...moduleIds].reverse();

    await service.commitModuleOrder({
      courseId,
      expectedUpdatedAt: staleToken,
      moduleIds: winningOrder,
    });

    await expect(
      service.commitModuleOrder({
        courseId,
        expectedUpdatedAt: staleToken, // the original, now-stale token
        moduleIds, // the loser's (original) order
      }),
    ).rejects.toBeInstanceOf(StaleOrderError);

    const rows = await testDb.prisma.module.findMany({
      where: { courseId },
      orderBy: { position: "asc" },
    });
    expect(rows.map((r) => r.id)).toEqual(winningOrder);
  });

  it("round-trips the updatedAt order token without precision loss (RESEARCH A8)", async () => {
    const { courseId, moduleIds } = await seedCourse(testDb.prisma);
    const course = await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } });

    const token = serialiseOrderToken(course.updatedAt);
    const roundTripped = parseOrderToken(token);

    await expect(
      service.commitModuleOrder({
        courseId,
        expectedUpdatedAt: roundTripped,
        moduleIds: [...moduleIds].reverse(),
      }),
    ).resolves.toMatchObject({ moved: moduleIds.length });
  });

  it("refuses an arrangement naming a lesson id from another Course, and moves nothing in either Course", async () => {
    const courseA = await seedCourse(testDb.prisma, 1);
    const courseB = await seedCourse(testDb.prisma, 1);
    const moduleA = courseA.moduleIds[0];
    const [a1, a2, a3] = courseA.lessonIdsByModule[moduleA];
    const foreignLessonId = courseB.lessonIdsByModule[courseB.moduleIds[0]][0];

    await expect(
      service.commitLessonOrder({
        courseId: courseA.courseId,
        expectedUpdatedAt: courseA.updatedAt,
        arrangement: [{ moduleId: moduleA, lessonIds: [a1, a2, foreignLessonId] }],
      }),
    ).rejects.toBeInstanceOf(ArrangementMismatchError);

    const rowsA = await testDb.prisma.lesson.findMany({
      where: { moduleId: moduleA },
      orderBy: { position: "asc" },
    });
    expect(rowsA.map((r) => r.id)).toEqual([a1, a2, a3]);

    const foreignRow = await testDb.prisma.lesson.findUniqueOrThrow({
      where: { id: foreignLessonId },
    });
    expect(foreignRow.moduleId).toBe(courseB.moduleIds[0]);
  });

  it("refuses an arrangement that omits a live lesson", async () => {
    const { courseId, moduleIds, lessonIdsByModule, updatedAt } = await seedCourse(testDb.prisma, 1);
    const moduleId = moduleIds[0];
    const [a] = lessonIdsByModule[moduleId];

    await expect(
      service.commitLessonOrder({
        courseId,
        expectedUpdatedAt: updatedAt,
        arrangement: [{ moduleId, lessonIds: [a] }], // omits the other two
      }),
    ).rejects.toBeInstanceOf(ArrangementMismatchError);
  });

  it("a live reorder never touches, moves, or collides with a withdrawn lesson", async () => {
    const { moduleIds, lessonIdsByModule } = await seedCourse(testDb.prisma, 1);
    const moduleId = moduleIds[0];
    const [live1, live2, toWithdraw] = lessonIdsByModule[moduleId];

    await withdrawLesson(testDb.prisma, toWithdraw);
    const withdrawnBefore = await testDb.prisma.lesson.findUniqueOrThrow({
      where: { id: toWithdraw },
    });
    expect(withdrawnBefore.withdrawnAt).not.toBeNull();
    expect(withdrawnBefore.position).toBeLessThanOrEqual(-1_000_001);

    // Re-read the Course's live updatedAt token — withdrawLesson does not
    // touch Course.updatedAt, so the token from seedCourse is still valid.
    const moduleRow = await testDb.prisma.module.findUniqueOrThrow({ where: { id: moduleId } });
    const course = await testDb.prisma.course.findUniqueOrThrow({
      where: { id: moduleRow.courseId },
    });

    await expect(
      service.commitLessonOrder({
        courseId: moduleRow.courseId,
        expectedUpdatedAt: course.updatedAt,
        arrangement: [{ moduleId, lessonIds: [live2, live1] }],
      }),
    ).resolves.toBeTruthy();

    const withdrawnAfter = await testDb.prisma.lesson.findUniqueOrThrow({
      where: { id: toWithdraw },
    });
    expect(withdrawnAfter.position).toBe(withdrawnBefore.position);
    expect(withdrawnAfter.moduleId).toBe(withdrawnBefore.moduleId);
    expect(withdrawnAfter.withdrawnAt?.getTime()).toBe(withdrawnBefore.withdrawnAt?.getTime());

    const liveRows = await testDb.prisma.lesson.findMany({
      where: { moduleId, withdrawnAt: null },
      orderBy: { position: "asc" },
    });
    expect(liveRows.map((r) => r.id)).toEqual([live2, live1]);
    expect(liveRows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("refuses an arrangement that includes a withdrawn lesson id", async () => {
    const { moduleIds, lessonIdsByModule } = await seedCourse(testDb.prisma, 1);
    const moduleId = moduleIds[0];
    const [live1, live2, toWithdraw] = lessonIdsByModule[moduleId];

    await withdrawLesson(testDb.prisma, toWithdraw);
    const withdrawnBefore = await testDb.prisma.lesson.findUniqueOrThrow({
      where: { id: toWithdraw },
    });
    const moduleRow = await testDb.prisma.module.findUniqueOrThrow({ where: { id: moduleId } });
    const course = await testDb.prisma.course.findUniqueOrThrow({
      where: { id: moduleRow.courseId },
    });

    await expect(
      service.commitLessonOrder({
        courseId: moduleRow.courseId,
        expectedUpdatedAt: course.updatedAt,
        arrangement: [{ moduleId, lessonIds: [live1, live2, toWithdraw] }],
      }),
    ).rejects.toBeInstanceOf(ArrangementMismatchError);

    // Nothing moved: the two live rows kept their original positions, and
    // the withdrawn row kept its parked position untouched.
    const live1Row = await testDb.prisma.lesson.findUniqueOrThrow({ where: { id: live1 } });
    const live2Row = await testDb.prisma.lesson.findUniqueOrThrow({ where: { id: live2 } });
    const withdrawnAfter = await testDb.prisma.lesson.findUniqueOrThrow({
      where: { id: toWithdraw },
    });
    expect(live1Row.position).toBe(0);
    expect(live2Row.position).toBe(1);
    expect(withdrawnAfter.position).toBe(withdrawnBefore.position);
  });

  it("restore appends to the end of the live band with no unique violation (D-34)", async () => {
    const { moduleIds, lessonIdsByModule } = await seedCourse(testDb.prisma, 1);
    const moduleId = moduleIds[0];
    const [live1, live2, toWithdraw] = lessonIdsByModule[moduleId];

    await withdrawLesson(testDb.prisma, toWithdraw);
    await restoreLesson(testDb.prisma, toWithdraw);

    const restored = await testDb.prisma.lesson.findUniqueOrThrow({ where: { id: toWithdraw } });
    expect(restored.withdrawnAt).toBeNull();
    expect(restored.position).toBe(2);

    const others = await testDb.prisma.lesson.findMany({
      where: { id: { in: [live1, live2] } },
      orderBy: { position: "asc" },
    });
    expect(others.map((r) => r.position)).toEqual([0, 1]);
  });

  it("reorders all three live lessons into reverse order immediately after a restore", async () => {
    const { moduleIds, lessonIdsByModule } = await seedCourse(testDb.prisma, 1);
    const moduleId = moduleIds[0];
    const [live1, live2, toWithdraw] = lessonIdsByModule[moduleId];

    await withdrawLesson(testDb.prisma, toWithdraw);
    await restoreLesson(testDb.prisma, toWithdraw);

    const moduleRow = await testDb.prisma.module.findUniqueOrThrow({ where: { id: moduleId } });
    const course = await testDb.prisma.course.findUniqueOrThrow({
      where: { id: moduleRow.courseId },
    });

    await expect(
      service.commitLessonOrder({
        courseId: moduleRow.courseId,
        expectedUpdatedAt: course.updatedAt,
        arrangement: [{ moduleId, lessonIds: [toWithdraw, live2, live1] }],
      }),
    ).resolves.toBeTruthy();

    const rows = await testDb.prisma.lesson.findMany({
      where: { moduleId },
      orderBy: { position: "asc" },
    });
    expect(rows.map((r) => r.id)).toEqual([toWithdraw, live2, live1]);
  });
});
