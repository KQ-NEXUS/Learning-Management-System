import { describe, expect, it, vi } from "vitest";
import { createAuditExportProducer, redactedAuditContext } from "@/server/services/audit-export-service";
import { getExportDatasetDefinition } from "@/server/services/report-registry";
import type { TrustedExportProducer } from "@/server/services/export-service";

describe("audit CSV projection", () => {
  it("keeps useful field names while excluding nested secrets, payloads, stacks and all values", () => {
    const context = redactedAuditContext(
      { state: "OLD", nested: { passwordHash: "hash", status: "PENDING", rawPayload: { leaked: "bad" } } },
      { state: "NEW", nested: { status: "DONE", storageKey: "private", stack: "trace" }, token: "secret", sk_test_private: "credential" },
    );
    expect(context).toContain("state");
    expect(context).toContain("nested.status");
    for (const secret of ["OLD", "NEW", "hash", "password", "payload", "storage", "trace", "secret"]) expect(context.toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it("queries only the frozen filtered audit boundary and projects allowlisted columns", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "event-1", createdAt: new Date("2026-09-15T10:00:00Z"), actorType: "USER", action: "record.updated", targetType: "ORDER", targetId: "order-1", outcome: "SUCCESS", correlationId: "corr-1", before: { state: "OLD", token: "leak" }, after: { state: "NEW" }, actor: { name: "Ada", email: "ada@test.invalid" } }]);
    const producer = createAuditExportProducer();
    const input = {
      datasetId: "audit" as const, normalizedFilters: { action: "record.updated", from: "2026-09-01", to: "2026-09-16" },
      authorizedScope: { kind: "GLOBAL" as const, programmeIds: [], courseIds: [], cohortIds: [] },
      selectedColumns: getExportDatasetDefinition("audit").safeColumns,
      asOf: new Date("2026-09-16T09:00:00Z"), tx: { auditEvent: { findMany } } as unknown as Parameters<TrustedExportProducer>[0]["tx"],
    };
    const rows = await producer(input);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ action: "record.updated", createdAt: expect.objectContaining({ lte: input.asOf }) }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25_001,
    }));
    expect(rows[0]).toMatchObject({ eventId: "event-1", action: "record.updated", targetId: "order-1", correlationId: "corr-1", context: "state" });
    expect(JSON.stringify(rows)).not.toContain("leak");
    expect(JSON.stringify(rows)).not.toContain("ada@test.invalid");
  });

  it("refuses a non-global or non-audit producer invocation", async () => {
    const producer = createAuditExportProducer();
    const base = { datasetId: "audit" as const, normalizedFilters: {}, selectedColumns: getExportDatasetDefinition("audit").safeColumns, asOf: new Date(), tx: {} as Parameters<TrustedExportProducer>[0]["tx"] };
    await expect(producer({ ...base, authorizedScope: { kind: "LIMITED", programmeIds: [], courseIds: [], cohortIds: ["one"] } })).rejects.toThrow();
  });
});
