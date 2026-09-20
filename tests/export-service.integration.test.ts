import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import type { createExportService as CreateService } from "@/server/services/export-service";
import { seedCohortFixture, seedLearnerFixture } from "./support/cohort-fixtures";
import { serializeCsv } from "@/server/services/csv-service";
import { getExportDatasetDefinition } from "@/server/services/report-registry";

let database: TestDatabase;
let makeService: typeof CreateService;
let staffId: string;
let roleId: string;
let sequence = 0;
const NOW = new Date("2026-09-16T09:00:00.000Z");
const nextKey = () => `export-test-${++sequence}`;

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  ({ createExportService: makeService } = await import("@/server/services/export-service"));
  const staff = await database.prisma.user.create({ data: { email: "export-staff@test.invalid", name: "Export Staff", status: "ACTIVE" } });
  staffId = staff.id;
  const role = await database.prisma.role.create({ data: { name: "Export test role", permissions: ["reports.view", "reports.export", "payments.view"] } });
  roleId = role.id;
  await database.prisma.assignment.create({ data: { userId: staffId, roleId, scopeType: "GLOBAL" } });
}, TEST_DB_TIMEOUT_MS);
afterAll(async () => { await database?.stop(); }, TEST_DB_TIMEOUT_MS);

function service(producer: Parameters<typeof makeService>[0]["producers"]) {
  return makeService({ db: database.prisma, actor: async () => ({ userId: staffId }), now: () => NOW, producers: producer });
}

