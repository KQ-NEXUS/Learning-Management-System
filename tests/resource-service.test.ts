import { describe, expect, it, vi } from "vitest";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import {
  createResourceService,
  PositionContentionError,
  type Delegate,
} from "@/server/services/resource-service";

type Course = { id: string; title: string; status: string };

const grant = (
  permission: string,
  scopeType: RawGrant["scopeType"] = "GLOBAL",
  scopeId: string | null = null,
): RawGrant => ({
  permission: permission as RawGrant["permission"],
  scopeType,
  scopeId,
  active: true,
  revokedAt: null,
  startsAt: null,
  endsAt: null,
});

function harness(grants: RawGrant[]) {
  const rows: Course[] = [
    { id: "c1", title: "Safety", status: "DRAFT" },
    { id: "c2", title: "Finance", status: "PUBLISHED" },
  ];

  const delegate: Delegate<Course> = {
    findMany: vi.fn(async () => rows),
    findUnique: vi.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }) => ({ id: "c3", status: "DRAFT", ...data }) as Course),
    update: vi.fn(async ({ where, data }) => ({
      ...(rows.find((r) => r.id === where.id) as Course),
      ...data,
    })),
  };

  const audits: unknown[] = [];
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "user-1" }),
    loadGrants: async () => grants,
    audit: async () => {},
  });

  const service = createResourceService<Course>({
    name: "Course",
    delegate,
    permissions: {
      view: "courses.view",
      create: "courses.create",
      edit: "courses.edit",
    },
    toScope: (id) => ({ courseIds: [id] }),
    withPermission,
    audit: async (entry) => {
      audits.push(entry);
    },
  });

  return { service, delegate, audits };
}

describe("resource service factory", () => {
  it("lists when the caller holds a global view grant", async () => {
    const { service, delegate } = harness([grant("courses.view")]);
    await expect(service.list({})).resolves.toHaveLength(2);
    expect(delegate.findMany).toHaveBeenCalled();
  });

  it("refuses to list without the view permission", async () => {
    const { service, delegate } = harness([grant("courses.edit")]);
    await expect(service.list({})).rejects.toThrow();
    expect(delegate.findMany).not.toHaveBeenCalled();
  });

  it("refuses an unscoped list when the grant is scoped", async () => {
    const { service, delegate } = harness([grant("courses.view", "COURSE", "c1")]);
    await expect(service.list({})).rejects.toThrow();
    expect(delegate.findMany).not.toHaveBeenCalled();
  });

  it("allows a scoped list within the granted scope", async () => {
    const { service } = harness([grant("courses.view", "COURSE", "c1")]);
    await expect(service.list({ scope: { courseIds: ["c1"] } })).resolves.toHaveLength(2);
  });

  it("gets a record the caller may see", async () => {
    const { service } = harness([grant("courses.view", "COURSE", "c1")]);
    await expect(service.get("c1")).resolves.toMatchObject({ id: "c1" });
  });

  it("denies a record outside the caller's scope", async () => {
    const { service, delegate } = harness([grant("courses.view", "COURSE", "c1")]);
    await expect(service.get("c2")).rejects.toThrow();
    expect(delegate.findUnique).not.toHaveBeenCalled();
  });

  it("creates and audits", async () => {
    const { service, audits } = harness([grant("courses.create")]);
    await expect(service.create({ title: "New" })).resolves.toMatchObject({ id: "c3" });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "course.created",
      targetType: "Course",
      outcome: "SUCCESS",
    });
  });

  it("refuses to create without the create permission", async () => {
    const { service, delegate } = harness([grant("courses.view")]);
    await expect(service.create({ title: "New" })).rejects.toThrow();
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it("updates and audits before and after state", async () => {
    const { service, audits } = harness([grant("courses.edit")]);
    await service.update("c1", { title: "Renamed" }, "Typo in title");

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "course.updated",
      targetId: "c1",
      reason: "Typo in title",
    });
    expect((audits[0] as { before: Course }).before.title).toBe("Safety");
    expect((audits[0] as { after: Course }).after.title).toBe("Renamed");
  });

  it("archives rather than deleting", async () => {
    const { service, delegate, audits } = harness([grant("courses.edit")]);
    await service.archive("c1", "Superseded");

    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ARCHIVED" }) }),
    );
    expect(audits[0]).toMatchObject({ action: "course.archived", reason: "Superseded" });
  });

  it("has no delete operation at all", () => {
    const { service } = harness([grant("courses.edit")]);
    expect((service as Record<string, unknown>).delete).toBeUndefined();
  });
});

