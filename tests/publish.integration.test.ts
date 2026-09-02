/**
 * Task 3 (plan 04-08): the real-Postgres proof.
 *
 * The unit test (`tests/publish-service.test.ts`) drives the publish
 * operation with an in-memory fake. That fake cannot raise
 * `duplicate key value violates unique constraint`, cannot prove a JSON
 * payload is byte-identical across a later write, and cannot prove a foreign
 * key pin survives. This file starts a throwaway `postgres:16-alpine`
 * container (see `tests/support/pg.ts`), deploys the checked-in migrations,
 * and exercises `CoursePublication_courseId_version_key`, the immutability of
 * a stored payload, and the cohort pin — against the real schema.
 *
 * PREREQUISITE: Docker. This is a pre-flight condition, not a runtime
 * fallback (plan 04-05 Task 3, same rule). If Docker is unavailable
 * `beforeAll` fails with a container-start error and every case reports
 * BLOCKED — never silently passed, never weakened to a mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";
import {
  createPrismaBackedPublishService,
  ListingNotReadyError,
} from "@/server/services/publish-service";
import {
  assertSlugMutable,
  SlugFrozenError,
} from "@/server/services/catalogue-guards";
import { StaleOrderError } from "@/server/services/reorder-service";
import { AuthorizationError } from "@/server/permissions/with-permission";

let testDb: TestDatabase;
let publisherId: string;

type Svc = ReturnType<typeof createPrismaBackedPublishService>;

let seedCounter = 0;
const uid = (prefix: string) => `${prefix}-${(seedCounter += 1)}`;

type PrismaLike = TestDatabase["prisma"];

function serviceWithGrants(grants: Parameters<typeof createTestWithPermission>[0]): Svc {
  const { withPermission } = createTestWithPermission(grants, { userId: publisherId });
  return createPrismaBackedPublishService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    testDb.prisma as any,
    withPermission,
    async (entry) => {
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
    },
  );
}

const globalService = () =>
  serviceWithGrants([
    grant("courses.publish"),
    grant("programmes.publish"),
    grant("courses.edit"),
    grant("programmes.manage"),
    grant("courses.view"),
    grant("programmes.view"),
  ]);

/** A ready-to-publish Course: title, summary, one module, one live lesson. */
async function seedCourse(prisma: PrismaLike, overrides: Record<string, unknown> = {}) {
  const courseId = uid("course");
  await prisma.course.create({
    data: {
      id: courseId,
      slug: uid("course-slug"),
      title: "Immutability Fixture",
      summary: "Proves a published version never changes.",
      completionRule: { kind: "ALL_REQUIRED" },
      completionRuleVersion: 1,
      ...overrides,
    },
  });
  const moduleId = uid("mod");
  await prisma.module.create({ data: { id: moduleId, courseId, title: "Module A", position: 0 } });
  const lessonId = uid("les");
  await prisma.lesson.create({
    data: { id: lessonId, moduleId, title: "Lesson 1", type: "TEXT", position: 0, required: true },
  });
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  return { courseId, moduleId, lessonId, updatedAt: course.updatedAt };
}

