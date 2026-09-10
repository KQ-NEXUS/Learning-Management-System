import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { grant, createTestWithPermission } from "./support/harness";
import type { RawGrant } from "@/server/permissions/with-permission";
import {
  createLessonResourceService,
  ResourceUploadPendingError,
  ResourceUploadUnavailableError,
  ResourceUploadValidationError,
  type LessonResourceDelegate,
  type LessonResourceRecord,
} from "@/server/services/lesson-resource-service";

function makeDelegate(initial: Partial<LessonResourceRecord>[] = []) {
  const rows: LessonResourceRecord[] = initial.map((r, i) => ({
    id: r.id ?? `res${i + 1}`,
    lessonId: r.lessonId ?? "lesson1",
    title: r.title ?? "Handout",
    storageKey: r.storageKey ?? "lesson-uploads/lesson1/opaque",
    filename: r.filename ?? "handout.pdf",
    mimeType: r.mimeType ?? "application/pdf",
    sizeBytes: r.sizeBytes ?? 2000n,
    uploadStatus: r.uploadStatus ?? "UPLOADING",
    uploadedById: r.uploadedById ?? null,
    uploadedAt: r.uploadedAt ?? null,
    uploadDetail: r.uploadDetail ?? null,
    position: r.position ?? i,
    createdAt: r.createdAt ?? new Date(),
  }));
  let next = rows.length + 1;

  const delegate: LessonResourceDelegate = {
    findMany: vi.fn(async ({ where }) => {
      const w = (where ?? {}) as {
        lessonId?: string;
        uploadStatus?: string;
        createdAt?: { lt?: Date };
      };
      return rows.filter((r) => {
        if (w.lessonId && r.lessonId !== w.lessonId) return false;
        if (w.uploadStatus && r.uploadStatus !== w.uploadStatus) return false;
        if (w.createdAt?.lt && !(r.createdAt < w.createdAt.lt)) return false;
        return true;
      });
    }),
    findUnique: vi.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }) => {
      const row = {
        id: `res${next++}`,
        uploadedById: null,
        uploadedAt: null,
        uploadDetail: null,
        position: rows.length,
        createdAt: new Date(),
        ...(data as Partial<LessonResourceRecord>),
      } as LessonResourceRecord;
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    delete: vi.fn(async ({ where }) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx === -1) throw new Error("not found");
      const [removed] = rows.splice(idx, 1);
      return removed;
    }),
  };

  return { delegate, rows };
}

const lessonCtx = async (lessonId: string) =>
  lessonId === "lesson1" ? { courseId: "c1", type: "VIDEO" } : null;

