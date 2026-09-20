import type { ExportJob, JobStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { getCurrentActor } from "@/server/auth/current-actor";
import { collectionScopeFromGrants, cohortWhereForCollection, type CollectionScopeSnapshot } from "@/server/permissions/collection-scope";
import { loadGrantsForUser } from "@/server/services/grant-service";
import type { RawGrant } from "@/server/permissions/with-permission";
import { getExportDatasetDefinition, isExportDataset, type ExportDataset } from "@/server/services/report-registry";

export type ExportHistoryRow = Readonly<{
  id: string;
  dataset: ExportDataset;
  datasetVersion: string;
  filters: Readonly<Record<string, string>>;
  columns: readonly string[];
  status: JobStatus;
  rowCount: number | null;
  asOf: string;
  timezone: string;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  retryOfId: string | null;
  retriedById?: string | null;
  failure: string | null;
  canDownload: boolean;
}>;
export type ExportHistoryPage = Readonly<{ rows: readonly ExportHistoryRow[]; page: number; hasMore: boolean }>;
type HistoryFilters = { dataset?: string; status?: string; search?: string; from?: string; to?: string; page?: number };

export class ExportUnavailableError extends Error {
  constructor() { super("This export is unavailable."); this.name = "ExportUnavailableError"; }
}

type ExportAccessDependencies = {
  countCohorts: (where: Record<string, unknown>) => Promise<number>;
};

function storedScope(value: unknown): CollectionScopeSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scope = value as Record<string, unknown>;
  if (scope.kind !== "GLOBAL" && scope.kind !== "LIMITED") return null;
  if (!["programmeIds", "courseIds", "cohortIds"].every((key) => Array.isArray(scope[key]) && (scope[key] as unknown[]).every((id) => typeof id === "string"))) return null;
  if (scope.kind === "LIMITED" && !(scope.programmeIds as string[]).length && !(scope.courseIds as string[]).length && !(scope.cohortIds as string[]).length) return null;
  return scope as CollectionScopeSnapshot;
}

async function covers(deps: ExportAccessDependencies, original: CollectionScopeSnapshot, current: CollectionScopeSnapshot): Promise<boolean> {
  if (current.kind === "GLOBAL") return true;
  if (original.kind === "GLOBAL") return false;
  return (await deps.countCohorts({ AND: [cohortWhereForCollection(original), { NOT: cohortWhereForCollection(current) }] })) === 0;
}

export async function canAccessExportJob(
  job: ExportJob,
  actorId: string,
  grants: readonly RawGrant[],
  now: Date,
  deps: ExportAccessDependencies,
): Promise<boolean> {
  if (job.requestedById !== actorId || !isExportDataset(job.dataset)) return false;
  const definition = getExportDatasetDefinition(job.dataset);
  const original = storedScope(job.scopeSnapshot);
  if (!original) return false;
  const domain = collectionScopeFromGrants(grants, definition.permission, now);
  const exporting = collectionScopeFromGrants(grants, job.dataset === "audit" ? "audit.export" : "reports.export", now);
  if (!domain || !exporting || !(await covers(deps, original, domain)) || !(await covers(deps, original, exporting))) return false;
  if (definition.scopePolicy === "GLOBAL" && (original.kind !== "GLOBAL" || domain.kind !== "GLOBAL" || exporting.kind !== "GLOBAL")) return false;
  const columns = Array.isArray(job.columnSnapshot) ? job.columnSnapshot : [];
  const sensitive = columns.some((column) => column && typeof column === "object" && !Array.isArray(column) && (column as { permission?: unknown }).permission === "users.view");
  if (sensitive) {
    const identity = collectionScopeFromGrants(grants, "users.view", now);
    if (!identity || !(await covers(deps, original, identity))) return false;
    if (definition.scopePolicy === "GLOBAL" && identity.kind !== "GLOBAL") return false;
  }
  return true;
}

type HistoryStoredJob = ExportJob & { retries?: readonly { id: string }[] };

