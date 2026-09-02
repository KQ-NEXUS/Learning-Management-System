import { describe, expect, it, vi } from "vitest";
import { grant, createTestWithPermission } from "./support/harness";
import {
  createModuleService,
  type ModuleDelegate,
  type ModuleRecord,
} from "@/server/services/module-service";
import {
  createLessonService,
  type LessonDelegate,
  type LessonRecord,
} from "@/server/services/lesson-service";

function makeModuleDelegate(initial: ModuleRecord[] = []) {
  const rows: ModuleRecord[] = initial.map((r) => ({ ...r }));
  let nextId = initial.length + 1;

  const delegate: ModuleDelegate = {
    findMany: vi.fn(async ({ where }) => {
      const courseId = (where as { courseId?: string } | undefined)?.courseId;
      return courseId ? rows.filter((r) => r.courseId === courseId) : rows.slice();
    }),
    findUnique: vi.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }) => {
      const row = {
        id: `m${nextId++}`,
        summary: null,
        withdrawnAt: null,
        ...(data as Partial<ModuleRecord>),
      } as ModuleRecord;
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };

  return { delegate, rows: () => rows };
}

function makeLessonDelegate(initial: LessonRecord[] = []) {
  const rows: LessonRecord[] = initial.map((r) => ({ ...r }));
  let nextId = initial.length + 1;

  const delegate: LessonDelegate = {
    findMany: vi.fn(async ({ where }) => {
      const moduleId = (where as { moduleId?: string } | undefined)?.moduleId;
      return moduleId ? rows.filter((r) => r.moduleId === moduleId) : rows.slice();
    }),
    findUnique: vi.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }) => {
      const row = {
        id: `l${nextId++}`,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
        ...(data as Partial<LessonRecord>),
      } as LessonRecord;
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };

  return { delegate, rows: () => rows };
}

describe("moduleScope", () => {
  it("resolves a Module id to its parent Course id by query", async () => {
    const { delegate } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "Intro", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { withPermission } = createTestWithPermission([]);
    const { moduleScope } = createModuleService({
      delegate,
      withPermission,
      audit: async () => {},
    });

    await expect(moduleScope("m1")).resolves.toEqual({ courseIds: ["c1"] });
  });

  it("resolves to { courseIds: [] } for an unknown id — a denial, not a throw", async () => {
    const { delegate } = makeModuleDelegate([]);
    const { withPermission } = createTestWithPermission([]);
    const { moduleScope } = createModuleService({
      delegate,
      withPermission,
      audit: async () => {},
    });

    await expect(moduleScope("missing")).resolves.toEqual({ courseIds: [] });
  });
});