async function seedRunningCohortForCourse(prisma: PrismaLike, courseId: string) {
  const cohortId = uid("cohort");
  const now = Date.now();
  await prisma.cohort.create({
    data: {
      id: cohortId,
      code: uid("COH"),
      title: "Running Cohort",
      courseId,
      deliveryMode: "SELF_PACED",
      startsAt: new Date(now - 5 * 86_400_000),
      endsAt: new Date(now + 30 * 86_400_000),
      enrolmentOpensAt: new Date(now - 20 * 86_400_000),
      enrolmentClosesAt: new Date(now - 1 * 86_400_000),
      capacity: 20,
      priceMinor: 100_000,
      status: "IN_PROGRESS",
    },
  });
  return cohortId;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  const publisher = await testDb.prisma.user.create({
    data: { email: uid("publisher") + "@example.test", name: "Pat Publisher", isStaff: true },
  });
  publisherId = publisher.id;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("publish-service — real Postgres (D-32)", () => {
  it("two successive publishes produce versions 1 and 2, and version 1's payload + publishedAt are byte-identical afterwards", async () => {
    const { courseId, updatedAt } = await seedCourse(testDb.prisma);
    const svc = globalService();

    const v1 = await svc.publishCourse({ courseId, expectedUpdatedAt: updatedAt });
    expect(v1.version).toBe(1);

    const v1RowBefore = await testDb.prisma.coursePublication.findFirstOrThrow({
      where: { courseId, version: 1 },
    });

    const token2 = (await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } }))
      .updatedAt;
    const v2 = await svc.publishCourse({ courseId, expectedUpdatedAt: token2 });
    expect(v2.version).toBe(2);

    const v1RowAfter = await testDb.prisma.coursePublication.findFirstOrThrow({
      where: { courseId, version: 1 },
    });
    expect(JSON.stringify(v1RowAfter.payload)).toBe(JSON.stringify(v1RowBefore.payload));
    expect(v1RowAfter.publishedAt.getTime()).toBe(v1RowBefore.publishedAt.getTime());
  });

  it("an unticked cohort pinned to version 1 still points at version 1 after a version-2 publish (D-06)", async () => {
    const { courseId, updatedAt } = await seedCourse(testDb.prisma);
    const cohortId = await seedRunningCohortForCourse(testDb.prisma, courseId);
    const svc = globalService();

    const v1 = await svc.publishCourse({ courseId, expectedUpdatedAt: updatedAt });
    await testDb.prisma.cohort.update({
      where: { id: cohortId },
      data: { coursePublicationId: v1.publicationId },
    });

    const token2 = (await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } }))
      .updatedAt;
    await svc.publishCourse({ courseId, expectedUpdatedAt: token2, migrateCohortIds: [] });

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    expect(cohort.coursePublicationId).toBe(v1.publicationId);
  });

  it("a ticked cohort points at version 2 and an audit row names the reason (D-06)", async () => {
    const { courseId, updatedAt } = await seedCourse(testDb.prisma);
    const cohortId = await seedRunningCohortForCourse(testDb.prisma, courseId);
    const svc = globalService();

    const v1 = await svc.publishCourse({ courseId, expectedUpdatedAt: updatedAt });
    await testDb.prisma.cohort.update({
      where: { id: cohortId },
      data: { coursePublicationId: v1.publicationId },
    });

    const token2 = (await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } }))
      .updatedAt;
    const v2 = await svc.publishCourse({
      courseId,
      expectedUpdatedAt: token2,
      migrateCohortIds: [cohortId],
      reason: "Fixed a wrongly-optional required lesson",
    });

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    expect(cohort.coursePublicationId).toBe(v2.publicationId);

    const migrationAudit = await testDb.prisma.auditEvent.findFirst({
      where: { action: "course.cohorts_migrated", targetId: courseId },
    });
    expect(migrationAudit?.reason).toBe("Fixed a wrongly-optional required lesson");
  });

  it("a lesson withdrawn after version 1 still appears in version 1's stored payload and still resolves to a live Lesson row (D-03)", async () => {
    const { courseId, lessonId, updatedAt } = await seedCourse(testDb.prisma);
    const svc = globalService();

    const v1 = await svc.publishCourse({ courseId, expectedUpdatedAt: updatedAt });

    await testDb.prisma.lesson.update({
      where: { id: lessonId },
      data: { withdrawnAt: new Date(), position: -1_000_001 },
    });

    const v1Row = await testDb.prisma.coursePublication.findUniqueOrThrow({ where: { id: v1.publicationId } });
    const payload = v1Row.payload as { modules: Array<{ lessons: Array<{ id: string }> }> };
    const lessonIds = payload.modules.flatMap((m) => m.lessons.map((l) => l.id));
    expect(lessonIds).toContain(lessonId);

    const stillThere = await testDb.prisma.lesson.findUnique({ where: { id: lessonId } });
    expect(stillThere).not.toBeNull();
  });

  it("the @@unique([courseId, version]) index rejects a duplicate version insert", async () => {
    const { courseId, updatedAt } = await seedCourse(testDb.prisma);
    const svc = globalService();
    await svc.publishCourse({ courseId, expectedUpdatedAt: updatedAt });

    await expect(
      testDb.prisma.coursePublication.create({
        data: {
          courseId,
          version: 1,
          payload: { schema: 1, modules: [] },
          payloadSchema: 1,
          publishedById: publisherId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("archiving a Course that belongs to a published Programme leaves that ProgrammePublication.payload byte-identical (D-14)", async () => {
    const { courseId } = await seedCourse(testDb.prisma);
    const programmeId = uid("programme");
    await testDb.prisma.programme.create({
      data: {
        id: programmeId,
        slug: uid("programme-slug"),
        title: "Holding Programme",
        summary: "Contains the course under test.",
        sequential: true,
        completionRule: { kind: "ALL_COURSES" },
        completionRuleVersion: 1,
      },
    });
    await testDb.prisma.programmeCourse.create({
      data: { id: uid("pc"), programmeId, courseId, position: 0 },
    });

    const programme = await testDb.prisma.programme.findUniqueOrThrow({ where: { id: programmeId } });
    const svc = globalService();
    const pubResult = await svc.publishProgramme({
      programmeId,
      expectedUpdatedAt: programme.updatedAt,
    });

    const pubBefore = await testDb.prisma.programmePublication.findUniqueOrThrow({
      where: { id: pubResult.publicationId },
    });

    await svc.archiveCatalogueRecord({ kind: "Course", id: courseId, reason: "Retired this course" });

    const pubAfter = await testDb.prisma.programmePublication.findUniqueOrThrow({
      where: { id: pubResult.publicationId },
    });
    expect(JSON.stringify(pubAfter.payload)).toBe(JSON.stringify(pubBefore.payload));

    const archivedCourse = await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(archivedCourse.status).toBe("ARCHIVED");
    expect(archivedCourse.publiclyListed).toBe(false);
    // Draft ordering: the membership row is gone.
    const remaining = await testDb.prisma.programmeCourse.count({ where: { courseId } });
    expect(remaining).toBe(0);
  });

  it("setPublicListing(true) then a slug change attempt raises SlugFrozenError (D-11)", async () => {
    const { courseId } = await seedCourse(testDb.prisma);
    const svc = globalService();

    await svc.setPublicListing({ kind: "Course", id: courseId, listed: true });

    const listed = await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(listed.publiclyListed).toBe(true);
    expect(listed.slugLockedAt).not.toBeNull();

    expect(() => assertSlugMutable({ slugLockedAt: listed.slugLockedAt })).toThrow(SlugFrozenError);
  });

  it("unarchiveCatalogueRecord yields status = DRAFT and publiclyListed = false (D-16)", async () => {
    const { courseId } = await seedCourse(testDb.prisma, {
      status: "ARCHIVED",
      publiclyListed: false,
    });
    const svc = globalService();

    await svc.unarchiveCatalogueRecord({ kind: "Course", id: courseId, reason: "Bringing it back" });

    const row = await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(row.status).toBe("DRAFT");
    expect(row.publiclyListed).toBe(false);
  });

  it("a publish with a stale expectedUpdatedAt writes no publication row at all (D-22 server-side)", async () => {
    const { courseId } = await seedCourse(testDb.prisma);
    const svc = globalService();

    await expect(
      svc.publishCourse({ courseId, expectedUpdatedAt: new Date("2000-01-01T00:00:00Z") }),
    ).rejects.toBeInstanceOf(StaleOrderError);

    const count = await testDb.prisma.coursePublication.count({ where: { courseId } });
    expect(count).toBe(0);
  });

  it("setPublicListing(true) succeeds against a DRAFT course with a title, summary, one module and one lesson — the D-08 early-bookings case", async () => {
    const { courseId } = await seedCourse(testDb.prisma);
    const svc = globalService();

    await svc.setPublicListing({ kind: "Course", id: courseId, listed: true });

    const row = await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(row.status).toBe("DRAFT");
    expect(row.publiclyListed).toBe(true);
    expect(row.publiclyListedAt).not.toBeNull();
  });

  it("setPublicListing(true) is refused when a blocking readiness item is FAIL, and names it", async () => {
    const courseId = uid("course");
    await testDb.prisma.course.create({
      data: { id: courseId, slug: uid("slug"), title: "No Modules Here", summary: "x" },
    });
    const svc = globalService();

    await expect(
      svc.setPublicListing({ kind: "Course", id: courseId, listed: true }),
    ).rejects.toBeInstanceOf(ListingNotReadyError);

    const row = await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(row.publiclyListed).toBe(false);
  });

  it("publishProgramme writes Programme.contentVersion and Programme.publishedById, proving plan 04-02's columns exist and the commit is shared", async () => {
    const programmeId = uid("programme");
    const courseId = (await seedCourse(testDb.prisma)).courseId;
    await testDb.prisma.programme.create({
      data: {
        id: programmeId,
        slug: uid("programme-slug"),
        title: "Shared Commit Programme",
        summary: "Has one member course.",
        sequential: false,
        completionRule: { kind: "ALL_COURSES" },
        completionRuleVersion: 1,
      },
    });
    await testDb.prisma.programmeCourse.create({
      data: { id: uid("pc"), programmeId, courseId, position: 0 },
    });
    const programme = await testDb.prisma.programme.findUniqueOrThrow({ where: { id: programmeId } });
    const svc = globalService();

    await svc.publishProgramme({ programmeId, expectedUpdatedAt: programme.updatedAt });

    const after = await testDb.prisma.programme.findUniqueOrThrow({ where: { id: programmeId } });
    expect(after.status).toBe("PUBLISHED");
    expect(after.contentVersion).toBe(1);
    expect(after.publishedById).toBe(publisherId);
  });

  it("switching listing OFF always succeeds, even while a cohort is running (D-12)", async () => {
    const { courseId } = await seedCourse(testDb.prisma);
    const svc = globalService();
    await svc.setPublicListing({ kind: "Course", id: courseId, listed: true });
    await seedRunningCohortForCourse(testDb.prisma, courseId);

    await svc.setPublicListing({ kind: "Course", id: courseId, listed: false });

    const row = await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(row.publiclyListed).toBe(false);
    // slug stays frozen — listing-off never thaws it.
    expect(row.slugLockedAt).not.toBeNull();
  });
});

describe("publish-service — authorization boundaries (real Postgres)", () => {
  it("a courses.publish-only caller cannot list a course publicly — listing is programmes.publish (D-09)", async () => {
    const { courseId } = await seedCourse(testDb.prisma);
    const scoped = serviceWithGrants([grant("courses.publish", "COURSE", courseId)]);

    await expect(
      scoped.setPublicListing({ kind: "Course", id: courseId, listed: true }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const row = await testDb.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(row.publiclyListed).toBe(false);
  });

  it("a courses.edit-only caller cannot publish course content — publish is courses.publish", async () => {
    const { courseId, updatedAt } = await seedCourse(testDb.prisma);
    const scoped = serviceWithGrants([grant("courses.edit", "COURSE", courseId)]);

    await expect(
      scoped.publishCourse({ courseId, expectedUpdatedAt: updatedAt }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const count = await testDb.prisma.coursePublication.count({ where: { courseId } });
    expect(count).toBe(0);
  });
});
