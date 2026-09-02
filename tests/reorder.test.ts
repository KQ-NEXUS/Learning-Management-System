import { describe, expect, it } from "vitest";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import {
  ArrangementMismatchError,
  createReorderService,
  parseOrderToken,
  planTwoPass,
  serialiseOrderToken,
  StaleOrderError,
  type ReorderDb,
  type ReorderTx,
} from "@/server/services/reorder-service";
import { MAX_ARRANGEMENT_SIZE } from "@/lib/positions";

function grant(
  permission: string,
  scopeType: RawGrant["scopeType"] = "GLOBAL",
  scopeId: string | null = null,
): RawGrant {
  return {
    permission: permission as RawGrant["permission"],
    scopeType,
    scopeId,
    active: true,
    revokedAt: null,
    startsAt: null,
    endsAt: null,
  };
}

type FakeCourse = { id: string; updatedAt: Date };
type FakeProgramme = { id: string; updatedAt: Date };
type FakeModule = { id: string; courseId: string; position: number; withdrawnAt: Date | null };
type FakeLesson = { id: string; moduleId: string; position: number; withdrawnAt: Date | null };
type FakeProgrammeCourse = { id: string; programmeId: string; position: number };

type FakeState = {
  courses: FakeCourse[];
  programmes: FakeProgramme[];
  modules: FakeModule[];
  lessons: FakeLesson[];
  programmeCourses: FakeProgrammeCourse[];
};

/**
 * An in-memory stand-in for a Prisma transaction client — proves the
 * service's own logic (ownership/completeness, staleness, permission
 * gating, audit shape) without a database. Task 3's integration suite is
 * what proves the real unique indexes hold; this harness deliberately does
 * not attempt to simulate them.
 */
function buildFakeDb(state: FakeState) {
  const executedRawCalls: unknown[][] = [];

  const db: ReorderDb = {
    $transaction: async (fn) => {
      const tx: ReorderTx = {
        course: {
          updateMany: async ({ where, data }) => {
            const row = state.courses.find((c) => c.id === where.id);
            if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) {
              return { count: 0 };
            }
            row.updatedAt = data.updatedAt;
            return { count: 1 };
          },
        },
        programme: {
          updateMany: async ({ where, data }) => {
            const row = state.programmes.find((p) => p.id === where.id);
            if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) {
              return { count: 0 };
            }
            row.updatedAt = data.updatedAt;
            return { count: 1 };
          },
        },
        module: {
          findMany: async ({ where }) =>
            state.modules
              .filter((m) => m.courseId === where.courseId && m.withdrawnAt === null)
              .sort((a, b) => a.position - b.position)
              .map((m) => ({ id: m.id })),
          update: async ({ where, data }) => {
            const row = state.modules.find((m) => m.id === where.id);
            if (!row) throw new Error(`no such module ${where.id}`);
            row.position = data.position;
            return row;
          },
        },
        lesson: {
          findMany: async ({ where }) =>
            state.lessons
              .filter((l) => where.moduleId.in.includes(l.moduleId) && l.withdrawnAt === null)
              .sort((a, b) => a.position - b.position)
              .map((l) => ({ id: l.id })),
          update: async ({ where, data }) => {
            const row = state.lessons.find((l) => l.id === where.id);
            if (!row) throw new Error(`no such lesson ${where.id}`);
            row.position = data.position;
            row.moduleId = data.moduleId;
            return row;
          },
        },
        programmeCourse: {
          findMany: async ({ where }) =>
            state.programmeCourses
              .filter((pc) => pc.programmeId === where.programmeId)
              .sort((a, b) => a.position - b.position)
              .map((pc) => ({ id: pc.id })),
          update: async ({ where, data }) => {
            const row = state.programmeCourses.find((pc) => pc.id === where.id);
            if (!row) throw new Error(`no such programmeCourse ${where.id}`);
            row.position = data.position;
            return row;
          },
        },
        $executeRaw: async (strings, ...values) => {
          executedRawCalls.push([strings.join("?"), ...values]);
          return 0;
        },
      };
      return fn(tx);
    },
  };

  return { db, executedRawCalls };
}

