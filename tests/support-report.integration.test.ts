import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import type { createReportQueryService as CreateReportService } from "@/server/services/report-query-service";
import type { createExportService as CreateExportService } from "@/server/services/export-service";
import type { createCollectionAuthorizer as CreateAuthorizer } from "@/server/permissions/collection-scope";
import { isPermission } from "@/server/permissions/catalogue";
import { AuthorizationError } from "@/server/permissions";

let database: TestDatabase;
let makeReports: typeof CreateReportService;
let makeExports: typeof CreateExportService;
let makeAuthorizer: typeof CreateAuthorizer;

const NOW = new Date("2026-09-30T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
const SENTINELS = ["PUBLIC-SENTINEL-BODY", "INTERNAL-SENTINEL-NOTE", "secret-SENTINEL-file.pdf", "private/SENTINEL-storage-key", "SENTINEL-subject-not-exported"];

const users: Record<string, string> = {};
const tickets: Record<string, string> = {};

async function seedUser(key: string, permissions: string[], scope: "GLOBAL" | "NONE" = "GLOBAL") {
  const user = await database.prisma.user.create({ data: { email: `${key}@support-report.invalid`, name: `Name ${key}`, status: "ACTIVE" } });
  users[key] = user.id;
  if (permissions.length > 0) {
    const role = await database.prisma.role.create({ data: { name: `role-${key}`, permissions: permissions as never } });
    await database.prisma.assignment.create({ data: { userId: user.id, roleId: role.id, scopeType: scope === "GLOBAL" ? "GLOBAL" : "GLOBAL" } });
  }
}

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  ({ createReportQueryService: makeReports } = await import("@/server/services/report-query-service"));
  ({ createExportService: makeExports } = await import("@/server/services/export-service"));
  ({ createCollectionAuthorizer: makeAuthorizer } = await import("@/server/permissions/collection-scope"));

  await seedUser("learner", []);
  await seedUser("owner1", []);
  await seedUser("ops", ["reports.view", "reports.export", "tickets.view"]);
  await seedUser("opsIdentity", ["reports.view", "reports.export", "tickets.view", "users.view"]);
  await seedUser("noTickets", ["reports.view", "reports.export"]);
  await database.prisma.user.update({ where: { id: users.owner1 }, data: { name: "Owner One" } });

  const p = database.prisma;
  const specs: Array<{ key: string; category: string; status: string; queue: string; priority: string; owner?: string; created: number; firstResponse?: number; resolved?: number; events?: Array<{ type: string; at: number }> }> = [
    { key: "a", category: "ACCOUNT_ACCESS", status: "OPEN", queue: "ACCOUNTS", priority: "URGENT", created: 5, firstResponse: 4.5 },
    { key: "b", category: "PAYMENT_ORDER", status: "ESCALATED", queue: "FINANCE", priority: "HIGH", owner: "owner1", created: 30, firstResponse: 29, events: [{ type: "ESCALATED", at: 20 }, { type: "ESCALATION_ACCEPTED", at: 19 }] },
    { key: "c", category: "PAYMENT_ORDER", status: "RESOLVED", queue: "FINANCE", priority: "NORMAL", owner: "owner1", created: 100, firstResponse: 99, resolved: 90, events: [{ type: "REOPENED", at: 95 }] },
    { key: "d", category: "OTHER", status: "NEW", queue: "GENERAL_SUPPORT", priority: "LOW", created: 24 * 9 },
    { key: "e", category: "OTHER", status: "CLOSED", queue: "GENERAL_SUPPORT", priority: "NORMAL", created: 24 * 45, resolved: 24 * 44 },
    { key: "f", category: "CERTIFICATE", status: "ASSIGNED", queue: "TECHNICAL", priority: "NORMAL", owner: "owner1", created: 60 },
  ];
  for (const spec of specs) {
    const ticket = await p.ticket.create({
      data: {
        reference: `TKT-${spec.key.toUpperCase()}`, userId: users.learner, category: spec.category as never, subject: SENTINELS[4],
        status: spec.status as never, queue: spec.queue as never, priority: spec.priority as never,
        assigneeId: spec.owner ? users[spec.owner] : null, createdAt: hoursAgo(spec.created),
        firstRespondedAt: spec.firstResponse ? hoursAgo(spec.firstResponse) : null,
        resolvedAt: spec.resolved ? hoursAgo(spec.resolved) : null,
        closedAt: spec.status === "CLOSED" ? hoursAgo(spec.resolved ?? 0) : null,
      },
    });
    tickets[spec.key] = ticket.id;
    const publicMessage = await p.ticketMessage.create({ data: { ticketId: ticket.id, authorId: users.learner, kind: "INITIAL", visibility: "PUBLIC", body: SENTINELS[0], createdAt: hoursAgo(spec.created) } });
    await p.ticketMessage.create({ data: { ticketId: ticket.id, authorId: users.owner1, kind: "INTERNAL_NOTE", visibility: "INTERNAL", body: SENTINELS[1] } });
    await p.ticketAttachment.create({ data: { ticketId: ticket.id, messageId: publicMessage.id, uploadedById: users.learner, storageKey: SENTINELS[3], filename: SENTINELS[2], mimeType: "application/pdf", sizeBytes: BigInt(10) } });
    for (const event of spec.events ?? []) {
      await p.ticketEvent.create({ data: { ticketId: ticket.id, type: event.type as never, actorId: users.owner1, createdAt: hoursAgo(event.at) } });
    }
  }
}, TEST_DB_TIMEOUT_MS);
afterAll(async () => { await database?.stop(); }, TEST_DB_TIMEOUT_MS);