// A Lesson-shaped record: its scope is not itself, it is its parent Course,
// which must be looked up rather than derived from the id. Models
// Pitfall 9 / D-17's Module and Lesson case.
type Lesson = { id: string; title: string };

function asyncHarness(grants: RawGrant[]) {
  // The in-test "database" a real toScope would query.
  const parentCourseByLessonId: Record<string, string | undefined> = {
    l1: "c1",
    l2: "c2",
  };

  const rows: Lesson[] = [
    { id: "l1", title: "Intro" },
    { id: "l2", title: "Advanced" },
  ];

  const delegate: Delegate<Lesson> = {
    findMany: vi.fn(async () => rows),
    findUnique: vi.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }) => ({ id: "l3", ...data }) as Lesson),
    update: vi.fn(async ({ where, data }) => ({
      ...(rows.find((r) => r.id === where.id) as Lesson),
      ...data,
    })),
  };

  const audits: unknown[] = [];
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "user-1" }),
    loadGrants: async () => grants,
    audit: async () => {},
  });

  const service = createResourceService<Lesson>({
    name: "Lesson",
    delegate,
    permissions: {
      view: "courses.view",
      create: "courses.edit",
      edit: "courses.edit",
    },
    // Async — the parent Course id is read from the database, not derived
    // from the lesson id and never taken as a caller-supplied argument.
    toScope: async (id) => ({
      courseIds: [parentCourseByLessonId[id]].filter((v): v is string => !!v),
    }),
    withPermission,
    audit: async (entry) => {
      audits.push(entry);
    },
  });

  return { service, delegate, audits };
}

describe("resource service factory — async scope resolution (Pitfall 9)", () => {
  it("authorizes get for a caller holding a COURSE grant on the looked-up parent", async () => {
    const { service } = asyncHarness([grant("courses.view", "COURSE", "c1")]);
    await expect(service.get("l1")).resolves.toMatchObject({ id: "l1" });
  });

  it("authorizes update via the looked-up parent scope", async () => {
    const { service, audits } = asyncHarness([grant("courses.edit", "COURSE", "c1")]);
    await service.update("l1", { title: "Renamed" }, "Fix typo");
    expect(audits[0]).toMatchObject({ action: "lesson.updated", targetId: "l1" });
  });

  it("denies a caller whose COURSE grant names a different course", async () => {
    const { service, delegate } = asyncHarness([grant("courses.view", "COURSE", "c2")]);
    await expect(service.get("l1")).rejects.toThrow();
    expect(delegate.findUnique).not.toHaveBeenCalled();
  });

  it("denies rather than crashes when the async toScope resolves to an empty courseIds (parent not found)", async () => {
    const { service, delegate } = asyncHarness([grant("courses.view", "COURSE", "c1")]);
    // "missing" has no entry in parentCourseByLessonId, so toScope resolves
    // to { courseIds: [] } — must be a denial, not an exception other than
    // AuthorizationError, and never a permissive default.
    await expect(service.get("missing")).rejects.toThrow("You do not have access");
    expect(delegate.findUnique).not.toHaveBeenCalled();
  });

  it("still works unchanged for a synchronous toScope (course-service.ts needs no edit)", async () => {
    const { service } = harness([grant("courses.view", "COURSE", "c1")]);
    await expect(service.get("c1")).resolves.toMatchObject({ id: "c1" });
  });
});

// Simulates a Prisma unique-constraint violation without importing
// @prisma/client — the factory must stay Prisma-free (T-04-10b, Pattern in
// 04-RESEARCH.md §Pattern 3). Only `code` matters to the factory's retry logic.
class FakePrismaError extends Error {
  code: string;
  constructor(code: string) {
    super(`Simulated Prisma error ${code}`);
    this.code = code;
  }
}