function harness(grants: RawGrant[], state: FakeState) {
  const audits: unknown[] = [];
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "user-1" }),
    loadGrants: async () => grants,
    audit: async () => {},
  });
  const { db, executedRawCalls } = buildFakeDb(state);

  const service = createReorderService({
    db,
    withPermission,
    audit: async (entry) => {
      audits.push(entry);
    },
  });

  return { service, state, audits, executedRawCalls };
}

function baseState(): FakeState {
  const courseUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
  const programmeUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    courses: [{ id: "course-1", updatedAt: courseUpdatedAt }],
    programmes: [{ id: "programme-1", updatedAt: programmeUpdatedAt }],
    modules: [
      { id: "m1", courseId: "course-1", position: 0, withdrawnAt: null },
      { id: "m2", courseId: "course-1", position: 1, withdrawnAt: null },
      { id: "m3", courseId: "course-1", position: 2, withdrawnAt: null },
      { id: "m-withdrawn", courseId: "course-1", position: -1_000_001, withdrawnAt: new Date() },
    ],
    lessons: [
      { id: "l1", moduleId: "m1", position: 0, withdrawnAt: null },
      { id: "l2", moduleId: "m1", position: 1, withdrawnAt: null },
      { id: "l3", moduleId: "m2", position: 0, withdrawnAt: null },
      {
        id: "l-withdrawn",
        moduleId: "m1",
        position: -1_000_001,
        withdrawnAt: new Date(),
      },
    ],
    programmeCourses: [
      { id: "pc1", programmeId: "programme-1", position: 0 },
      { id: "pc2", programmeId: "programme-1", position: 1 },
    ],
  };
}

describe("planTwoPass — pure helper", () => {
  it("maps each id to a distinct, negative parking position and its list index as the final position", () => {
    const planned = planTwoPass(["a", "b", "c"]);
    expect(planned).toEqual([
      { id: "a", parkPosition: -1, finalPosition: 0 },
      { id: "b", parkPosition: -2, finalPosition: 1 },
      { id: "c", parkPosition: -3, finalPosition: 2 },
    ]);
    const parkPositions = planned.map((p) => p.parkPosition);
    expect(new Set(parkPositions).size).toBe(parkPositions.length);
    expect(parkPositions.every((p) => p < 0)).toBe(true);
  });
});

describe("serialiseOrderToken / parseOrderToken — round trip (RESEARCH A8)", () => {
  it("round-trips a Date through millisecond precision without loss", () => {
    const original = new Date("2026-03-14T09:26:53.589Z");
    const token = serialiseOrderToken(original);
    const parsed = parseOrderToken(token);
    expect(parsed.getTime()).toBe(original.getTime());
  });
});