function reports(actorKey: string) {
  const authorizeCollection = makeAuthorizer({
    getActor: async () => ({ userId: users[actorKey] }),
    loadGrants: async (userId: string) => {
      const assignments = await database.prisma.assignment.findMany({ where: { userId, role: { active: true } }, select: { scopeType: true, scopeId: true, active: true, revokedAt: true, startsAt: true, endsAt: true, role: { select: { permissions: true } } } });
      return assignments.flatMap((a) => a.role.permissions.filter(isPermission).map((permission) => ({ permission, scopeType: a.scopeType, scopeId: a.scopeId, active: a.active, revokedAt: a.revokedAt, startsAt: a.startsAt, endsAt: a.endsAt })));
    },
    audit: async () => {},
    now: () => NOW,
  } as never);
  return makeReports({ store: database.prisma as never, authorizeCollection, now: () => NOW });
}

function exporter(actorKey: string) {
  return makeExports({ db: database.prisma, actor: async () => ({ userId: users[actorKey] }), now: () => NOW });
}

async function exportedRows(actorKey: string, filters: Record<string, unknown>, columns?: string[], reason?: string) {
  const { jobId } = await exporter(actorKey).requestExport({ dataset: "support", filters, columns, reason });
  const job = await database.prisma.exportJob.findUniqueOrThrow({ where: { id: jobId }, include: { snapshotRows: { orderBy: { ordinal: "asc" } } } });
  return job.snapshotRows.map((row) => row.data as Record<string, unknown>);
}

const FILTER_CASES: Array<[string, Record<string, unknown>]> = [
  ["defaults", {}],
  ["category", { category: "PAYMENT_ORDER" }],
  ["queue", { queue: "GENERAL_SUPPORT", from: "2026-01-01" }],
  ["priority", { priority: "NORMAL", from: "2026-01-01" }],
  ["status", { status: "RESOLVED", from: "2026-01-01" }],
  ["backlog status", { status: "OPEN_BACKLOG", from: "2000-01-01" }],
  ["owner", { owner: "OWNER1" }],
  ["unassigned owner", { owner: "UNASSIGNED", from: "2026-01-01" }],
  ["date range", { from: "2026-09-27", to: "2026-09-29" }],
];