type ArchiveRestoreOverrides = Partial<{
  archiveData: (id: string) => Record<string, unknown> | Promise<Record<string, unknown>>;
  restoreData: (id: string) => Record<string, unknown> | Promise<Record<string, unknown>>;
  runInTransaction: <R>(fn: () => Promise<R>) => Promise<R>;
  updateImpl: (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => Promise<Course>;
}>;

function harnessWithOptions(grants: RawGrant[], overrides: ArchiveRestoreOverrides = {}) {
  const rows: Course[] = [
    { id: "c1", title: "Safety", status: "DRAFT" },
    { id: "c2", title: "Finance", status: "PUBLISHED" },
  ];

  const defaultUpdate = async ({
    where,
    data,
  }: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => ({
    ...(rows.find((r) => r.id === where.id) as Course),
    ...data,
  });

  const delegate: Delegate<Course> = {
    findMany: vi.fn(async () => rows),
    findUnique: vi.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }) => ({ id: "c3", status: "DRAFT", ...data }) as Course),
    update: vi.fn(overrides.updateImpl ?? defaultUpdate),
  };

  const audits: unknown[] = [];
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "user-1" }),
    loadGrants: async () => grants,
    audit: async () => {},
  });

  const service = createResourceService<Course>({
    name: "Course",
    delegate,
    permissions: {
      view: "courses.view",
      create: "courses.create",
      edit: "courses.edit",
    },
    toScope: (id) => ({ courseIds: [id] }),
    withPermission,
    audit: async (entry) => {
      audits.push(entry);
    },
    archiveData: overrides.archiveData,
    restoreData: overrides.restoreData,
    runInTransaction: overrides.runInTransaction,
  });

  return { service, delegate, audits };
}

describe("resource service factory — parameterised archive payload (D-16, D-17)", () => {
  it("writes a custom archiveData payload instead of status, with no status key", async () => {
    const { service, delegate } = harnessWithOptions([grant("courses.edit")], {
      archiveData: async () => ({ withdrawnAt: new Date("2026-01-01"), position: -1000001 }),
    });
    await service.archive("c1", "Withdrawn");

    const call = (delegate.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).not.toHaveProperty("status");
    expect(call.data).toMatchObject({ position: -1000001 });
  });

  it("passes the record id to the archiveData builder, which may be async", async () => {
    const archiveData = vi.fn(async (id: string) => ({ withdrawnAt: new Date(), parentOf: id }));
    const { service } = harnessWithOptions([grant("courses.edit")], { archiveData });
    await service.archive("c1", "Withdrawn");
    expect(archiveData).toHaveBeenCalledWith("c1");
  });

  it("behaves exactly as before when runInTransaction is omitted (no wrapper)", async () => {
    const { service, delegate, audits } = harnessWithOptions([grant("courses.edit")]);
    await service.archive("c1", "Superseded");

    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ARCHIVED" }) }),
    );
    expect(audits[0]).toMatchObject({ action: "course.archived", reason: "Superseded" });
  });

  it("runs the read-before, payload build and update INSIDE the injected transaction callback", async () => {
    const callOrder: string[] = [];
    let runInTransactionCalls = 0;
    const runInTransaction = async <R,>(fn: () => Promise<R>): Promise<R> => {
      runInTransactionCalls += 1;
      callOrder.push("transaction-start");
      const result = await fn();
      callOrder.push("transaction-end");
      return result;
    };
    const archiveData = vi.fn(async () => {
      callOrder.push("payload-build");
      return { withdrawnAt: new Date(), position: -1000001 };
    });

    const { service, delegate } = harnessWithOptions([grant("courses.edit")], {
      archiveData,
      runInTransaction,
    });

    (delegate.findUnique as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        callOrder.push("read-before");
        return { id: where.id, title: "Safety", status: "DRAFT" };
      },
    );
    (delegate.update as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        callOrder.push("update");
        return { id: where.id, title: "Safety", ...data };
      },
    );

    await service.archive("c1", "Withdrawn");

    expect(runInTransactionCalls).toBe(1);
    expect(callOrder).toEqual([
      "transaction-start",
      "read-before",
      "payload-build",
      "update",
      "transaction-end",
    ]);
  });

  it("retries once on a single P2002 and succeeds", async () => {
    let updateCalls = 0;
    const updateImpl = vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<Course> => {
        updateCalls += 1;
        if (updateCalls === 1) {
          throw new FakePrismaError("P2002");
        }
        return { id: where.id, title: "Safety", status: "DRAFT", ...data } as Course;
      },
    );

    const { service, audits } = harnessWithOptions([grant("courses.edit")], {
      archiveData: async () => ({ withdrawnAt: new Date("2026-01-01"), position: -1000001 }),
      updateImpl,
    });

    await expect(service.archive("c1", "Withdrawn")).resolves.toMatchObject({
      position: -1000001,
    });
    expect(updateCalls).toBe(2);
    expect(audits).toHaveLength(1);
  });

  it("throws a typed PositionContentionError after a second consecutive P2002", async () => {
    const updateImpl = vi.fn(async (): Promise<Course> => {
      throw new FakePrismaError("P2002");
    });

    const { service } = harnessWithOptions([grant("courses.edit")], {
      archiveData: async () => ({ withdrawnAt: new Date(), position: -1000001 }),
      updateImpl,
    });

    await expect(service.archive("c1", "Withdrawn")).rejects.toBeInstanceOf(
      PositionContentionError,
    );
    expect(updateImpl).toHaveBeenCalledTimes(2);
  });
});

