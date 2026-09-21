import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import type { createExportWorkerService as CreateWorker } from "@/server/services/export-worker-service";

let database: TestDatabase;
let createWorker: typeof CreateWorker;
let requesterId: string;
let clock = new Date("2026-09-16T12:00:00.000Z");
const uploads: Array<{ key: string; csv: string }> = [];
const deletions: string[] = [];
let failKey: string | null = null;

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  ({ createExportWorkerService: createWorker } = await import("@/server/services/export-worker-service"));
  const requester = await database.prisma.user.create({ data: { email: "export-worker@test.invalid", name: "Export Worker Requester", status: "ACTIVE" } });
  requesterId = requester.id;
}, TEST_DB_TIMEOUT_MS);
afterAll(async () => { await database?.stop(); }, TEST_DB_TIMEOUT_MS);
beforeEach(async () => {
  await database.prisma.auditEvent.deleteMany({ where: { action: { startsWith: "export." } } });
  await database.prisma.exportJob.deleteMany();
  uploads.length = 0;
  deletions.length = 0;
  failKey = null;
  clock = new Date("2026-09-16T12:00:00.000Z");
});

function worker() {
  return createWorker({
    db: database.prisma,
    now: () => clock,
    upload: async ({ key, body }) => {
      if (key === failKey) throw new Error("provider-secret-should-never-be-shown");
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      uploads.push({ key, csv: Buffer.concat(chunks).toString("utf8") });
    },
    deleteObject: async (key) => { deletions.push(key); },
  });
}

async function queued(reference: string) {
  return database.prisma.exportJob.create({
    data: {
      requestedById: requesterId,
      dataset: "payments",
      datasetVersion: "1.0",
      filters: { provider: "PAYSTACK" },
      asOf: new Date("2026-09-16T09:00:00.000Z"),
      timezone: "Africa/Lagos",
      scopeSnapshot: { kind: "GLOBAL", programmeIds: [], courseIds: [], cohortIds: [] },
      columnSnapshot: [{ key: "reference", label: "Reference", valueType: "TEXT" }],
      rowCount: 1,
      status: "QUEUED",
      snapshotRows: { create: [{ ordinal: 0, data: { reference } }] },
    },
  });
}

describe("immutable export worker", () => {
  it("uses SKIP LOCKED claims so two consumers receive disjoint oldest jobs", async () => {
    const first = await queued("FIRST");
    const second = await queued("SECOND");
    const [a, b] = await Promise.all([worker().claimQueued(1), worker().claimQueued(1)]);
    expect(new Set([...a, ...b])).toEqual(new Set([first.id, second.id]));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("streams only frozen rows and writes one terminal state and audit under replay", async () => {
    const job = await queued("FROZEN-PAYMENT");
    expect(await worker().processBatch(1)).toEqual({ processed: 1, failed: 0 });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].key).toContain(job.id);
    expect(uploads[0].csv).toContain("FROZEN-PAYMENT");
    expect(uploads[0].csv).toContain("PAYSTACK");
    expect(await worker().processBatch(1)).toEqual({ processed: 0, failed: 0 });
    expect(uploads).toHaveLength(1);
    const saved = await database.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved.status).toBe("SUCCEEDED");
    expect(saved.expiresAt?.getTime()).toBe(saved.completedAt!.getTime() + 24 * 60 * 60 * 1000);
    expect(await database.prisma.auditEvent.count({ where: { targetId: job.id, action: "export.succeeded" } })).toBe(1);
  });

  it("isolates one failed item and stores only a safe error", async () => {
    const first = await queued("FAIL");
    const second = await queued("PASS");
    failKey = `exports/${first.id}/1.0.csv`;
    expect(await worker().processBatch(2)).toEqual({ processed: 1, failed: 1 });
    expect((await database.prisma.exportJob.findUniqueOrThrow({ where: { id: first.id } })).errorMessage).not.toContain("provider-secret");
    expect((await database.prisma.exportJob.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("SUCCEEDED");
  });

  it("recovers a stale claim while preserving its first generation timestamp", async () => {
    const job = await queued("STALE");
    const firstStart = new Date("2026-09-15T09:00:00.000Z");
    await database.prisma.exportJob.update({ where: { id: job.id }, data: { status: "PROCESSING", startedAt: firstStart } });
    expect(await worker().recoverStale()).toBe(1);
    expect(await worker().processBatch(1)).toEqual({ processed: 1, failed: 0 });
    expect((await database.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })).startedAt).toEqual(firstStart);
  });

  it("expires the private object once and keeps history and frozen rows", async () => {
    const job = await queued("KEEP-HISTORY");
    await worker().processBatch(1);
    clock = new Date("2026-09-18T12:00:00.000Z");
    expect(await worker().expireBatch(1)).toBe(1);
    expect(await worker().expireBatch(1)).toBe(0);
    expect(deletions).toHaveLength(1);
    const saved = await database.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id }, include: { snapshotRows: true } });
    expect(saved.status).toBe("EXPIRED");
    expect(saved.storageKey).toBeNull();
    expect(saved.snapshotRows).toHaveLength(1);
    expect(await database.prisma.auditEvent.count({ where: { targetId: job.id, action: "export.expired" } })).toBe(1);
  });
});