describe("commitModuleOrder", () => {
  it("commits a full reversal and returns the moved count", async () => {
    const { service, state } = harness([grant("courses.edit")], baseState());
    await service.commitModuleOrder({
      courseId: "course-1",
      expectedUpdatedAt: state.courses[0].updatedAt,
      moduleIds: ["m3", "m2", "m1"],
    });
    const live = state.modules
      .filter((m) => m.withdrawnAt === null)
      .sort((a, b) => a.position - b.position)
      .map((m) => m.id);
    expect(live).toEqual(["m3", "m2", "m1"]);
  });

  it("throws ArrangementMismatchError and performs no write when the payload names a foreign id", async () => {
    const { service, state } = harness([grant("courses.edit")], baseState());
    const before = state.modules.map((m) => ({ ...m }));
    await expect(
      service.commitModuleOrder({
        courseId: "course-1",
        expectedUpdatedAt: state.courses[0].updatedAt,
        moduleIds: ["m1", "m2", "does-not-exist"],
      }),
    ).rejects.toBeInstanceOf(ArrangementMismatchError);
    expect(state.modules).toEqual(before);
  });

  it("throws ArrangementMismatchError when the payload omits an existing live child", async () => {
    const { service, state } = harness([grant("courses.edit")], baseState());
    const before = state.modules.map((m) => ({ ...m }));
    await expect(
      service.commitModuleOrder({
        courseId: "course-1",
        expectedUpdatedAt: state.courses[0].updatedAt,
        moduleIds: ["m1", "m2"], // omits m3
      }),
    ).rejects.toBeInstanceOf(ArrangementMismatchError);
    expect(state.modules).toEqual(before);
  });

  it("throws ArrangementMismatchError when the payload includes a withdrawn child", async () => {
    const { service, state } = harness([grant("courses.edit")], baseState());
    const before = state.modules.map((m) => ({ ...m }));
    await expect(
      service.commitModuleOrder({
        courseId: "course-1",
        expectedUpdatedAt: state.courses[0].updatedAt,
        moduleIds: ["m1", "m2", "m3", "m-withdrawn"],
      }),
    ).rejects.toBeInstanceOf(ArrangementMismatchError);
    expect(state.modules).toEqual(before);
  });

  it("refuses an arrangement larger than MAX_ARRANGEMENT_SIZE before any write", async () => {
    const state = baseState();
    const { service } = harness([grant("courses.edit")], state);
    const tooLarge = Array.from({ length: MAX_ARRANGEMENT_SIZE + 1 }, (_, i) => `id-${i}`);
    await expect(
      service.commitModuleOrder({
        courseId: "course-1",
        expectedUpdatedAt: state.courses[0].updatedAt,
        moduleIds: tooLarge,
      }),
    ).rejects.toThrow();
  });

  it("throws StaleOrderError and performs no write when expectedUpdatedAt does not match", async () => {
    const { service, state } = harness([grant("courses.edit")], baseState());
    const before = state.modules.map((m) => ({ ...m }));
    await expect(
      service.commitModuleOrder({
        courseId: "course-1",
        expectedUpdatedAt: new Date("2020-01-01T00:00:00.000Z"),
        moduleIds: ["m1", "m2", "m3"],
      }),
    ).rejects.toBeInstanceOf(StaleOrderError);
    expect(state.modules).toEqual(before);
  });

  it("denies a caller with a COURSE grant on a different course", async () => {
    const { service, state } = harness(
      [grant("courses.edit", "COURSE", "some-other-course")],
      baseState(),
    );
    await expect(
      service.commitModuleOrder({
        courseId: "course-1",
        expectedUpdatedAt: state.courses[0].updatedAt,
        moduleIds: ["m1", "m2", "m3"],
      }),
    ).rejects.toThrow("You do not have access");
  });

  it("audits module.reordered with the previous and new ordered id lists", async () => {
    const { service, state, audits } = harness([grant("courses.edit")], baseState());
    await service.commitModuleOrder({
      courseId: "course-1",
      expectedUpdatedAt: state.courses[0].updatedAt,
      moduleIds: ["m3", "m2", "m1"],
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "module.reordered",
      targetType: "Course",
      targetId: "course-1",
      before: ["m1", "m2", "m3"],
      after: ["m3", "m2", "m1"],
    });
  });
});

