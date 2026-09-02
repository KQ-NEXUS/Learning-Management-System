import { describe, expect, it, vi } from "vitest";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import { createResourceService, type Delegate } from "@/server/services/resource-service";

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
