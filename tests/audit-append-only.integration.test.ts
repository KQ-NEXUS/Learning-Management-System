import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import type { createAuditExportService as CreateService } from "@/server/services/audit-export-service";

let database: TestDatabase;
let makeService: typeof CreateService;
let staffId: string;
let roleId: string;

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  ({ createAuditExportService: makeService } = await import("@/server/services/audit-export-service"));
  const staff = await database.prisma.user.create({ data: { email: "audit-export@test.invalid", name: "Auditor", status: "ACTIVE" } });
  staffId = staff.id;
  const role = await database.prisma.role.create({ data: { name: "Audit export test", permissions: ["audit.view"] } });
  roleId = role.id;
  await database.prisma.assignment.create({ data: { userId: staffId, roleId, scopeType: "GLOBAL" } });
}, TEST_DB_TIMEOUT_MS);
afterAll(async () => { await database?.stop(); }, TEST_DB_TIMEOUT_MS);

describe("audit export append-only boundary", () => {
  it("requires both global grants, freezes redacted rows, and leaves source evidence byte-identical", async () => {
    const event = await database.prisma.auditEvent.create({ data: { actorId: staffId, action: "record.updated", targetType: "ORDER", targetId: "order-1", outcome: "SUCCESS", correlationId: "corr-1", before: { status: "OLD", credentials: { secret: "sk_test_private" } }, after: { status: "NEW", storageKey: "hidden" } } });
    const original = JSON.stringify(await database.prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } }));
    const service = makeService({ db: database.prisma, actor: async () => ({ userId: staffId }) });
    const input = { filters: { action: "record.updated" } };
    await expect(service.requestAuditExport(input)).rejects.toThrow();
    await database.prisma.role.update({ where: { id: roleId }, data: { permissions: ["audit.export"] } });
    await expect(service.requestAuditExport(input)).rejects.toThrow();
    await database.prisma.role.update({ where: { id: roleId }, data: { permissions: ["audit.view", "audit.export"] } });
    const result = await service.requestAuditExport(input);
    const job = await database.prisma.exportJob.findUniqueOrThrow({ where: { id: result.jobId }, include: { snapshotRows: true } });
    expect(job.dataset).toBe("audit");
    expect(job.rowCount).toBe(1);
    expect(job.scopeSnapshot).toMatchObject({ kind: "GLOBAL" });
    expect(job.filters).toEqual(input.filters);
    expect(job.snapshotRows[0].data).toMatchObject({ eventId: event.id, action: "record.updated", targetId: "order-1", correlationId: "corr-1", context: "status" });
    expect(JSON.stringify(job.snapshotRows)).not.toContain("sk_test_private");
    expect(JSON.stringify(job.snapshotRows)).not.toContain("hidden");
    expect(JSON.stringify(await database.prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } }))).toBe(original);
  }, TEST_DB_TIMEOUT_MS);
});