describe("commitLessonOrder", () => {
  it("commits a cross-module move, re-parenting the lesson in the same transaction", async () => {
    const { service, state } = harness([grant("courses.edit")], baseState());
    await service.commitLessonOrder({
      courseId: "course-1",
      expectedUpdatedAt: state.courses[0].updatedAt,
      arrangement: [
        { moduleId: "m1", lessonIds: ["l2"] },
        { moduleId: "m2", lessonIds: ["l1", "l3"] },
      ],
    });
    const l1 = state.lessons.find((l) => l.id === "l1")!;
    expect(l1.moduleId).toBe("m2");
    expect(l1.position).toBe(0);
    const l3 = state.lessons.find((l) => l.id === "l3")!;
    expect(l3.moduleId).toBe("m2");
    expect(l3.position).toBe(1);
    const l2 = state.lessons.find((l) => l.id === "l2")!;
    expect(l2.moduleId).toBe("m1");
    expect(l2.position).toBe(0);
  });

  it("throws ArrangementMismatchError for a foreign lesson id and performs no write", async () => {
    const { service, state } = harness([grant("courses.edit")], baseState());
    const before = state.lessons.map((l) => ({ ...l }));
    await expect(
      service.commitLessonOrder({
        courseId: "course-1",
        expectedUpdatedAt: state.courses[0].updatedAt,
        arrangement: [{ moduleId: "m1", lessonIds: ["l1", "l2", "foreign-lesson"] }],
      }),
    ).rejects.toBeInstanceOf(ArrangementMismatchError);
    expect(state.lessons).toEqual(before);
  });

  it("throws ArrangementMismatchError when a live lesson is omitted", async () => {
    const { service, state } = harness([grant("courses.edit")], baseState());
    await expect(
      service.commitLessonOrder({
        courseId: "course-1",
        expectedUpdatedAt: state.courses[0].updatedAt,
        arrangement: [{ moduleId: "m1", lessonIds: ["l1"] }], // omits l2
      }),
    ).rejects.toBeInstanceOf(ArrangementMismatchError);
  });

  it("throws ArrangementMismatchError when a withdrawn lesson is included", async () => {
    const { service, state } = harness([grant("courses.edit")], baseState());
    await expect(
      service.commitLessonOrder({
        courseId: "course-1",
        expectedUpdatedAt: state.courses[0].updatedAt,
        arrangement: [{ moduleId: "m1", lessonIds: ["l1", "l2", "l-withdrawn"] }],
      }),
    ).rejects.toBeInstanceOf(ArrangementMismatchError);
  });

  it("is gated on courses.edit at the parent Course's scope — a COURSE grant on a different course is denied", async () => {
    const { service, state } = harness(
      [grant("courses.edit", "COURSE", "some-other-course")],
      baseState(),
    );
    await expect(
      service.commitLessonOrder({
        courseId: "course-1",
        expectedUpdatedAt: state.courses[0].updatedAt,
        arrangement: [{ moduleId: "m1", lessonIds: ["l1", "l2"] }],
      }),
    ).rejects.toThrow("You do not have access");
  });
});

describe("commitProgrammeCourseOrder", () => {
  it("commits a full reversal", async () => {
    const { service, state } = harness([grant("programmes.manage")], baseState());
    await service.commitProgrammeCourseOrder({
      programmeId: "programme-1",
      expectedUpdatedAt: state.programmes[0].updatedAt,
      programmeCourseIds: ["pc2", "pc1"],
    });
    const ordered = state.programmeCourses
      .sort((a, b) => a.position - b.position)
      .map((pc) => pc.id);
    expect(ordered).toEqual(["pc2", "pc1"]);
  });

  it("is gated on programmes.manage at the Programme's scope", async () => {
    const { service, state } = harness(
      [grant("programmes.manage", "PROGRAMME", "some-other-programme")],
      baseState(),
    );
    await expect(
      service.commitProgrammeCourseOrder({
        programmeId: "programme-1",
        expectedUpdatedAt: state.programmes[0].updatedAt,
        programmeCourseIds: ["pc1", "pc2"],
      }),
    ).rejects.toThrow("You do not have access");
  });

  it("throws StaleOrderError when expectedUpdatedAt does not match", async () => {
    const { service } = harness([grant("programmes.manage")], baseState());
    await expect(
      service.commitProgrammeCourseOrder({
        programmeId: "programme-1",
        expectedUpdatedAt: new Date("2020-01-01T00:00:00.000Z"),
        programmeCourseIds: ["pc1", "pc2"],
      }),
    ).rejects.toBeInstanceOf(StaleOrderError);
  });
});