describe("immutable export transaction", () => {
  it("freezes projected rows, metadata, scope and audit; replay converges", async () => {
    let source = [{ id: "source-1", registeredAt: NOW.toISOString(), status: "ACTIVE" }];
    const exportService = service({ registrations: async (input) => {
      expect(input.datasetId).toBe("registrations");
      expect(input.authorizedScope.kind).toBe("GLOBAL");
      expect(input.asOf).toEqual(NOW);
      expect(input.normalizedFilters).toEqual({ from: "2026-09-01" });
      return source;
    } });
    const input = { dataset: "registrations", filters: { from: "2026-09-01" }, asOf: NOW.toISOString(), idempotencyKey: nextKey() };
    const first = await exportService.requestExport(input);
    source = [{ id: "changed", registeredAt: NOW.toISOString(), status: "CANCELLED" }];
    const second = await exportService.requestExport(input);
    expect(second.jobId).toBe(first.jobId);
    const job = await database.prisma.exportJob.findUniqueOrThrow({ where: { id: first.jobId }, include: { snapshotRows: true } });
    expect(job.status).toBe("QUEUED");
    expect(job.rowCount).toBe(1);
    expect(job.datasetVersion).toBe("1.0");
    expect(job.timezone).toBe("Africa/Lagos");
    expect(job.filters).toEqual({ from: "2026-09-01" });
    expect(job.snapshotRows[0].data).toEqual({ id: "source-1", registeredAt: NOW.toISOString(), status: "ACTIVE" });
    expect(await database.prisma.auditEvent.count({ where: { targetId: first.jobId, action: "export.requested" } })).toBe(1);
  });

  it("rolls back row and byte overflows before job or audit creation", async () => {
    const beforeJobs = await database.prisma.exportJob.count();
    const beforeAudit = await database.prisma.auditEvent.count();
    const tooMany = service({ registrations: async () => Array.from({ length: 25_001 }, (_, id) => ({ id: String(id) })) });
    await expect(tooMany.requestExport({ dataset: "registrations" })).rejects.toThrow("Too many export rows");
    const tooLarge = service({ registrations: async () => [{ id: "x".repeat(25 * 1024 * 1024 + 1) }] });
    await expect(tooLarge.requestExport({ dataset: "registrations" })).rejects.toThrow("too large");
    expect(await database.prisma.exportJob.count()).toBe(beforeJobs);
    expect(await database.prisma.auditEvent.count()).toBe(beforeAudit);
  });

  it("converges concurrent requests using the same idempotency key", async () => {
    const exportService = service({ registrations: async () => [{ id: "race" }] });
    const input = { dataset: "registrations", idempotencyKey: nextKey() };
    const [first, second] = await Promise.all([exportService.requestExport(input), exportService.requestExport(input)]);
    expect(first.jobId).toBe(second.jobId);
    expect(await database.prisma.exportJob.count({ where: { id: first.jobId } })).toBe(1);
  });

  it("records a genuine zero-row export instead of a missing count", async () => {
    const exportService = service({ registrations: async () => [] });
    const result = await exportService.requestExport({ dataset: "registrations" });
    const job = await database.prisma.exportJob.findUniqueOrThrow({ where: { id: result.jobId } });
    expect(job.rowCount).toBe(0);
    expect(await database.prisma.exportSnapshotRow.count({ where: { jobId: job.id } })).toBe(0);
  });

  it("requires matching-scope identity permission and reason for sensitive fields", async () => {
    const producer = async () => [{ id: "one", learnerName: "Learner" }];
    const exportService = service({ registrations: producer });
    const selected = { dataset: "registrations", columns: ["id", "learnerName"], reason: "Operational reconciliation" };
    await expect(exportService.requestExport(selected)).rejects.toThrow();
    await database.prisma.role.update({ where: { id: roleId }, data: { permissions: ["reports.view", "reports.export", "payments.view", "users.view"] } });
    await expect(exportService.requestExport({ ...selected, reason: " " })).rejects.toThrow("reason");
    const result = await exportService.requestExport(selected);
    expect((await database.prisma.exportJob.findUniqueOrThrow({ where: { id: result.jobId } })).sensitiveReason).toBe("Operational reconciliation");
    expect((await database.prisma.auditEvent.findFirstOrThrow({ where: { targetId: result.jobId } })).reason).toBe("Operational reconciliation");
  });

  it("rejects a narrower users.view grant than the report scope", async () => {
    const { cohortId } = await seedCohortFixture(database.prisma);
    const staff = await database.prisma.user.create({ data: { email: "export-limited@test.invalid", name: "Limited", status: "ACTIVE" } });
    const reportRole = await database.prisma.role.create({ data: { name: "Limited test report role", permissions: ["reports.view", "reports.export"] } });
    const identityRole = await database.prisma.role.create({ data: { name: "Limited identity role", permissions: ["users.view"] } });
    await database.prisma.assignment.createMany({ data: [
      { userId: staff.id, roleId: reportRole.id, scopeType: "GLOBAL" },
      { userId: staff.id, roleId: identityRole.id, scopeType: "COHORT", scopeId: cohortId },
    ] });
    const exportService = makeService({ db: database.prisma, actor: async () => ({ userId: staff.id }), producers: { registrations: async () => [{ id: "safe" }] }, now: () => NOW });
    await expect(exportService.requestExport({ dataset: "registrations", columns: ["id", "learnerName"], reason: "Case review" })).rejects.toThrow();
  });

  it("keeps failed source and frozen rows on linked retry; expired rerun gets current rows", async () => {
    let current = "first";
    const exportService = service({ registrations: async () => [{ id: current }] });
    const first = await exportService.requestExport({ dataset: "registrations" });
    await database.prisma.exportJob.update({ where: { id: first.jobId }, data: { status: "FAILED", errorCode: "STORAGE_UNAVAILABLE", errorMessage: "Temporary storage problem" } });
    current = "second";
    const retry = await exportService.retryExport(first.jobId);
    expect(retry.jobId).not.toBe(first.jobId);
    const linked = await database.prisma.exportJob.findUniqueOrThrow({ where: { id: retry.jobId }, include: { snapshotRows: true } });
    expect(linked.retryOfId).toBe(first.jobId);
    expect(linked.snapshotRows[0].data).toEqual({ id: "first" });
    expect((await database.prisma.exportJob.findUniqueOrThrow({ where: { id: first.jobId } })).errorCode).toBe("STORAGE_UNAVAILABLE");
    await database.prisma.exportJob.update({ where: { id: first.jobId }, data: { status: "EXPIRED" } });
    const rerun = await exportService.rerunExpiredExport(first.jobId);
    expect(rerun.jobId).not.toBe(first.jobId);
    expect((await database.prisma.exportSnapshotRow.findFirstOrThrow({ where: { jobId: rerun.jobId } })).data).toEqual({ id: "second" });
  });

  it("rejects stale/tampered as-of and forged scope or row fields", async () => {
    const exportService = service({ registrations: async () => [{ id: "safe" }] });
    await expect(exportService.requestExport({ dataset: "registrations", asOf: "2026-09-01T00:00:00.000Z" })).rejects.toThrow("Refresh");
    await expect(exportService.requestExport({ dataset: "registrations", filters: { scope: { kind: "GLOBAL" } } })).rejects.toThrow("filters");
    await expect(exportService.requestExport({ dataset: "registrations", filters: { rows: [{ id: "forged" }] } })).rejects.toThrow("filters");
  });

  it("exports exact scoped Stripe, Paystack and Manual refund rows with matching CSV", async () => {
    const { cohortId } = await seedCohortFixture(database.prisma);
    const { userId } = await seedLearnerFixture(database.prisma);
    const providers = ["STRIPE", "PAYSTACK", "MANUAL"] as const;
    const refunds = [];
    for (const provider of providers) {
      const order = await database.prisma.order.create({ data: { reference: `EXPORT-${provider}`, userId, cohortId, amountMinor: 100_000, currency: "NGN", status: "PAID", selectedProvider: provider, idempotencyKey: `export-order-${provider}` } });
      const attempt = await database.prisma.paymentAttempt.create({ data: { orderId: order.id, provider, amountMinor: 100_000, currency: "NGN", status: "SUCCEEDED", idempotencyKey: `export-attempt-${provider}`, confirmedAt: new Date("2026-09-15T09:00:00Z") } });
      refunds.push(await database.prisma.refund.create({ data: { orderId: order.id, paymentAttemptId: attempt.id, provider, amountMinor: 12_345, currency: "NGN", reason: "Test refund", accessDecision: "RETAIN_ACCESS", status: "COMPLETED", createdAt: new Date("2026-09-15T10:00:00Z") } }));
    }
    const exportService = service({}); // built-in trusted report-query-service producer
    for (const [index, provider] of providers.entries()) {
      const job = await exportService.requestExport({ dataset: "reconciliation-refunds", filters: { provider } });
      const stored = await database.prisma.exportJob.findUniqueOrThrow({ where: { id: job.jobId }, include: { snapshotRows: true } });
      expect(stored.rowCount).toBe(1);
      expect(stored.snapshotRows[0].data).toMatchObject({ reference: `EXPORT-${provider}`, amountMinor: refunds[index].amountMinor, currency: "NGN" });
      const columns = getExportDatasetDefinition("reconciliation-refunds").safeColumns;
      const csv = await serializeCsv({ dataset: stored.dataset, version: stored.datasetVersion, filters: stored.filters as Record<string, unknown>, generatedAt: NOW, asOf: stored.asOf, timezone: stored.timezone }, columns, stored.snapshotRows.map((row) => row.data as Record<string, string | number | null>));
      expect(csv).toContain("Reference,Occurred,Amount,Currency");
      expect(csv).toContain(`EXPORT-${provider},2026-09-15T10:00:00.000Z,12345,NGN`);
      expect(csv).toContain(provider);
    }
    await database.prisma.refund.update({ where: { id: refunds[0].id }, data: { amountMinor: 99_999 } });
    const frozen = await database.prisma.exportSnapshotRow.findFirstOrThrow({ where: { data: { path: ["reference"], equals: "EXPORT-STRIPE" } } });
    expect(frozen.data).toMatchObject({ amountMinor: 12_345 });
  });
});
