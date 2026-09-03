import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { grant, createTestWithPermission } from "./support/harness";
import {
  createLessonResourceService,
  ResourceInfectedError,
  ResourceNotScannedError,
  type LessonResourceDelegate,
  type LessonResourceRecord,
} from "@/server/services/lesson-resource-service";
import { createScanSystemService } from "@/server/services/scan-system-service";

function makeDelegate(initial: Partial<LessonResourceRecord>[] = []) {
  const rows: LessonResourceRecord[] = initial.map((r, i) => ({
    id: r.id ?? `res${i + 1}`,
    lessonId: r.lessonId ?? "lesson1",
    title: r.title ?? "Handout",
    storageKey: r.storageKey ?? `lessons/lesson1/key-${i}`,
    filename: r.filename ?? "handout.pdf",
    mimeType: r.mimeType ?? "application/pdf",
    sizeBytes: r.sizeBytes ?? BigInt(1024),
    scanStatus: r.scanStatus ?? "PENDING",
    uploadedById: r.uploadedById ?? null,
    scannedAt: r.scannedAt ?? null,
    scanDetail: r.scanDetail ?? null,
    position: r.position ?? 0,
    createdAt: r.createdAt ?? new Date(),
  }));
  let next = rows.length + 1;

  const delegate: LessonResourceDelegate = {
    findMany: vi.fn(async ({ where }) => {
      const w = (where ?? {}) as {
        scanStatus?: string;
        createdAt?: { lt?: Date };
      };
      return rows.filter((r) => {
        if (w.scanStatus && r.scanStatus !== w.scanStatus) return false;
        if (w.createdAt?.lt && !(r.createdAt < w.createdAt.lt)) return false;
        return true;
      });
    }),
    findUnique: vi.fn(async ({ where }) => rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }) => {
      const row = {
        id: `res${next++}`,
        scannedAt: null,
        scanDetail: null,
        position: 0,
        createdAt: new Date(),
        uploadedById: null,
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
  };

  return { delegate, rows: () => rows };
}

const lessonCtx = async (lessonId: string) =>
  lessonId === "lesson1" ? { courseId: "c1", type: "VIDEO" } : null;

describe("lessonResourceScope", () => {
  it("resolves resource -> lesson -> course by query", async () => {
    const { delegate } = makeDelegate([{ id: "res1", lessonId: "lesson1" }]);
    const { withPermission } = createTestWithPermission([]);
    const { lessonResourceScope } = createLessonResourceService({
      delegate,
      resolveLessonContext: lessonCtx,
      withPermission,
      audit: async () => {},
    });
    await expect(lessonResourceScope("res1")).resolves.toEqual({ courseIds: ["c1"] });
  });

  it("yields { courseIds: [] } for an unknown id", async () => {
    const { delegate } = makeDelegate([]);
    const { withPermission } = createTestWithPermission([]);
    const { lessonResourceScope } = createLessonResourceService({
      delegate,
      resolveLessonContext: lessonCtx,
      withPermission,
      audit: async () => {},
    });
    await expect(lessonResourceScope("missing")).resolves.toEqual({ courseIds: [] });
  });
});

describe("createLessonResource", () => {
  it("is denied without courses.edit on the parent course", async () => {
    const { delegate } = makeDelegate([]);
    const { withPermission } = createTestWithPermission([grant("courses.view")]);
    const { createLessonResource } = createLessonResourceService({
      delegate,
      resolveLessonContext: lessonCtx,
      withPermission,
      audit: async () => {},
    });
    await expect(
      createLessonResource({
        lessonId: "lesson1",
        title: "Slides",
        storageKey: "lessons/lesson1/abc",
        filename: "s.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(10),
      }),
    ).rejects.toThrow();
  });

  it("writes scanStatus PENDING, uploadedById from the actor, and the storageKey", async () => {
    const { delegate, rows } = makeDelegate([]);
    const { withPermission } = createTestWithPermission([grant("courses.edit")], {
      userId: "staff-9",
    });
    const audits: unknown[] = [];
    const { createLessonResource } = createLessonResourceService({
      delegate,
      resolveLessonContext: lessonCtx,
      withPermission,
      audit: async (e) => {
        audits.push(e);
      },
    });

    const created = await createLessonResource({
      lessonId: "lesson1",
      title: "Slides",
      storageKey: "lessons/lesson1/xyz",
      filename: "s.pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(20),
    });

    expect(created).toMatchObject({
      scanStatus: "PENDING",
      uploadedById: "staff-9",
      storageKey: "lessons/lesson1/xyz",
    });
    expect(rows()[0].scanStatus).toBe("PENDING");
    expect(audits[0]).toMatchObject({ action: "lessonresource.created" });
  });
});

describe("getDownloadableResource", () => {
  const build = (scanStatus: LessonResourceRecord["scanStatus"], grants = [grant("courses.view")]) => {
    const { delegate } = makeDelegate([{ id: "res1", lessonId: "lesson1", scanStatus }]);
    const { withPermission } = createTestWithPermission(grants);
    return createLessonResourceService({
      delegate,
      resolveLessonContext: lessonCtx,
      withPermission,
      audit: async () => {},
    });
  };

  it("is denied without courses.view", async () => {
    const svc = build("CLEAN", []);
    await expect(svc.getDownloadableResource("res1")).rejects.toThrow();
  });

  it("throws ResourceNotScannedError while PENDING", async () => {
    const svc = build("PENDING");
    await expect(svc.getDownloadableResource("res1")).rejects.toBeInstanceOf(
      ResourceNotScannedError,
    );
  });

  it("throws ResourceInfectedError when INFECTED", async () => {
    const svc = build("INFECTED");
    await expect(svc.getDownloadableResource("res1")).rejects.toBeInstanceOf(
      ResourceInfectedError,
    );
  });

  it("throws ResourceInfectedError when ERROR", async () => {
    const svc = build("ERROR");
    await expect(svc.getDownloadableResource("res1")).rejects.toBeInstanceOf(
      ResourceInfectedError,
    );
  });

  it("returns the row plus the parent lesson type only when CLEAN", async () => {
    const svc = build("CLEAN");
    const row = await svc.getDownloadableResource("res1");
    expect(row).toMatchObject({ id: "res1", scanStatus: "CLEAN", lesson: { type: "VIDEO" } });
  });

  it("distinguishes PENDING and INFECTED with two different error types", async () => {
    const pending = build("PENDING");
    const infected = build("INFECTED");
    const a = await pending.getDownloadableResource("res1").catch((e) => e);
    const b = await infected.getDownloadableResource("res1").catch((e) => e);
    expect(a.name).not.toBe(b.name);
  });
});

describe("scan-system-service — the worker-only, unauthorized path", () => {
  const makeScanDelegate = (initial: Partial<LessonResourceRecord>[] = []) =>
    makeDelegate(initial);

  it("markScanResult writes scanStatus, scannedAt and scanDetail", async () => {
    const { delegate, rows } = makeScanDelegate([{ id: "res1", scanStatus: "PENDING" }]);
    const events: unknown[] = [];
    const svc = createScanSystemService({
      delegate,
      audit: async (e) => {
        events.push(e);
      },
      now: () => new Date("2026-02-01T00:00:00Z"),
    });

    await svc.markScanResult({ id: "res1", status: "CLEAN" });

    const row = rows()[0];
    expect(row.scanStatus).toBe("CLEAN");
    expect(row.scannedAt).toEqual(new Date("2026-02-01T00:00:00Z"));
    expect(row).toHaveProperty("scanDetail");
  });

  it("markScanResult with INFECTED performs an update, not a delete", async () => {
    const { delegate, rows } = makeScanDelegate([{ id: "res1", scanStatus: "PENDING" }]);
    const svc = createScanSystemService({ delegate, audit: async () => {} });

    await svc.markScanResult({ id: "res1", status: "INFECTED", detail: "Eicar-Test-Signature" });

    expect(rows()).toHaveLength(1);
    expect(rows()[0].scanStatus).toBe("INFECTED");
  });

  it("markScanResult writes an audit row with actorId null and actorType SYSTEM, with no actor available", async () => {
    const { delegate } = makeScanDelegate([{ id: "res1", scanStatus: "PENDING" }]);
    const events: Array<Record<string, unknown>> = [];
    const svc = createScanSystemService({
      delegate,
      audit: async (e) => {
        events.push(e as Record<string, unknown>);
      },
    });

    await svc.markScanResult({ id: "res1", status: "CLEAN" });

    expect(events[0]).toMatchObject({ actorId: null, actorType: "SYSTEM" });
  });

  it("findScanTarget returns only the storage key needed by the worker", async () => {
    const { delegate } = makeScanDelegate([
      { id: "res1", storageKey: "lessons/lesson1/object-1" },
    ]);
    const svc = createScanSystemService({ delegate, audit: async () => {} });

    await expect(svc.findScanTarget("res1")).resolves.toEqual({
      storageKey: "lessons/lesson1/object-1",
    });
    await expect(svc.findScanTarget("missing")).resolves.toBeNull();
  });

  it("findStuckPending returns PENDING rows older than the cutoff and excludes recent ones", async () => {
    const old = new Date(Date.now() - 60 * 60_000);
    const recent = new Date();
    const { delegate } = makeScanDelegate([
      { id: "old", scanStatus: "PENDING", createdAt: old },
      { id: "recent", scanStatus: "PENDING", createdAt: recent },
      { id: "clean", scanStatus: "CLEAN", createdAt: old },
    ]);
    const svc = createScanSystemService({ delegate, audit: async () => {} });

    const stuck = await svc.findStuckPending(10);
    expect(stuck.map((r) => r.id)).toEqual(["old"]);
  });
});

describe("import boundaries (T-04-27d)", () => {
  const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), "utf8");

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) yield* walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) yield full;
    }
  }

  it("no file under src/app/** imports scan-system-service", () => {
    const offenders = [...walk(path.resolve(process.cwd(), "src/app"))].filter((f) =>
      readFileSync(f, "utf8").includes("scan-system-service"),
    );
    expect(offenders).toEqual([]);
  });

  it("scan-system-service names neither next/headers, getCurrentActor, nor withPermission anywhere", () => {
    const src = read("src/server/services/scan-system-service.ts");
    expect(src).not.toMatch(/next\/headers/);
    expect(src).not.toMatch(/getCurrentActor/);
    expect(src).not.toMatch(/withPermission/);
    expect(src.match(/AsSystem/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("storage-service and queue never name @/server/permissions or withPermission", () => {
    for (const p of [
      "src/server/services/storage-service.ts",
      "src/server/jobs/queue.ts",
    ]) {
      const src = read(p);
      expect(src).not.toMatch(/@\/server\/permissions/);
      expect(src).not.toMatch(/withPermission/);
      expect(src.toLowerCase()).toContain("worker");
    }
  });
});
