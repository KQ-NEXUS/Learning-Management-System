import { describe, expect, it, vi } from "vitest";
import { createUploadCleanupSystemService } from "@/server/services/upload-cleanup-system-service";

const oldUploading = {
  id: "old-1",
  storageKey: "lesson-uploads/lesson-1/old-1",
  uploadStatus: "UPLOADING" as const,
  createdAt: new Date("2026-09-08T12:00:00Z"),
};
const firstOldUpload = oldUploading;
const secondOldUpload = {
  ...oldUploading,
  id: "old-2",
  storageKey: "lesson-uploads/lesson-1/old-2",
};

describe("cleanupStaleLessonUploadsAsSystem", () => {
  it("removes only stale UPLOADING rows and audits as SYSTEM", async () => {
    const cutoff = new Date("2026-09-09T12:00:00Z");
    const findMany = vi.fn(async () => [oldUploading]);
    const deleteRow = vi.fn(async () => oldUploading);
    const deleteObject = vi.fn(async () => undefined);
    const audit = vi.fn(async () => undefined);
    const cleanup = createUploadCleanupSystemService({
      lessonResource: { findMany, delete: deleteRow },
      deleteObject,
      audit,
    });

    await expect(cleanup(cutoff, 50)).resolves.toEqual({ removed: 1, failed: 0 });
    expect(findMany).toHaveBeenCalledWith({
      where: { uploadStatus: "UPLOADING", createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    expect(deleteObject).toHaveBeenCalledWith(oldUploading.storageKey);
    expect(deleteObject.mock.invocationCallOrder[0]).toBeLessThan(
      deleteRow.mock.invocationCallOrder[0],
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorType: "SYSTEM",
        action: "lessonresource.upload_abandoned",
      }),
    );
  });

  it("ignores recent UPLOADING rows and rows already promoted or failed", async () => {
    const cutoff = new Date("2026-09-09T12:00:00Z");
    const deleteObject = vi.fn(async () => undefined);
    const cleanup = createUploadCleanupSystemService({
      lessonResource: {
        findMany: vi.fn(async () => [
          oldUploading,
          { ...oldUploading, id: "recent", createdAt: new Date("2026-09-10T00:00:00Z") },
          { ...oldUploading, id: "done", uploadStatus: "READY" },
        ]),
        delete: vi.fn(async ({ where }) => ({ id: where.id })),
      },
      deleteObject,
      audit: vi.fn(async () => undefined),
    });

    await expect(cleanup(cutoff, 50)).resolves.toEqual({ removed: 1, failed: 0 });
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(oldUploading.storageKey);
  });

  it("continues after one row fails", async () => {
    const deleteObject = vi
      .fn()
      .mockRejectedValueOnce(new Error("R2 unavailable"))
      .mockResolvedValueOnce(undefined);
    const cleanup = createUploadCleanupSystemService({
      lessonResource: {
        findMany: vi.fn(async () => [firstOldUpload, secondOldUpload]),
        delete: vi.fn(async ({ where }) => ({ id: where.id })),
      },
      deleteObject,
      audit: vi.fn(async () => undefined),
    });

    await expect(cleanup(new Date("2026-09-09T12:00:00Z"), 50)).resolves.toEqual({
      removed: 1,
      failed: 1,
    });
  });
});
