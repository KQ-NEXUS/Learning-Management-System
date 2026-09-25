import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/server/permissions";
import type { CollectionAuthorization } from "@/server/permissions/collection-scope";
import {
  createReportQueryService,
  type ReportQueryStore,
  type SupportTicketRecord,
} from "@/server/services/report-query-service";
import { getExportDatasetDefinition, getReportDefinition } from "@/server/services/report-registry";

const ASOF = new Date("2026-09-30T12:00:00.000Z");
const hours = (h: number) => new Date(ASOF.getTime() - h * 3_600_000);

function ticket(id: string, overrides: Partial<SupportTicketRecord> = {}): SupportTicketRecord {
  return {
    id, reference: `TKT-${id}`, category: "OTHER", priority: "NORMAL", status: "OPEN", queue: "GENERAL_SUPPORT",
    assigneeId: null, cohortId: null, courseId: null, orderId: null, submissionId: null, certificateId: null,
    createdAt: hours(2), firstRespondedAt: null, resolvedAt: null, closedAt: null, assignee: null, events: [],
    ...overrides,
  };
}

function auth(kind: "GLOBAL" | "LIMITED", tickets: "GLOBAL" | "LIMITED" = "GLOBAL") {
  return vi.fn(async (permission: string): Promise<CollectionAuthorization> => {
    const scopeKind = permission === "tickets.view" ? tickets : kind;
    return {
      actor: { userId: "staff" }, permission,
      scope: { kind: scopeKind, programmeIds: [], courseIds: [], cohortIds: [] },
      cohortWhere: {},
    } as unknown as CollectionAuthorization;
  });
}

function build(records: SupportTicketRecord[], authorize = auth("GLOBAL")) {
  const findMany = vi.fn(async (args: Record<string, unknown>) => { void args; return records; });
  const service = createReportQueryService({
    store: { ticket: { findMany } } as unknown as ReportQueryStore,
    authorizeCollection: authorize as never,
    now: () => ASOF,
  });
  return { service, findMany };
}

async function support(records: SupportTicketRecord[], filters: Record<string, unknown> = {}) {
  const report = await build(records).service.getDatasetReport("support", filters);
  if (!report.available) throw new Error("support must be available");
  return report;
}

const metric = (report: Awaited<ReturnType<typeof support>>, id: string) => report.metrics.find((item) => item.id === id)!;

describe("support report registry", () => {
  it("is AVAILABLE with no unavailable reason and metadata-only columns", () => {
    const definition = getReportDefinition("support");
    expect(definition.availability).toBe("AVAILABLE");
    expect(definition.unavailableReason).toBeUndefined();
    const keys = [...definition.safeColumns, ...definition.sensitiveColumns].map((column) => column.key);
    expect(keys.filter((key) => /body|note|message|filename|storage|attachment|url/i.test(key))).toEqual([]);
    expect(definition.sensitiveColumns.map((column) => column.key)).toEqual(["learnerName", "learnerEmail"]);
    expect(getExportDatasetDefinition("support").safeColumns).toBe(definition.safeColumns);
  });

  it("normalizes support filters and rejects foreign or malformed ones", () => {
    const schema = getReportDefinition("support").filterSchema;
    expect(schema.safeParse({ category: "CERTIFICATE", priority: "URGENT", queue: "FINANCE", owner: "UNASSIGNED", from: "2026-09-01" }).success).toBe(true);
    expect(schema.safeParse({ category: "NOPE" }).success).toBe(false);
    expect(schema.safeParse({ programmeId: "p" }).success).toBe(false);
  });
});