function project(job: HistoryStoredJob, now: Date): ExportHistoryRow {
  const filters = job.filters && typeof job.filters === "object" && !Array.isArray(job.filters)
    ? Object.fromEntries(Object.entries(job.filters).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  const columns = Array.isArray(job.columnSnapshot) ? job.columnSnapshot.flatMap((value) => value && typeof value === "object" && !Array.isArray(value) && typeof (value as { label?: unknown }).label === "string" ? [(value as { label: string }).label] : []) : [];
  const canDownload = job.status === "SUCCEEDED" && !!job.storageKey && !!job.expiresAt && job.expiresAt > now;
  return {
    id: job.id, dataset: job.dataset as ExportDataset, datasetVersion: job.datasetVersion,
    filters, columns, status: job.status, rowCount: job.rowCount,
    asOf: job.asOf.toISOString(), timezone: job.timezone, createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null, expiresAt: job.expiresAt?.toISOString() ?? null,
    retryOfId: job.retryOfId, retriedById: job.retries?.[0]?.id ?? null,
    failure: job.status === "FAILED" ? (job.errorMessage ?? job.error ?? "Export failed.").slice(0, 500) : null,
    canDownload,
  };
}

export function createExportReadService(deps: {
  actor: () => Promise<{ userId: string } | null>;
  loadGrants: (userId: string) => Promise<RawGrant[]>;
  findJobs: (input: { userId: string; dataset?: ExportDataset; status?: JobStatus; search?: string; from?: Date; to?: Date; cursor?: string; take: number }) => Promise<HistoryStoredJob[]>;
  countCohorts: ExportAccessDependencies["countCohorts"];
  now?: () => Date;
}) {
  async function listPage(input: HistoryFilters = {}): Promise<ExportHistoryPage> {
      const actor = await deps.actor();
      if (!actor) throw new ExportUnavailableError();
      const page = Number.isInteger(input.page) && (input.page ?? 1) >= 1 && (input.page ?? 1) <= 100 ? input.page! : 1;
      if (input.dataset && !isExportDataset(input.dataset)) return { rows: [], page, hasMore: false };
      if (input.status && !["QUEUED", "PROCESSING", "SUCCEEDED", "FAILED", "EXPIRED"].includes(input.status)) return { rows: [], page, hasMore: false };
      const from = input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? new Date(`${input.from}T00:00:00.000Z`) : undefined;
      const to = input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? new Date(`${input.to}T23:59:59.999Z`) : undefined;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) return { rows: [], page, hasMore: false };
      const now = deps.now?.() ?? new Date();
      const grants = await deps.loadGrants(actor.userId);
      const visible: ExportHistoryRow[] = [];
      let cursor: string | undefined;
      let scanned = 0;
      const wanted = page * 50 + 1;
      while (visible.length < wanted && scanned < 20_000) {
        const jobs = await deps.findJobs({ userId: actor.userId, dataset: input.dataset as ExportDataset | undefined, status: input.status as JobStatus | undefined, search: input.search?.slice(0, 128), from, to, cursor, take: 100 });
        if (!jobs.length) break;
        for (const job of jobs) {
          if (await canAccessExportJob(job, actor.userId, grants, now, deps)) visible.push(project(job, now));
          if (visible.length >= wanted) break;
        }
        scanned += jobs.length;
        cursor = jobs.at(-1)?.id;
        if (jobs.length < 100) break;
      }
      return { rows: visible.slice((page - 1) * 50, page * 50), page, hasMore: visible.length > page * 50 };
  }
  return {
    listPage,
    async list(input: HistoryFilters = {}): Promise<ExportHistoryRow[]> { return [...(await listPage(input)).rows]; },
  };
}

export const exportReadService = createExportReadService({
  actor: getCurrentActor,
  loadGrants: loadGrantsForUser,
  findJobs: ({ userId, dataset, status, search, from, to, cursor, take }) => prisma.exportJob.findMany({
    where: { requestedById: userId, ...(dataset ? { dataset } : {}), ...(status ? { status } : {}), ...(search ? { id: { contains: search } } : {}), ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { retries: { select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
  }),
  countCohorts: (where) => prisma.cohort.count({ where }),
});
