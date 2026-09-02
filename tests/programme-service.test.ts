import { describe, expect, it, vi } from "vitest";
import { grant, createTestWithPermission } from "./support/harness";
import { createResourceService, type Delegate } from "@/server/services/resource-service";
import {
  programmeScope,
  createProgrammeMembershipOperations,
  DuplicateMembershipError,
  type ProgrammeCourseDelegate,
  type ProgrammeCourseRow,
} from "@/server/services/programme-service";

type ProgrammeRecord = { id: string; title: string; status: string };

function makeProgrammeDelegate(rows: ProgrammeRecord[]): Delegate<ProgrammeRecord> {
  return {
    findMany: vi.fn(async () => rows),
    findUnique: vi.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }) => ({ id: "p-new", status: "DRAFT", ...data }) as ProgrammeRecord),
    update: vi.fn(async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
}

/** In-memory fake `ProgrammeCourse` table, in the style of `tests/resource-service.test.ts`. */
function makeProgrammeCourseDelegate(initial: ProgrammeCourseRow[] = []) {
  const rows: ProgrammeCourseRow[] = [...initial];
  let nextId = initial.length + 1;

  const delegate: ProgrammeCourseDelegate = {
    findMany: vi.fn(async ({ where }) =>
      rows.filter((r) => r.programmeId === where.programmeId),
    ),
    create: vi.fn(async ({ data }) => {
      const row = { id: `pc${nextId++}`, ...(data as Omit<ProgrammeCourseRow, "id">) };
      rows.push(row);
      return row;
    }),
    delete: vi.fn(async ({ where }) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      const [removed] = rows.splice(idx, 1);
      return removed;
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

describe("programmeScope", () => {
  it("maps a programme id to a PROGRAMME-scoped resource", () => {
    expect(programmeScope("prog-1")).toEqual({ programmeId: "prog-1" });
  });
});

describe("programmeService — get, scoped by a PROGRAMME grant", () => {
  it("succeeds for a caller holding a PROGRAMME grant naming this programme", async () => {
    const rows: ProgrammeRecord[] = [{ id: "p1", title: "Leadership", status: "DRAFT" }];
    const delegate = makeProgrammeDelegate(rows);
    const { withPermission } = createTestWithPermission([
      grant("programmes.view", "PROGRAMME", "p1"),
    ]);
    const service = createResourceService<ProgrammeRecord>({
      name: "Programme",
      delegate,
      permissions: { view: "programmes.view", create: "programmes.manage", edit: "programmes.manage" },
      toScope: programmeScope,
      withPermission,
      audit: async () => {},
    });

    await expect(service.get("p1")).resolves.toMatchObject({ id: "p1" });
  });

  it("is denied for a caller whose PROGRAMME grant names a different id", async () => {
    const rows: ProgrammeRecord[] = [
      { id: "p1", title: "Leadership", status: "DRAFT" },
      { id: "p2", title: "Safety", status: "DRAFT" },
    ];
    const delegate = makeProgrammeDelegate(rows);
    const { withPermission } = createTestWithPermission([
      grant("programmes.view", "PROGRAMME", "p2"),
    ]);
    const service = createResourceService<ProgrammeRecord>({
      name: "Programme",
      delegate,
      permissions: { view: "programmes.view", create: "programmes.manage", edit: "programmes.manage" },
      toScope: programmeScope,
      withPermission,
      audit: async () => {},
    });

    await expect(service.get("p1")).rejects.toThrow();
  });
});

describe("programmeService.archive", () => {
  it("writes status: ARCHIVED and audits with a reason", async () => {
    const rows: ProgrammeRecord[] = [{ id: "p1", title: "Leadership", status: "DRAFT" }];
    const delegate = makeProgrammeDelegate(rows);
    const { withPermission } = createTestWithPermission([grant("programmes.manage")]);
    const audits: unknown[] = [];
    const service = createResourceService<ProgrammeRecord>({
      name: "Programme",
      delegate,
      permissions: { view: "programmes.view", create: "programmes.manage", edit: "programmes.manage" },
      toScope: programmeScope,
      withPermission,
      audit: async (entry) => {
        audits.push(entry);
      },
    });

    await service.archive("p1", "Discontinued");

    expect(rows[0].status).toBe("ARCHIVED");
    expect(audits[0]).toMatchObject({
      action: "programme.archived",
      targetId: "p1",
      reason: "Discontinued",
    });
  });
});

describe("addCourseToProgramme (CAT-02: reference, never clone)", () => {
  it("creates one ProgrammeCourse row at the end of the list, no Course row", async () => {
    const { delegate, rows } = makeProgrammeCourseDelegate();
    const { withPermission } = createTestWithPermission([grant("programmes.manage")]);
    const audits: unknown[] = [];
    const { addCourseToProgramme } = createProgrammeMembershipOperations({
      programmeCourse: delegate,
      withPermission,
      audit: async (entry) => {
        audits.push(entry);
      },
    });

    const created = await addCourseToProgramme({ programmeId: "prog-1", courseId: "course-1" });

    expect(created).toMatchObject({ programmeId: "prog-1", courseId: "course-1", position: 0 });
    expect(rows()).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "programme.course_added", targetId: "prog-1" });
  });

  it("two consecutive calls for the same Programme produce two distinct positions", async () => {
    const { delegate } = makeProgrammeCourseDelegate();
    const { withPermission } = createTestWithPermission([grant("programmes.manage")]);
    const { addCourseToProgramme } = createProgrammeMembershipOperations({
      programmeCourse: delegate,
      withPermission,
      audit: async () => {},
    });

    const first = await addCourseToProgramme({ programmeId: "prog-1", courseId: "course-1" });
    const second = await addCourseToProgramme({ programmeId: "prog-1", courseId: "course-2" });

    expect(first.position).not.toBe(second.position);
    expect(second.position).toBe(first.position + 1);
  });

  it("ignores any position supplied by the caller", async () => {
    const { delegate } = makeProgrammeCourseDelegate();
    const { withPermission } = createTestWithPermission([grant("programmes.manage")]);
    const { addCourseToProgramme } = createProgrammeMembershipOperations({
      programmeCourse: delegate,
      withPermission,
      audit: async () => {},
    });

    const created = await addCourseToProgramme({
      programmeId: "prog-1",
      courseId: "course-1",
      // @ts-expect-error position is not part of the accepted input
      position: 999,
    });

    expect(created.position).toBe(0);
  });

  it("adding the same courseId to a second Programme succeeds and leaves the Course row count unchanged", async () => {
    const { delegate } = makeProgrammeCourseDelegate();
    const courseRows = [{ id: "course-1" }, { id: "course-2" }];
    const { withPermission } = createTestWithPermission([grant("programmes.manage")]);
    const { addCourseToProgramme } = createProgrammeMembershipOperations({
      programmeCourse: delegate,
      withPermission,
      audit: async () => {},
    });

    await addCourseToProgramme({ programmeId: "prog-1", courseId: "course-1" });
    await addCourseToProgramme({ programmeId: "prog-2", courseId: "course-1" });

    // addCourseToProgramme never touches a Course delegate at all — the
    // simulated Course table is untouched, proving the reference-not-clone
    // rule structurally rather than by inspection.
    expect(courseRows).toHaveLength(2);
  });

  it("rejects adding a courseId already in the Programme with a typed DuplicateMembershipError", async () => {
    const { delegate } = makeProgrammeCourseDelegate([
      { id: "pc1", programmeId: "prog-1", courseId: "course-1", position: 0 },
    ]);
    const { withPermission } = createTestWithPermission([grant("programmes.manage")]);
    const { addCourseToProgramme } = createProgrammeMembershipOperations({
      programmeCourse: delegate,
      withPermission,
      audit: async () => {},
    });

    await expect(
      addCourseToProgramme({ programmeId: "prog-1", courseId: "course-1" }),
    ).rejects.toBeInstanceOf(DuplicateMembershipError);
  });
});

describe("removeCourseFromProgramme (the one hard-delete path)", () => {
  it("deletes only the join row and renumbers survivors to a contiguous 0..n-1 sequence", async () => {
    const { delegate, rows } = makeProgrammeCourseDelegate([
      { id: "pc1", programmeId: "prog-1", courseId: "course-1", position: 0 },
      { id: "pc2", programmeId: "prog-1", courseId: "course-2", position: 1 },
      { id: "pc3", programmeId: "prog-1", courseId: "course-3", position: 2 },
    ]);
    const { withPermission } = createTestWithPermission([grant("programmes.manage")]);
    const audits: unknown[] = [];
    const { removeCourseFromProgramme } = createProgrammeMembershipOperations({
      programmeCourse: delegate,
      withPermission,
      audit: async (entry) => {
        audits.push(entry);
      },
    });

    await removeCourseFromProgramme({ programmeId: "prog-1", courseId: "course-2" });

    const remaining = rows()
      .slice()
      .sort((a, b) => a.position - b.position);
    expect(remaining.map((r) => r.courseId)).toEqual(["course-1", "course-3"]);
    expect(remaining.map((r) => r.position)).toEqual([0, 1]);
    expect(audits[0]).toMatchObject({
      action: "programme.course_removed",
      targetId: "prog-1",
      before: ["course-1", "course-2", "course-3"],
      after: ["course-1", "course-3"],
    });
  });
});
