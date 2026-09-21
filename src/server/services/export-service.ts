/** Request-time, transactionally frozen export snapshots. No browser code may
 * supply a producer, authorization scope, or snapshot row. */
import { randomUUID, createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { getCurrentActor } from "@/server/auth/current-actor";
import { isPermission, type Permission } from "@/server/permissions/catalogue";
import { collectionScopeFromGrants, cohortWhereForCollection, type CollectionScopeSnapshot } from "@/server/permissions/collection-scope";
import { AuthenticationError, AuthorizationError, type RawGrant } from "@/server/permissions/with-permission";
import { isExportDataset, getExportDatasetDefinition, type ExportDataset, type ReportColumn, type ReportDataset } from "@/server/services/report-registry";
import { createReportQueryService, type ReportQueryStore, type ReportRow, type ReconciliationRefundRow } from "@/server/services/report-query-service";
import { recordAuditInTransaction } from "@/server/services/audit-service";

export const MAX_EXPORT_ROWS = 25_000;
export const MAX_EXPORT_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const TIMEZONE = "Africa/Lagos";
type Tx = Prisma.TransactionClient;
type SnapshotCell = string | number | boolean | null;
export type SnapshotRow = Readonly<Record<string, SnapshotCell>>;
export type TrustedExportProducer = (input: Readonly<{
  datasetId: ExportDataset;
  normalizedFilters: Readonly<Record<string, unknown>>;
  authorizedScope: CollectionScopeSnapshot;
  selectedColumns: readonly ReportColumn[];
  asOf: Date;
  tx: Tx;
}>) => Promise<readonly SnapshotRow[]>;

export class ExportRequestError extends Error {
  constructor(message: string) { super(message); this.name = "ExportRequestError"; }
}

type RequestInput = Readonly<{
  dataset: string;
  filters?: unknown;
  columns?: unknown;
  reason?: unknown;
  asOf?: unknown;
  idempotencyKey?: unknown;
}>;

function parseFilters(dataset: ExportDataset, raw: unknown): Record<string, unknown> {
  const definition = getExportDatasetDefinition(dataset);
  if (raw === undefined) raw = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ExportRequestError("Invalid export filters.");
  const input = raw as Record<string, unknown>;
  const status = input.status;
  const core = { ...input };
  delete core.status;
  const result = definition.filterSchema.safeParse(core);
  if (!result.success || (status !== undefined && (dataset === "audit" || typeof status !== "string" || !/^[A-Z_]{1,64}$/.test(status)))) {
    throw new ExportRequestError("Invalid export filters.");
  }
  const filters: Record<string, unknown> = { ...(result.data as Record<string, unknown>), ...(status ? { status } : {}) };
  if (typeof filters.from === "string" && typeof filters.to === "string" && filters.from > filters.to) {
    throw new ExportRequestError("Invalid export date range.");
  }
  return filters;
}

function parseColumns(dataset: ExportDataset, raw: unknown): readonly ReportColumn[] {
  const definition = getExportDatasetDefinition(dataset);
  if (raw === undefined) return definition.safeColumns;
  if (!Array.isArray(raw) || raw.some((key) => typeof key !== "string") || new Set(raw).size !== raw.length) {
    throw new ExportRequestError("Invalid export columns.");
  }
  const allowed = [...definition.safeColumns, ...definition.sensitiveColumns];
  if (raw.length === 0 || raw.some((key) => !allowed.some((column) => column.key === key))) {
    throw new ExportRequestError("Invalid export columns.");
  }
  // Registry order is the stable CSV contract, regardless of browser order.
  return allowed.filter((column) => raw.includes(column.key));
}

function snapshotData(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function insertSnapshotRows(tx: Tx, jobId: string, serialized: readonly string[]) {
  if (serialized.length === 1) {
    await tx.$executeRaw`INSERT INTO "ExportSnapshotRow" ("id", "jobId", "ordinal", "data") VALUES (${randomUUID()}, ${jobId}, 0, ${serialized[0]}::jsonb)`;
    return;
  }
  for (let offset = 0; offset < serialized.length; offset += 5000) {
    const payload = `[${serialized.slice(offset, offset + 5000).map((data, index) => `{"id":"${randomUUID()}","ordinal":${offset + index},"data":${data}}`).join(",")}]`;
    await tx.$executeRaw`INSERT INTO "ExportSnapshotRow" ("id", "jobId", "ordinal", "data") SELECT item.id, ${jobId}, item.ordinal, item.data FROM jsonb_to_recordset(${payload}::jsonb) AS item(id text, ordinal integer, data jsonb)`;
  }
}
function sameJsonObject(left: unknown, right: Record<string, unknown>): boolean {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const ordered = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  return ordered(left as Record<string, unknown>) === ordered(right);
}
function parseScopeSnapshot(value: unknown): CollectionScopeSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExportRequestError("Stored export scope is unavailable.");
  const scope = value as Record<string, unknown>;
  if (scope.kind !== "GLOBAL" && scope.kind !== "LIMITED") throw new ExportRequestError("Stored export scope is unavailable.");
  for (const key of ["programmeIds", "courseIds", "cohortIds"]) if (!Array.isArray(scope[key]) || !(scope[key] as unknown[]).every((id) => typeof id === "string")) throw new ExportRequestError("Stored export scope is unavailable.");
  return scope as CollectionScopeSnapshot;
}
async function assertScopeStillCovered(tx: Tx, original: CollectionScopeSnapshot, current: CollectionScopeSnapshot) {
  if (current.kind === "GLOBAL") return;
  if (original.kind === "GLOBAL") throw new ExportRequestError("Your current scope no longer covers this export.");
  const uncovered = await tx.cohort.count({ where: { AND: [cohortWhereForCollection(original), { NOT: cohortWhereForCollection(current) }] } });
  if (uncovered > 0) throw new ExportRequestError("Your current scope no longer covers this export.");
}

function projectedValue(row: ReportRow | ReconciliationRefundRow, key: string): SnapshotCell {
  if (key === "registeredAt" || key === "confirmedAt" || key === "activatedAt" || key === "sessionDate" || key === "occurredAt") return row.businessDate.toISOString();
  if (key === "amountMinor" && "learnerTotalMinor" in row) return row.learnerTotalMinor;
  if (key === "reference" && "orderReference" in row) return row.orderReference;
  if (key === "sessionId") return row.id;
  if (key === "state" && "stateCounts" in row) return Object.entries(row.stateCounts).map(([state, count]) => `${state}: ${count}`).join("; ") || (row.expected ? "Missing register" : "Not applicable");
  const value = (row as unknown as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function reportProducer(): TrustedExportProducer {
  return async ({ datasetId, normalizedFilters, authorizedScope, selectedColumns, asOf, tx }) => {
    const permission = datasetId === "reconciliation-refunds" ? "payments.view" : "reports.view";
    const service = createReportQueryService({
      store: tx as unknown as ReportQueryStore,
      authorizeCollection: async () => ({ actor: { userId: "trusted-export" }, permission, scope: authorizedScope, cohortWhere: cohortWhereForCollection(authorizedScope) }),
      now: () => asOf,
    });
    const rows = datasetId === "reconciliation-refunds"
      ? await service.getReconciliationRefundRows(normalizedFilters)
      : await service.getExportDatasetRows(datasetId as ReportDataset, normalizedFilters);
    const needsIdentity = selectedColumns.some((column) => column.permission === "users.view");
    const identities = new Map<string, { name: string; email: string }>();
    if (needsIdentity && datasetId === "enrolments") {
      const records = await tx.enrolment.findMany({ where: { id: { in: rows.map((row) => row.id) } }, select: { id: true, user: { select: { name: true, email: true } } } });
      for (const record of records) identities.set(record.id, record.user);
    } else if (needsIdentity) {
      const records = await tx.order.findMany({ where: { id: { in: rows.map((row) => "orderId" in row ? row.orderId : row.id) } }, select: { id: true, user: { select: { name: true, email: true } } } });
      for (const record of records) identities.set(record.id, record.user);
    }
    return rows.map((row) => Object.freeze(Object.fromEntries(selectedColumns.map((column) => {
      const identity = identities.get("orderId" in row ? row.orderId : row.id);
      if (column.key === "learnerName") return [column.key, identity?.name ?? null];
      if (column.key === "learnerEmail") return [column.key, identity?.email ?? null];
      return [column.key, projectedValue(row, column.key)];
    }))));
  };
}

async function grants(tx: Tx, userId: string): Promise<RawGrant[]> {
  const assignments = await tx.assignment.findMany({ where: { userId, role: { active: true } }, select: { scopeType: true, scopeId: true, active: true, revokedAt: true, startsAt: true, endsAt: true, role: { select: { permissions: true } } } });
  return assignments.flatMap((assignment) => assignment.role.permissions.filter(isPermission).map((permission): RawGrant => ({ permission, scopeType: assignment.scopeType, scopeId: assignment.scopeId, active: assignment.active, revokedAt: assignment.revokedAt, startsAt: assignment.startsAt, endsAt: assignment.endsAt })));
}

async function authorize(tx: Tx, userId: string, dataset: ExportDataset, sensitive: boolean, asOf: Date) {
  const definition = getExportDatasetDefinition(dataset);
  const active = await grants(tx, userId);
  const required: Permission[] = [definition.permission, ...(dataset === "audit" ? ["audit.export" as const] : ["reports.export" as const])];
  const scopes = required.map((permission) => collectionScopeFromGrants(active, permission, asOf));
  if (scopes.some((scope) => !scope)) throw new AuthorizationError(required[0]);
  const scope = scopes[0]!;
  if (definition.scopePolicy === "GLOBAL" && scopes.some((item) => item?.kind !== "GLOBAL")) throw new AuthorizationError(required[0]);
  if (definition.scopePolicy === "COLLECTION") {
    const exportScope = scopes[1]!;
    if (scope.kind === "GLOBAL" && exportScope.kind !== "GLOBAL") throw new AuthorizationError(required[1]);
    if (scope.kind === "LIMITED" && exportScope.kind === "LIMITED") {
      const uncovered = await tx.cohort.count({ where: { AND: [cohortWhereForCollection(scope), { NOT: cohortWhereForCollection(exportScope) }] } });
      if (uncovered > 0) throw new AuthorizationError(required[1]);
    }
  }
  if (sensitive) {
    const identity = collectionScopeFromGrants(active, "users.view", asOf);
    if (!identity) throw new AuthorizationError("users.view");
    if (definition.scopePolicy === "GLOBAL" && identity.kind !== "GLOBAL") throw new AuthorizationError("users.view");
    if (scope.kind === "GLOBAL" && identity.kind !== "GLOBAL") throw new AuthorizationError("users.view");
    if (scope.kind === "LIMITED" && identity.kind === "LIMITED") {
      const uncovered = await tx.cohort.count({ where: { AND: [cohortWhereForCollection(scope), { NOT: cohortWhereForCollection(identity) }] } });
      if (uncovered > 0) throw new AuthorizationError("users.view");
    }
  }
  return scope;
}

export type ExportServiceDeps = Readonly<{
  db: Pick<PrismaClient, "$transaction">;
  actor: () => Promise<{ userId: string } | null>;
  now?: () => Date;
  producers?: Partial<Record<ExportDataset, TrustedExportProducer>>;
}>;

export function createExportService(deps: ExportServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const builtIn = reportProducer();
  const producers = deps.producers ?? {};

  async function requestExport(input: RequestInput, attempt = 0) {
    if (!input || typeof input !== "object" || !isExportDataset(input.dataset)) throw new ExportRequestError("Unknown export dataset.");
    const actor = await deps.actor();
    if (!actor) throw new AuthenticationError();
    const dataset = input.dataset;
    const filters = parseFilters(dataset, input.filters);
    const columns = parseColumns(dataset, input.columns);
    const sensitive = columns.some((column) => column.permission === "users.view");
    if (sensitive && dataset === "attendance") throw new ExportRequestError("Sensitive learner fields are not available for session-level exports.");
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (sensitive && (!reason || reason.length > 2000)) throw new ExportRequestError("An operational reason is required for sensitive columns.");
    if (!sensitive && input.reason !== undefined && reason) throw new ExportRequestError("A reason is only valid with sensitive columns.");
    const suppliedAsOf = input.asOf === undefined ? null : new Date(String(input.asOf));
    const frozenAt = now();
    if (suppliedAsOf && (Number.isNaN(suppliedAsOf.getTime()) || suppliedAsOf > frozenAt || frozenAt.getTime() - suppliedAsOf.getTime() > 5 * 60_000)) throw new ExportRequestError("The report has changed. Refresh it before exporting.");
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || !/^[\w-]{8,128}$/.test(input.idempotencyKey))) throw new ExportRequestError("Invalid export request key.");
    const key = input.idempotencyKey ? fingerprint([actor.userId, input.idempotencyKey]) : null;
    const producer = producers[dataset] ?? (dataset === "audit" ? null : builtIn);
    if (!producer) throw new ExportRequestError("This export is not available yet.");
    try { return await deps.db.$transaction(async (tx) => {
      const scope = await authorize(tx, actor.userId, dataset, sensitive, frozenAt);
      if (key) {
        const previous = await tx.exportJob.findUnique({ where: { idempotencyKey: key } });
        if (previous) {
          const previousColumns = Array.isArray(previous.columnSnapshot) ? previous.columnSnapshot.map((column) => (column as { key: string }).key) : [];
          if (previous.requestedById !== actor.userId || previous.dataset !== dataset || !sameJsonObject(previous.filters, filters) || JSON.stringify(previousColumns) !== JSON.stringify(columns.map((column) => column.key)) || (previous.sensitiveReason ?? "") !== reason) throw new ExportRequestError("This request key has already been used.");
          return { jobId: previous.id, status: previous.status };
        }
      }
      const rows = await producer({ datasetId: dataset, normalizedFilters: filters, authorizedScope: scope, selectedColumns: columns, asOf: frozenAt, tx });
      if (rows.length > MAX_EXPORT_ROWS) throw new ExportRequestError("Too many export rows. Narrow the filters and retry.");
      let bytes = 0;
      const serialized: string[] = [];
      const allowedKeys = new Set(columns.map((column) => column.key));
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row) || Object.entries(row).some(([column, value]) => !allowedKeys.has(column) || (value !== null && !["string", "number", "boolean"].includes(typeof value)))) {
          throw new ExportRequestError("The export projection is invalid.");
        }
        const json = JSON.stringify(row);
        bytes += Buffer.byteLength(json, "utf8");
        if (bytes > MAX_EXPORT_SNAPSHOT_BYTES) throw new ExportRequestError("The export is too large. Narrow the filters and retry.");
        serialized.push(json);
      }
      const job = await tx.exportJob.create({ data: { requestedById: actor.userId, dataset, datasetVersion: getExportDatasetDefinition(dataset).version, filters: snapshotData(filters), asOf: frozenAt, timezone: TIMEZONE, scopeSnapshot: snapshotData(scope), columnSnapshot: snapshotData(columns), sensitiveReason: sensitive ? reason : null, idempotencyKey: key, rowCount: rows.length, status: "QUEUED" } });
      await insertSnapshotRows(tx, job.id, serialized);
      await recordAuditInTransaction(tx, { actorId: actor.userId, action: "export.requested", targetType: "ExportJob", targetId: job.id, outcome: "SUCCESS", correlationId: randomUUID(), after: snapshotData({ dataset, filters, columns: columns.map((column) => column.key), sensitive, rowCount: rows.length, asOf: frozenAt.toISOString() }), reason: sensitive ? reason : null });
      return { jobId: job.id, status: "QUEUED" as const };
    }, { timeout: 10_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // Competing requests may both miss the preflight row. PostgreSQL's
      // unique key or serializable conflict chooses a winner; replay once.
      if (key && attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) return requestExport(input, attempt + 1);
      throw error;
    }
  }

  async function retryExport(jobId: string) {
    const actor = await deps.actor(); if (!actor) throw new AuthenticationError();
    return deps.db.$transaction(async (tx) => {
      const old = await tx.exportJob.findFirst({ where: { id: jobId, requestedById: actor.userId }, include: { snapshotRows: { orderBy: { ordinal: "asc" } } } });
      if (!old || old.status !== "FAILED" || !isExportDataset(old.dataset)) throw new ExportRequestError("Failed export not found.");
      const currentScope = await authorize(tx, actor.userId, old.dataset, Boolean(old.sensitiveReason), now());
      await assertScopeStillCovered(tx, parseScopeSnapshot(old.scopeSnapshot), currentScope);
      const existing = await tx.exportJob.findFirst({ where: { retryOfId: old.id }, orderBy: { createdAt: "desc" } });
      if (existing) return { jobId: existing.id, status: existing.status };
      const job = await tx.exportJob.create({ data: { requestedById: actor.userId, dataset: old.dataset, datasetVersion: old.datasetVersion, filters: old.filters ?? Prisma.JsonNull, asOf: old.asOf, timezone: old.timezone, scopeSnapshot: old.scopeSnapshot ?? Prisma.JsonNull, columnSnapshot: old.columnSnapshot ?? Prisma.JsonNull, sensitiveReason: old.sensitiveReason, rowCount: old.rowCount, retryOfId: old.id, status: "QUEUED" } });
      await insertSnapshotRows(tx, job.id, old.snapshotRows.map((row) => JSON.stringify(row.data)));
      await recordAuditInTransaction(tx, { actorId: actor.userId, action: "export.retried", targetType: "ExportJob", targetId: job.id, outcome: "SUCCESS", after: snapshotData({ retryOfId: old.id }) });
      return { jobId: job.id, status: "QUEUED" as const };
    }, { timeout: 10_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async function rerunExpiredExport(jobId: string) {
    const actor = await deps.actor(); if (!actor) throw new AuthenticationError();
    const original = await deps.db.$transaction((tx) => tx.exportJob.findFirst({ where: { id: jobId, requestedById: actor.userId } }));
    if (!original || original.status !== "EXPIRED") throw new ExportRequestError("Expired export not found.");
    const filters = original.filters && typeof original.filters === "object" && !Array.isArray(original.filters) ? { ...original.filters as Record<string, unknown> } : {};
    const columns = Array.isArray(original.columnSnapshot) ? original.columnSnapshot.map((column) => (column as { key: string }).key) : undefined;
    return requestExport({ dataset: original.dataset, filters, columns, reason: original.sensitiveReason ?? undefined });
  }

  return { requestExport, retryExport, rerunExpiredExport };
}

export const exportService = createExportService({ db: prisma, actor: getCurrentActor });