describe("support report against real PostgreSQL", () => {
  it("reconciles dashboard rows with CSV rows for identical filters and asOf", async () => {
    for (const [name, raw] of FILTER_CASES) {
      const filters = raw.owner === "OWNER1" ? { ...raw, owner: users.owner1 } : raw;
      const dashboard = await reports("ops").getDatasetReport("support", { ...filters, pageSize: 100 });
      if (!dashboard.available) throw new Error("support unavailable");
      const csv = await exportedRows("ops", filters, ["reference"]);
      expect(csv.map((row) => row.reference), name).toEqual(dashboard.rows.map((row) => (row as { reference: string }).reference));
      expect(csv.length, name).toBe(dashboard.totalRows);
    }
    const allRows = await exportedRows("ops", { from: "2026-01-01" });
    expect(allRows.map((row) => row.reference)).toEqual(["TKT-E", "TKT-D", "TKT-C", "TKT-F", "TKT-B", "TKT-A"]);
  });

  it("computes health, denominators, escalation and durations from seeded timestamps", async () => {
    const report = await reports("ops").getDatasetReport("support", {});
    if (!report.available) throw new Error("support unavailable");
    const value = (id: string) => report.metrics.find((metric) => metric.id === id)!.value;
    // Open now: A, B, D, F (C resolved, E closed).
    expect(value("open")).toBe(4);
    expect(value("unassigned")).toBe(2);
    expect(value("urgent")).toBe(1);
    expect(value("escalated")).toBe(1);
    // Default 30-day window: A, B, C, D, F created; E (45 days old) is outside.
    expect(value("created")).toBe(5);
    expect(value("resolved")).toBe(1);
    expect(value("resolution")).toBe(600);
    expect(value("first-response")).toBe(60);
    expect(value("reopen-rate")).toBe(100);
    expect(value("escalations")).toBe(1);
    expect(value("escalation-acceptance")).toBe(60);
    const bands = report.breakdown.filter((item) => item.group === "Backlog age").map((item) => item.value);
    expect(bands).toEqual([1, 2, 0, 1]);
    const csv = await exportedRows("ops", {}, ["reference", "escalationCount", "ageMinutes"]);
    expect(csv.find((row) => row.reference === "TKT-B")).toMatchObject({ escalationCount: 1, ageMinutes: 1800 });
  });

  it("keeps private message, note, filename and storage sentinels out of dashboard and export results", async () => {
    const dashboard = await reports("ops").getDatasetReport("support", { from: "2026-01-01" });
    const csv = await exportedRows("ops", { from: "2026-01-01" });
    const serialized = JSON.stringify([dashboard, csv]);
    for (const sentinel of SENTINELS) expect(serialized).not.toContain(sentinel);
    for (const row of csv) for (const key of Object.keys(row)) expect(key).not.toMatch(/body|note|filename|storage|attachment|message|subject|learner/i);
  });

  it("gates learner identity on users.view and only exposes declared columns", async () => {
    await expect(exporter("ops").requestExport({ dataset: "support", columns: ["reference", "learnerName"], reason: "Case review" })).rejects.toBeInstanceOf(AuthorizationError);
    const rows = await exportedRows("opsIdentity", { from: "2026-01-01" }, ["reference", "learnerName", "learnerEmail"], "Case review");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ reference: "TKT-E", learnerName: "Name learner", learnerEmail: "learner@support-report.invalid" });
    expect(JSON.stringify(rows)).not.toContain(SENTINELS[4]);
  });

  it("denies actors without tickets.view GLOBAL before any total, option or row is returned", async () => {
    await expect(reports("noTickets").getDatasetReport("support", {})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(exporter("noTickets").requestExport({ dataset: "support" })).rejects.toBeInstanceOf(AuthorizationError);
    const before = await database.prisma.exportJob.count();
    expect(before).toBeGreaterThan(0);
    await expect(exporter("noTickets").requestExport({ dataset: "support", filters: { status: "RESOLVED" } })).rejects.toBeInstanceOf(AuthorizationError);
    expect(await database.prisma.exportJob.count()).toBe(before);
  });

  it("rejects non-support filters and unknown columns on the export path", async () => {
    await expect(exporter("ops").requestExport({ dataset: "support", filters: { programmeId: "x" } })).rejects.toThrow("Invalid export filters");
    await expect(exporter("ops").requestExport({ dataset: "support", columns: ["reference", "body"] })).rejects.toThrow("Invalid export columns");
  });
});
