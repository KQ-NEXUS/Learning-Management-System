import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import type { createExportService as CreateService } from "@/server/services/export-service";

let database: TestDatabase;
let createService: typeof CreateService;
let staffId: string;
beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  ({ createExportService: createService } = await import("@/server/services/export-service"));
  const user = await database.prisma.user.create({ data: { email: "export-load@test.invalid", name: "Export Load", status: "ACTIVE" } });
  staffId = user.id;
  const role = await database.prisma.role.create({ data: { name: "Export load role", permissions: ["reports.view", "reports.export"] } });
  await database.prisma.assignment.create({ data: { userId: staffId, roleId: role.id, scopeType: "GLOBAL" } });
}, TEST_DB_TIMEOUT_MS);
afterAll(async () => { await database?.stop(); }, TEST_DB_TIMEOUT_MS);

function service(rows: readonly Readonly<Record<string, string>>[]) {
  return createService({ db: database.prisma, actor: async () => ({ userId: staffId }), producers: { registrations: async () => rows } });
}

describe("bounded PostgreSQL snapshot load", () => {
  it("persists the 25,000-row boundary in the 10-second application budget", async () => {
    const rows = Array.from({ length: 25_000 }, (_, ordinal) => ({ id: `registration-${ordinal}` }));
    const started = performance.now();
    const result = await service(rows).requestExport({ dataset: "registrations" });
    const elapsed = performance.now() - started;
    expect(await database.prisma.exportSnapshotRow.count({ where: { jobId: result.jobId } })).toBe(25_000);
    expect(elapsed).toBeLessThan(10_000);
  }, TEST_DB_TIMEOUT_MS);

  it("accepts a near-25-MiB single-row JSON snapshot within the same budget", async () => {
    const row = { id: "x".repeat(25 * 1024 * 1024 - 128) };
    const started = performance.now();
    const result = await service([row]).requestExport({ dataset: "registrations" });
    const elapsed = performance.now() - started;
    expect((await database.prisma.exportJob.findUniqueOrThrow({ where: { id: result.jobId } })).rowCount).toBe(1);
    expect(elapsed).toBeLessThan(10_000);
  }, TEST_DB_TIMEOUT_MS);
});