describe("createModule", () => {
  it("inserts at nextAppendPosition(max(live sibling position)) computed inside one unit of work", async () => {
    const { delegate } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "Intro", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const audits: unknown[] = [];
    const { createModule } = createModuleService({
      delegate,
      withPermission,
      audit: async (entry) => {
        audits.push(entry);
      },
    });

    const created = await createModule({ courseId: "c1", title: "Advanced" });

    expect(created).toMatchObject({ courseId: "c1", title: "Advanced", position: 1 });
    expect(audits[0]).toMatchObject({ action: "module.created" });
  });

  it("two consecutive createModule calls for the same Course yield distinct positions", async () => {
    const { delegate } = makeModuleDelegate([]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { createModule } = createModuleService({
      delegate,
      withPermission,
      audit: async () => {},
    });

    const first = await createModule({ courseId: "c1", title: "One" });
    const second = await createModule({ courseId: "c1", title: "Two" });

    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
  });

  it("lands at 3, not 2, when creating after withdrawing the middle row of 0, 1, 2", async () => {
    const { delegate } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
      { id: "m2", courseId: "c1", title: "B", summary: null, position: 1, withdrawnAt: null },
      { id: "m3", courseId: "c1", title: "C", summary: null, position: 2, withdrawnAt: null },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { createModule, moduleService } = createModuleService({
      delegate,
      withPermission,
      audit: async () => {},
    });

    await moduleService.archive("m2", "Superseded");
    const created = await createModule({ courseId: "c1", title: "D" });

    expect(created.position).toBe(3);
  });

  it("rejects an input carrying a position key rather than silently dropping it", async () => {
    const { delegate } = makeModuleDelegate([]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { createModule } = createModuleService({
      delegate,
      withPermission,
      audit: async () => {},
    });

    await expect(
      createModule({ courseId: "c1", title: "One", position: 999 } as never),
    ).rejects.toThrow();
  });
});

describe("moduleService.archive (D-17)", () => {
  it("writes withdrawnAt to a Date AND parks position, with no status key", async () => {
    const { delegate, rows } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const audits: unknown[] = [];
    const { moduleService } = createModuleService({
      delegate,
      withPermission,
      audit: async (entry) => {
        audits.push(entry);
      },
    });

    await moduleService.archive("m1", "Superseded");

    const row = rows()[0];
    expect(row.withdrawnAt).toBeInstanceOf(Date);
    expect(row.position).toBeLessThan(-1_000_000);
    expect(row).not.toHaveProperty("status");
    expect(audits[0]).toMatchObject({ action: "module.archived", reason: "Superseded" });
  });

  it("parks two consecutive withdrawals from the same Course at distinct positions", async () => {
    const { delegate, rows } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
      { id: "m2", courseId: "c1", title: "B", summary: null, position: 1, withdrawnAt: null },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { moduleService } = createModuleService({
      delegate,
      withPermission,
      audit: async () => {},
    });

    await moduleService.archive("m1", "First");
    await moduleService.archive("m2", "Second");

    const positions = rows().map((r) => r.position);
    expect(new Set(positions).size).toBe(2);
    expect(Math.min(...positions)).toBeLessThan(Math.max(...positions));
  });
});

describe("moduleService.restore (D-34)", () => {
  it("writes withdrawnAt: null AND appends to the end of the live list", async () => {
    const { delegate, rows } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
      { id: "m2", courseId: "c1", title: "B", summary: null, position: 1, withdrawnAt: null },
      { id: "m3", courseId: "c1", title: "C", summary: null, position: -1_000_001, withdrawnAt: new Date() },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { moduleService } = createModuleService({
      delegate,
      withPermission,
      audit: async () => {},
    });

    await (moduleService as unknown as { restore: (id: string, reason: string) => Promise<ModuleRecord> })
      .restore("m3", "Bring it back");

    const restored = rows().find((r) => r.id === "m3")!;
    expect(restored.withdrawnAt).toBeNull();
    expect(restored.position).toBe(2);
  });
});

describe("listActiveModules / listWithdrawnModules", () => {
  it("listActiveModules returns only withdrawnAt: null rows, ordered by position ascending", async () => {
    const { delegate } = makeModuleDelegate([
      { id: "m2", courseId: "c1", title: "B", summary: null, position: 1, withdrawnAt: null },
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
      { id: "m3", courseId: "c1", title: "C", summary: null, position: -1_000_001, withdrawnAt: new Date() },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.view")]);
    const { listActiveModules } = createModuleService({
      delegate,
      withPermission,
      audit: async () => {},
    });

    const active = await listActiveModules("c1");
    expect(active.map((r) => r.id)).toEqual(["m1", "m2"]);
  });

  it("listWithdrawnModules returns only rows with a non-null withdrawnAt", async () => {
    const { delegate } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
      { id: "m3", courseId: "c1", title: "C", summary: null, position: -1_000_001, withdrawnAt: new Date() },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.view")]);
    const { listWithdrawnModules } = createModuleService({
      delegate,
      withPermission,
      audit: async () => {},
    });

    const withdrawn = await listWithdrawnModules("c1");
    expect(withdrawn.map((r) => r.id)).toEqual(["m3"]);
  });
});

// Lesson mirrors Module's mechanism exactly, scoped one level deeper
// (Lesson -> Module -> Course).
function resolveCourseIdFromModules(moduleRows: () => ModuleRecord[]) {
  return async (moduleId: string) => moduleRows().find((m) => m.id === moduleId)?.courseId ?? null;
}

describe("lessonScope", () => {
  it("resolves through Lesson -> Module -> Course in a chain of lookups", async () => {
    const { rows: moduleRows } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "Intro", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { delegate: lessonDelegate } = makeLessonDelegate([
      {
        id: "l1",
        moduleId: "m1",
        title: "Welcome",
        type: "TEXT",
        position: 0,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
    ]);
    const { withPermission } = createTestWithPermission([]);
    const { lessonScope } = createLessonService({
      delegate: lessonDelegate,
      resolveCourseIdForModule: resolveCourseIdFromModules(moduleRows),
      withPermission,
      audit: async () => {},
    });

    await expect(lessonScope("l1")).resolves.toEqual({ courseIds: ["c1"] });
  });
});

describe("cross-course denial (T-04-11)", () => {
  it("a caller with COURSE-scoped courses.edit on course A can update a Lesson in course A", async () => {
    const { rows: moduleRows } = makeModuleDelegate([
      { id: "mA", courseId: "courseA", title: "A", summary: null, position: 0, withdrawnAt: null },
      { id: "mB", courseId: "courseB", title: "B", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { delegate: lessonDelegate } = makeLessonDelegate([
      {
        id: "lA1",
        moduleId: "mA",
        title: "Welcome",
        type: "TEXT",
        position: 0,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
      {
        id: "lB1",
        moduleId: "mB",
        title: "Welcome",
        type: "TEXT",
        position: 0,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
    ]);
    const { withPermission } = createTestWithPermission([
      grant("courses.edit", "COURSE", "courseA"),
    ]);
    const { lessonService } = createLessonService({
      delegate: lessonDelegate,
      resolveCourseIdForModule: resolveCourseIdFromModules(moduleRows),
      withPermission,
      audit: async () => {},
    });

    await expect(lessonService.update("lA1", { title: "Renamed" }, "Fix typo")).resolves.toMatchObject({
      title: "Renamed",
    });
  });

  it("is denied on course B's Lesson", async () => {
    const { rows: moduleRows } = makeModuleDelegate([
      { id: "mA", courseId: "courseA", title: "A", summary: null, position: 0, withdrawnAt: null },
      { id: "mB", courseId: "courseB", title: "B", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { delegate: lessonDelegate } = makeLessonDelegate([
      {
        id: "lB1",
        moduleId: "mB",
        title: "Welcome",
        type: "TEXT",
        position: 0,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
    ]);
    const { withPermission } = createTestWithPermission([
      grant("courses.edit", "COURSE", "courseA"),
    ]);
    const { lessonService } = createLessonService({
      delegate: lessonDelegate,
      resolveCourseIdForModule: resolveCourseIdFromModules(moduleRows),
      withPermission,
      audit: async () => {},
    });

    await expect(lessonService.update("lB1", { title: "Renamed" }, "Fix typo")).rejects.toThrow();
  });
});

describe("lessonService.archive / restore mirror Module's mechanism", () => {
  it("two consecutive lessonService.archive calls within one Module yield distinct parked positions", async () => {
    const { rows: moduleRows } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { delegate: lessonDelegate, rows } = makeLessonDelegate([
      {
        id: "l1",
        moduleId: "m1",
        title: "One",
        type: "TEXT",
        position: 0,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
      {
        id: "l2",
        moduleId: "m1",
        title: "Two",
        type: "TEXT",
        position: 1,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { lessonService } = createLessonService({
      delegate: lessonDelegate,
      resolveCourseIdForModule: resolveCourseIdFromModules(moduleRows),
      withPermission,
      audit: async () => {},
    });

    await lessonService.archive("l1", "First");
    await lessonService.archive("l2", "Second");

    const positions = rows().map((r) => r.position);
    expect(new Set(positions).size).toBe(2);
  });

  it("restore appends a withdrawn Lesson to the end of the live list without colliding", async () => {
    const { rows: moduleRows } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { delegate: lessonDelegate, rows } = makeLessonDelegate([
      {
        id: "l1",
        moduleId: "m1",
        title: "One",
        type: "TEXT",
        position: 0,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
      {
        id: "l2",
        moduleId: "m1",
        title: "Two",
        type: "TEXT",
        position: -1_000_001,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: new Date(),
      },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { lessonService } = createLessonService({
      delegate: lessonDelegate,
      resolveCourseIdForModule: resolveCourseIdFromModules(moduleRows),
      withPermission,
      audit: async () => {},
    });

    await (lessonService as unknown as { restore: (id: string, reason: string) => Promise<LessonRecord> })
      .restore("l2", "Bring it back");

    const restored = rows().find((r) => r.id === "l2")!;
    expect(restored.withdrawnAt).toBeNull();
    expect(restored.position).toBe(1);
  });
});

describe("createLesson positioning mirrors createModule", () => {
  it("two consecutive createLesson calls in one Module yield distinct positions", async () => {
    const { rows: moduleRows } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { delegate: lessonDelegate } = makeLessonDelegate([]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { createLesson } = createLessonService({
      delegate: lessonDelegate,
      resolveCourseIdForModule: resolveCourseIdFromModules(moduleRows),
      withPermission,
      audit: async () => {},
    });

    const first = await createLesson({ moduleId: "m1", title: "Intro", type: "TEXT", body: "hello" });
    const second = await createLesson({ moduleId: "m1", title: "Next", type: "TEXT", body: "hello" });

    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
  });

  it("lands at 3, not 2, when creating a Lesson after withdrawing the middle row of 0, 1, 2", async () => {
    const { rows: moduleRows } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { delegate: lessonDelegate } = makeLessonDelegate([
      {
        id: "l1",
        moduleId: "m1",
        title: "One",
        type: "TEXT",
        position: 0,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
      {
        id: "l2",
        moduleId: "m1",
        title: "Two",
        type: "TEXT",
        position: 1,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
      {
        id: "l3",
        moduleId: "m1",
        title: "Three",
        type: "TEXT",
        position: 2,
        body: null,
        embedUrl: null,
        linkUrl: null,
        required: true,
        allowManualComplete: true,
        assessmentId: null,
        withdrawnAt: null,
      },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { createLesson, lessonService } = createLessonService({
      delegate: lessonDelegate,
      resolveCourseIdForModule: resolveCourseIdFromModules(moduleRows),
      withPermission,
      audit: async () => {},
    });

    await lessonService.archive("l2", "Superseded");
    const created = await createLesson({ moduleId: "m1", title: "Four", type: "TEXT", body: "hello" });

    expect(created.position).toBe(3);
  });

  it("rejects an input carrying a position key rather than silently dropping it", async () => {
    const { rows: moduleRows } = makeModuleDelegate([
      { id: "m1", courseId: "c1", title: "A", summary: null, position: 0, withdrawnAt: null },
    ]);
    const { delegate: lessonDelegate } = makeLessonDelegate([]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    const { createLesson } = createLessonService({
      delegate: lessonDelegate,
      resolveCourseIdForModule: resolveCourseIdFromModules(moduleRows),
      withPermission,
      audit: async () => {},
    });

    await expect(
      createLesson({
        moduleId: "m1",
        title: "Intro",
        type: "TEXT",
        body: "hello",
        position: 999,
      } as never),
    ).rejects.toThrow();
  });
});