describe("support report projection", () => {
  it("rejects filters that are not support filters", async () => {
    await expect(build([]).service.getDatasetReport("support", { programmeId: "p" })).rejects.toThrow(/Report filters are invalid/);
    await expect(build([]).service.getDatasetReport("support", { status: "BOGUS" })).rejects.toThrow(/Report filters are invalid/);
  });

  it("defaults performance to exactly asOf minus 30 days through asOf", async () => {
    const { service, findMany } = build([]);
    await service.getDatasetReport("support");
    const where = findMany.mock.calls[0][0].where as { AND: Array<{ OR?: Array<Record<string, { gte?: Date; lte?: Date }>> }> };
    const window = where.AND[1].OR![0].createdAt;
    expect(window.gte).toEqual(new Date(ASOF.getTime() - 30 * 86_400_000));
    expect(window.lte).toEqual(ASOF);
  });

  it("never selects message or attachment relations", async () => {
    const { service, findMany } = build([]);
    await service.getDatasetReport("support");
    const serialized = JSON.stringify(findMany.mock.calls[0][0]);
    expect(serialized).not.toMatch(/messages|attachments|body|storageKey|filename|reason/);
  });

  it("requires tickets.view GLOBAL in addition to reports.view", async () => {
    const limitedTickets = build([], auth("GLOBAL", "LIMITED"));
    await expect(limitedTickets.service.getDatasetReport("support")).rejects.toBeInstanceOf(AuthorizationError);
    expect(limitedTickets.findMany).not.toHaveBeenCalled();
    const limitedReports = build([], auth("LIMITED", "GLOBAL"));
    await expect(limitedReports.service.getDatasetReport("support")).resolves.toMatchObject({ available: true });
  });

  it("puts every open ticket in exactly one age band", async () => {
    const records = [
      ticket("a", { createdAt: hours(1) }), ticket("b", { createdAt: hours(23.9) }), ticket("c", { createdAt: hours(24) }),
      ticket("d", { createdAt: hours(24 * 4 - 0.1) }), ticket("e", { createdAt: hours(24 * 4) }),
      ticket("f", { createdAt: hours(24 * 8 - 0.1) }), ticket("g", { createdAt: hours(24 * 8) }), ticket("h", { createdAt: hours(24 * 40) }),
      ticket("closed", { status: "CLOSED", createdAt: hours(24 * 9) }),
    ];
    const report = await support(records);
    const bands = report.breakdown.filter((item) => item.group === "Backlog age").map((item) => item.value);
    expect(bands).toEqual([2, 2, 2, 2]);
    expect(bands.reduce((a, b) => a + b, 0)).toBe(metric(report, "open").value);
    expect(metric(report, "open").value).toBe(8);
  });

  it("computes health counts, medians (even, odd, empty), reopen rate and escalation durations", async () => {
    const created = hours(10);
    const records = [
      ticket("1", { priority: "URGENT", status: "ESCALATED", createdAt: created, firstRespondedAt: new Date(created.getTime() + 10 * 60_000), assigneeId: "u1", assignee: { id: "u1", name: "Staff One" },
        events: [{ type: "ESCALATED", createdAt: hours(9) }, { type: "ESCALATION_ACCEPTED", createdAt: new Date(hours(9).getTime() + 30 * 60_000) }] }),
      ticket("2", { status: "RESOLVED", createdAt: created, firstRespondedAt: new Date(created.getTime() + 30 * 60_000), resolvedAt: new Date(created.getTime() + 120 * 60_000),
        events: [{ type: "REOPENED", createdAt: hours(5) }] }),
      ticket("3", { status: "RESOLVED", createdAt: created, resolvedAt: new Date(created.getTime() + 240 * 60_000) }),
    ];
    const report = await support(records);
    expect(metric(report, "open").value).toBe(1);
    expect(metric(report, "unassigned").value).toBe(0);
    expect(metric(report, "urgent").value).toBe(1);
    expect(metric(report, "escalated").value).toBe(1);
    expect(metric(report, "created").value).toBe(3);
    expect(metric(report, "resolved").value).toBe(2);
    expect(metric(report, "first-response").value).toBe(20);
    expect(metric(report, "resolution").value).toBe(180);
    expect(metric(report, "reopen-rate").value).toBe(50);
    expect(metric(report, "escalations").value).toBe(1);
    expect(metric(report, "escalation-acceptance").value).toBe(30);
    expect(report.options.owners).toEqual([{ id: "u1", label: "Staff One" }]);
    const empty = await support([]);
    expect(metric(empty, "first-response").value).toBeNull();
    expect(metric(empty, "reopen-rate").value).toBeNull();
    expect(metric(empty, "open").value).toBe(0);
  });

  it("rows contain no private-content property and export rows equal dashboard rows before pagination", async () => {
    const records = Array.from({ length: 30 }, (_, index) => ticket(String(index).padStart(2, "0"), { createdAt: hours(30 - index), orderId: index === 0 ? "order-1" : null }));
    const { service } = build(records);
    const page = await service.getDatasetReport("support", { pageSize: 10 });
    if (!page.available) throw new Error("unavailable");
    expect(page.rows).toHaveLength(10);
    expect(page.totalRows).toBe(30);
    const exported = await service.getExportDatasetRows("support", { pageSize: 10 });
    expect(exported).toHaveLength(30);
    expect(exported.slice(0, 10)).toEqual(page.rows);
    for (const key of Object.keys(exported[0])) expect(key).not.toMatch(/body|note|filename|storageKey|attachment|message/i);
    expect(exported[0]).toMatchObject({ contextType: "ORDER", contextReference: "order-1" });
  });

  it("builds drill-down links that round-trip through the same normalization", async () => {
    const report = await support([ticket("1")], { category: "OTHER", from: "2026-09-01" });
    for (const item of [...report.metrics, ...report.breakdown]) {
      const url = new URL(item.href, "https://example.test");
      const params = Object.fromEntries(url.searchParams);
      await expect(build([]).service.getDatasetReport("support", params)).resolves.toMatchObject({ available: true });
    }
    expect(metric(report, "unassigned").href).toContain("owner=UNASSIGNED");
    expect(metric(report, "open").href).toContain("status=OPEN_BACKLOG");
  });
});
