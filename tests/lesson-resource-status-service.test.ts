import { describe, expect, it, vi } from "vitest";
import { grant, createTestWithPermission } from "./support/harness";
import {
  createLessonResourceService,
  ResourceRetryNotAllowedError,
  type LessonResourceDelegate,
  type LessonResourceRecord,
} from "@/server/services/lesson-resource-service";

function makeDelegate(initial: Partial<LessonResourceRecord>[]) {
  const rows: LessonResourceRecord[] = initial.map((row, index) => ({
    id: row.id ?? `resource-${index}`,
    lessonId: row.lessonId ?? "lesson-1",
    title: row.title ?? "Resource",
    storageKey: row.storageKey ?? `lessons/lesson-1/${index}`,
    filename: row.filename ?? "resource.pdf",
    mimeType: row.mimeType ?? "application/pdf",
    sizeBytes: row.sizeBytes ?? BigInt(1_024),
    scanStatus: row.scanStatus ?? "PENDING",
    uploadedById: row.uploadedById ?? "staff-1",
    scannedAt: row.scannedAt ?? null,
    scanDetail: row.scanDetail ?? null,
    position: row.position ?? index,
    createdAt: row.createdAt ?? new Date(),
  }));

  const delegate: LessonResourceDelegate = {
    findMany: vi.fn(async ({ where }) => {
      const lessonId = (where as { lessonId?: string } | undefined)?.lessonId;
      return rows.filter((row) => !lessonId || row.lessonId === lessonId);
    }),
    findUnique: vi.fn(async ({ where }) => rows.find((row) => row.id === where.id) ?? null),
    create: vi.fn(async () => {
      throw new Error("not used");
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  return { delegate, rows };
}

const resolveLessonContext = async (lessonId: string) =>
  lessonId === "lesson-1" ? { courseId: "course-1", type: "FILE" } : null;

describe("lesson resource status operations", () => {
  it("lists only one lesson's resources in position order behind courses.view", async () => {
    const { delegate } = makeDelegate([
      { id: "second", lessonId: "lesson-1", position: 2 },
      { id: "other", lessonId: "lesson-2", position: 0 },
      { id: "first", lessonId: "lesson-1", position: 1 },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.view")]);
    const service = createLessonResourceService({
      delegate,
      resolveLessonContext,
      withPermission,
      audit: async () => {},
    });

    await expect(service.listLessonResources("lesson-1")).resolves.toMatchObject([
      { id: "first" },
      { id: "second" },
    ]);
  });

  it("denies listing without courses.view on the parent course", async () => {
    const { delegate } = makeDelegate([{ lessonId: "lesson-1" }]);
    const { withPermission } = createTestWithPermission([]);
    const service = createLessonResourceService({
      delegate,
      resolveLessonContext,
      withPermission,
      audit: async () => {},
    });

    await expect(service.listLessonResources("lesson-1")).rejects.toThrow();
  });

  it("retries only an ERROR row, resetting it to PENDING and auditing the actor", async () => {
    const scannedAt = new Date("2026-09-03T09:00:00Z");
    const { delegate, rows } = makeDelegate([
      {
        id: "resource-error",
        scanStatus: "ERROR",
        scanDetail: "Scanner unavailable",
        scannedAt,
      },
    ]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")], {
      userId: "staff-9",
    });
    const audits: Array<Record<string, unknown>> = [];
    const service = createLessonResourceService({
      delegate,
      resolveLessonContext,
      withPermission,
      audit: async (event) => audits.push(event as Record<string, unknown>),
    });

    await expect(service.retryLessonResource("resource-error")).resolves.toMatchObject({
      scanStatus: "PENDING",
      scanDetail: null,
      scannedAt: null,
    });
    expect(rows[0]).toMatchObject({ scanStatus: "PENDING", scanDetail: null, scannedAt: null });
    expect(audits[0]).toMatchObject({
      action: "lessonresource.scan_retry_requested",
      actorId: "staff-9",
      targetId: "resource-error",
    });
  });

  it.each(["PENDING", "CLEAN", "INFECTED"] as const)(
    "refuses to retry a %s row",
    async (scanStatus) => {
      const { delegate } = makeDelegate([{ id: "resource-1", scanStatus }]);
      const { withPermission } = createTestWithPermission([grant("courses.edit")]);
      const service = createLessonResourceService({
        delegate,
        resolveLessonContext,
        withPermission,
        audit: async () => {},
      });

      await expect(service.retryLessonResource("resource-1")).rejects.toBeInstanceOf(
        ResourceRetryNotAllowedError,
      );
    },
  );
});