function buildService(initial: Partial<LessonResourceRecord>[], grants: RawGrant[]) {
  const { delegate, rows } = makeDelegate(initial);
  const { withPermission } = createTestWithPermission(grants, { userId: "staff-1" });
  const audits: Array<Record<string, unknown>> = [];
  const storage = {
    inspect: vi.fn(async () => ({ sizeBytes: 2000n, contentType: "application/pdf" as string | null })),
    promote: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    finalKey: (key: string) => key.replace(/^lesson-uploads\//, "lessons/"),
  };
  const service = createLessonResourceService({
    delegate,
    resolveLessonContext: lessonCtx,
    withPermission,
    audit: async (entry) => {
      audits.push(entry as Record<string, unknown>);
    },
    storage,
    now: () => new Date("2026-09-10T12:00:00Z"),
  });
  return { service, rows, storage, audits };
}

describe("lessonResourceScope", () => {
  it("resolves resource -> lesson -> course by query", async () => {
    const { service } = buildService([{ id: "res1", lessonId: "lesson1" }], []);
    await expect(service.lessonResourceScope("res1")).resolves.toEqual({ courseIds: ["c1"] });
  });

  it("yields { courseIds: [] } for an unknown id", async () => {
    const { service } = buildService([], []);
    await expect(service.lessonResourceScope("missing")).resolves.toEqual({ courseIds: [] });
  });
});

describe("beginLessonResourceUpload", () => {
  it("creates an UPLOADING row owned by the authorized actor", async () => {
    const { service, rows, audits } = buildService([], [grant("courses.edit")]);
    await service.beginLessonResourceUpload({
      lessonId: "lesson1",
      title: "Slides",
      storageKey: "lesson-uploads/lesson1/opaque",
      filename: "slides.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2000n,
    });
    expect(rows[0]).toMatchObject({
      uploadStatus: "UPLOADING",
      storageKey: "lesson-uploads/lesson1/opaque",
      uploadedById: "staff-1",
    });
    expect(audits[0]).toMatchObject({ action: "lessonresource.upload_started" });
  });

  it("denies begin without courses.edit on the parent course", async () => {
    const { service } = buildService([], [grant("courses.view")]);
    await expect(
      service.beginLessonResourceUpload({
        lessonId: "lesson1",
        title: "Slides",
        storageKey: "lesson-uploads/lesson1/opaque",
        filename: "slides.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2000n,
      }),
    ).rejects.toThrow();
  });
});

describe("completeLessonResourceUpload", () => {
  const staged = {
    id: "res1",
    uploadStatus: "UPLOADING" as const,
    storageKey: "lesson-uploads/lesson1/opaque",
    mimeType: "application/pdf",
    sizeBytes: 2000n,
  };

  it("promotes matching stored metadata and marks the row READY", async () => {
    const { service, rows, storage } = buildService([staged], [grant("courses.edit")]);
    const completed = await service.completeLessonResourceUpload("res1");
    expect(storage.inspect).toHaveBeenCalledWith("lesson-uploads/lesson1/opaque");
    expect(storage.promote).toHaveBeenCalledWith({
      stagedKey: "lesson-uploads/lesson1/opaque",
      finalKey: "lessons/lesson1/opaque",
    });
    expect(completed).toMatchObject({
      storageKey: "lessons/lesson1/opaque",
      uploadStatus: "READY",
      uploadDetail: null,
    });
    expect(rows[0].uploadedAt).toBeInstanceOf(Date);
    expect(storage.delete).toHaveBeenCalledWith("lesson-uploads/lesson1/opaque");
  });

  it("treats completing an already READY row as idempotent", async () => {
    const { service, storage } = buildService(
      [{ id: "res1", uploadStatus: "READY" }],
      [grant("courses.edit")],
    );
    await expect(service.completeLessonResourceUpload("res1")).resolves.toMatchObject({
      uploadStatus: "READY",
    });
    expect(storage.inspect).not.toHaveBeenCalled();
    expect(storage.promote).not.toHaveBeenCalled();
  });

  it.each([
    ["byte-count", { sizeBytes: 1999n, contentType: "application/pdf" as string | null }],
    ["content-type", { sizeBytes: 2000n, contentType: "text/plain" as string | null }],
  ] as const)("marks ERROR on a %s metadata mismatch", async (_kind, stored) => {
    const { service, rows, storage } = buildService([staged], [grant("courses.edit")]);
    storage.inspect.mockResolvedValueOnce(stored);
    await expect(service.completeLessonResourceUpload("res1")).rejects.toBeInstanceOf(
      ResourceUploadValidationError,
    );
    expect(storage.delete).toHaveBeenCalledWith("lesson-uploads/lesson1/opaque");
    expect(rows[0]).toMatchObject({ uploadStatus: "ERROR", uploadedAt: null });
  });

  it("marks ERROR when the object cannot be inspected at all", async () => {
    const { service, rows, storage } = buildService([staged], [grant("courses.edit")]);
    storage.inspect.mockRejectedValueOnce(new Error("no such key"));
    const error = await service.completeLessonResourceUpload("res1").catch((e) => e);
    expect(error).toBeInstanceOf(ResourceUploadValidationError);
    expect(error.resource).toMatchObject({ uploadStatus: "ERROR" });
    expect(rows[0].uploadStatus).toBe("ERROR");
    expect(storage.delete).toHaveBeenCalledWith("lesson-uploads/lesson1/opaque");
  });

  it("denies completion through the resource-to-course scope", async () => {
    const { service, storage } = buildService([{ id: "res1", uploadStatus: "UPLOADING" }], []);
    await expect(service.completeLessonResourceUpload("res1")).rejects.toThrow();
    expect(storage.inspect).not.toHaveBeenCalled();
  });
});

describe("getDownloadableResource", () => {
  it("is denied without courses.view", async () => {
    const { service } = buildService([{ id: "res1", uploadStatus: "READY" }], []);
    await expect(service.getDownloadableResource("res1")).rejects.toThrow();
  });

  it.each(["UPLOADING", "ERROR"] as const)("does not download a %s resource", async (uploadStatus) => {
    const { service } = buildService([{ id: "res1", uploadStatus }], [grant("courses.view")]);
    await expect(service.getDownloadableResource("res1")).rejects.toThrow();
  });

  it("throws ResourceUploadPendingError while UPLOADING and Unavailable when ERROR", async () => {
    const pending = buildService([{ id: "res1", uploadStatus: "UPLOADING" }], [grant("courses.view")]);
    const errored = buildService([{ id: "res1", uploadStatus: "ERROR" }], [grant("courses.view")]);
    await expect(pending.service.getDownloadableResource("res1")).rejects.toBeInstanceOf(
      ResourceUploadPendingError,
    );
    await expect(errored.service.getDownloadableResource("res1")).rejects.toBeInstanceOf(
      ResourceUploadUnavailableError,
    );
  });

  it("downloads a READY resource with its parent lesson type", async () => {
    const { service } = buildService([{ id: "res1", uploadStatus: "READY" }], [grant("courses.view")]);
    await expect(service.getDownloadableResource("res1")).resolves.toMatchObject({
      id: "res1",
      uploadStatus: "READY",
      lesson: { type: "VIDEO" },
    });
  });
});

describe("listLessonResources", () => {
  it("lists only one lesson's resources in position order behind courses.view", async () => {
    const { service } = buildService(
      [
        { id: "second", lessonId: "lesson1", position: 2 },
        { id: "other", lessonId: "lesson2", position: 0 },
        { id: "first", lessonId: "lesson1", position: 1 },
      ],
      [grant("courses.view")],
    );
    await expect(service.listLessonResources("lesson1")).resolves.toMatchObject([
      { id: "first" },
      { id: "second" },
    ]);
  });

  it("denies listing without courses.view on the parent course", async () => {
    const { service } = buildService([{ id: "res1", lessonId: "lesson1" }], []);
    await expect(service.listLessonResources("lesson1")).rejects.toThrow();
  });
});

describe("removeLessonResource", () => {
  it("removes an authorized resource from storage and the database", async () => {
    const { service, rows, storage, audits } = buildService(
      [{ id: "res1", uploadStatus: "ERROR" }],
      [grant("courses.edit")],
    );
    await service.removeLessonResource("res1");
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(0);
    expect(audits[0]).toMatchObject({ action: "lessonresource.removed" });
  });

  it("is denied without courses.edit on the parent course", async () => {
    const { service, rows } = buildService(
      [{ id: "res1", uploadStatus: "ERROR" }],
      [grant("courses.view")],
    );
    await expect(service.removeLessonResource("res1")).rejects.toThrow();
    expect(rows).toHaveLength(1);
  });
});

describe("import boundaries (T-04-27d)", () => {
  const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), "utf8");

  it("storage-service never names @/server/permissions or withPermission", () => {
    const src = read("src/server/services/storage-service.ts");
    expect(src).not.toMatch(/@\/server\/permissions/);
    expect(src).not.toMatch(/withPermission/);
  });
});