describe("resource service factory — restore (D-34)", () => {
  it("exposes restore when restoreData is configured, writes the payload and audits restored", async () => {
    const restoreData = vi.fn(async () => ({ withdrawnAt: null, position: 3 }));
    const { service, delegate, audits } = harnessWithOptions([grant("courses.edit")], {
      restoreData,
    });

    const result = await (
      service as unknown as { restore: (id: string, reason: string) => Promise<Course> }
    ).restore("c1", "Bring it back");

    expect(restoreData).toHaveBeenCalledWith("c1");
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 3 }) }),
    );
    expect(audits[0]).toMatchObject({
      action: "course.restored",
      targetId: "c1",
      reason: "Bring it back",
    });
    expect(result).toMatchObject({ position: 3 });
  });

  it("does not expose restore when restoreData is absent", () => {
    const { service } = harnessWithOptions([grant("courses.edit")]);
    expect((service as Record<string, unknown>).restore).toBeUndefined();
  });

  it("denies restore to a caller without edit permission", async () => {
    const restoreData = vi.fn(async () => ({ withdrawnAt: null, position: 0 }));
    const { service, delegate } = harnessWithOptions([grant("courses.view")], { restoreData });
    await expect(
      (
        service as unknown as { restore: (id: string, reason: string) => Promise<Course> }
      ).restore("c1", "Bring it back"),
    ).rejects.toThrow();
    expect(delegate.update).not.toHaveBeenCalled();
  });

  it("denies restore outside the caller's scope", async () => {
    const restoreData = vi.fn(async () => ({ withdrawnAt: null, position: 0 }));
    const { service, delegate } = harnessWithOptions(
      [grant("courses.edit", "COURSE", "c2")],
      { restoreData },
    );
    await expect(
      (
        service as unknown as { restore: (id: string, reason: string) => Promise<Course> }
      ).restore("c1", "Bring it back"),
    ).rejects.toThrow();
    expect(delegate.update).not.toHaveBeenCalled();
  });

  it("wraps restore's read-before, payload build and update inside the injected transaction too", async () => {
    const callOrder: string[] = [];
    const runInTransaction = async <R,>(fn: () => Promise<R>): Promise<R> => {
      callOrder.push("transaction-start");
      const result = await fn();
      callOrder.push("transaction-end");
      return result;
    };
    const restoreData = vi.fn(async () => {
      callOrder.push("payload-build");
      return { withdrawnAt: null, position: 0 };
    });

    const { service, delegate } = harnessWithOptions([grant("courses.edit")], {
      restoreData,
      runInTransaction,
    });

    (delegate.findUnique as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        callOrder.push("read-before");
        return { id: where.id, title: "Safety", status: "DRAFT" };
      },
    );
    (delegate.update as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        callOrder.push("update");
        return { id: where.id, title: "Safety", ...data };
      },
    );

    await (
      service as unknown as { restore: (id: string, reason: string) => Promise<Course> }
    ).restore("c1", "Bring it back");

    expect(callOrder).toEqual([
      "transaction-start",
      "read-before",
      "payload-build",
      "update",
      "transaction-end",
    ]);
  });
});
