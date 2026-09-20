/** Database-authoritative export processor. Scheduled callers supply no job
 * instructions; every byte comes from the immutable request-time snapshot. */
import { Readable } from "node:stream";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { streamCsv, type CsvColumn, type CsvRow } from "@/server/services/csv-service";
import { buildExportStorageKey, deleteExportObject, uploadExportObject } from "@/server/services/storage-service";
import { recordAuditInTransaction } from "@/server/services/audit-service";

const MAX_BATCH = 25;
const PAGE_SIZE = 500;
const STALE_AFTER_MS = 20 * 60_000;
const DOWNLOAD_LIFETIME_MS = 24 * 60 * 60_000;
const SAFE_FAILURE = "Export generation failed. Retry this export.";
type Claimed = { id: string };

function bounded(limit: number): number {
  return Number.isInteger(limit) ? Math.min(MAX_BATCH, Math.max(1, limit)) : 1;
}

function frozenColumns(value: unknown): CsvColumn[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new Error("Invalid frozen export columns.");
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof item.key !== "string" || typeof item.label !== "string") throw new Error("Invalid frozen export columns.");
    return { key: item.key, label: item.label };
  });
}

function frozenFilters(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid frozen export filters.");
  return value as Record<string, unknown>;
}

export type ExportWorkerDeps = {
  db: PrismaClient;
  upload: (input: { key: string; body: Readable }) => Promise<void>;
  deleteObject: (key: string) => Promise<void>;
  now?: () => Date;
};

export function createExportWorkerService(deps: ExportWorkerDeps) {
  const now = deps.now ?? (() => new Date());

  async function recoverStale(): Promise<number> {
    const cutoff = new Date(now().getTime() - STALE_AFTER_MS);
    const result = await deps.db.exportJob.updateMany({
      where: { status: "PROCESSING", startedAt: { lt: cutoff } },
      data: { status: "QUEUED" },
    });
    return result.count;
  }

  async function claimQueued(limit: number): Promise<string[]> {
    const claimTime = now();
    return deps.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Claimed[]>`
        SELECT "id" FROM "ExportJob"
        WHERE "status" = 'QUEUED'
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${bounded(limit)}`;
      for (const row of rows) {
        await tx.$executeRaw`
          UPDATE "ExportJob"
          SET "status" = 'PROCESSING',
              "startedAt" = COALESCE("startedAt", ${claimTime}),
              "updatedAt" = ${claimTime}
          WHERE "id" = ${row.id} AND "status" = 'QUEUED'`;
      }
      return rows.map((row) => row.id);
    });
  }

  async function* snapshotRows(jobId: string, expectedCount: number): AsyncGenerator<CsvRow> {
    let nextOrdinal = 0;
    while (true) {
      const page = await deps.db.exportSnapshotRow.findMany({
        where: { jobId, ordinal: { gte: nextOrdinal } },
        orderBy: { ordinal: "asc" },
        take: PAGE_SIZE,
      });
      if (page.length === 0) break;
      for (const row of page) {
        if (row.ordinal !== nextOrdinal || !row.data || typeof row.data !== "object" || Array.isArray(row.data)) throw new Error("Invalid frozen export row.");
        nextOrdinal++;
        yield row.data as CsvRow;
      }
    }
    if (nextOrdinal !== expectedCount) throw new Error("Frozen export row count changed.");
  }

  async function markFailed(jobId: string): Promise<void> {
    await deps.db.$transaction(async (tx) => {
      const changed = await tx.exportJob.updateMany({
        where: { id: jobId, status: "PROCESSING" },
        data: { status: "FAILED", errorCode: "EXPORT_GENERATION_FAILED", errorMessage: SAFE_FAILURE, error: SAFE_FAILURE, storageKey: null },
      });
      if (changed.count === 1) await recordAuditInTransaction(tx, { actorId: null, actorType: "SYSTEM", action: "export.failed", targetType: "ExportJob", targetId: jobId, outcome: "FAILED", after: { errorCode: "EXPORT_GENERATION_FAILED" } });
    });
  }

  async function processOne(jobId: string): Promise<boolean> {
    try {
      const job = await deps.db.exportJob.findFirst({ where: { id: jobId, status: "PROCESSING" } });
      if (!job || job.rowCount === null || job.rowCount < 0) throw new Error("Export job unavailable.");
      const columns = frozenColumns(job.columnSnapshot);
      const key = buildExportStorageKey(job.id, job.datasetVersion);
      const body = Readable.from(streamCsv({
        dataset: job.dataset,
        version: job.datasetVersion,
        filters: frozenFilters(job.filters),
        generatedAt: job.startedAt ?? job.createdAt,
        asOf: job.asOf,
        timezone: job.timezone,
      }, columns, snapshotRows(job.id, job.rowCount)));
      await deps.upload({ key, body });
      const completedAt = now();
      return deps.db.$transaction(async (tx) => {
        const changed = await tx.exportJob.updateMany({
          where: { id: job.id, status: "PROCESSING" },
          data: { status: "SUCCEEDED", storageKey: key, completedAt, expiresAt: new Date(completedAt.getTime() + DOWNLOAD_LIFETIME_MS), error: null, errorCode: null, errorMessage: null },
        });
        if (changed.count !== 1) return false;
        await recordAuditInTransaction(tx, { actorId: null, actorType: "SYSTEM", action: "export.succeeded", targetType: "ExportJob", targetId: job.id, outcome: "SUCCESS", after: { rowCount: job.rowCount, completedAt: completedAt.toISOString() } });
        return true;
      });
    } catch {
      await markFailed(jobId);
      return false;
    }
  }

  async function processBatch(limit: number): Promise<{ processed: number; failed: number }> {
    await recoverStale();
    const claimed = await claimQueued(limit);
    let processed = 0, failed = 0;
    for (const jobId of claimed) {
      if (await processOne(jobId)) processed++;
      else failed++;
    }
    return { processed, failed };
  }

  async function expireBatch(limit: number): Promise<number> {
    const instant = now();
    const due = await deps.db.exportJob.findMany({
      where: { status: "SUCCEEDED", expiresAt: { lte: instant }, storageKey: { not: null } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: bounded(limit),
      select: { id: true, storageKey: true },
    });
    let expired = 0;
    for (const job of due) {
      if (!job.storageKey) continue;
      try {
        await deps.deleteObject(job.storageKey);
        const won = await deps.db.$transaction(async (tx) => {
          const changed = await tx.exportJob.updateMany({
            where: { id: job.id, status: "SUCCEEDED", expiresAt: { lte: instant } },
            data: { status: "EXPIRED", storageKey: null },
          });
          if (changed.count !== 1) return false;
          await recordAuditInTransaction(tx, { actorId: null, actorType: "SYSTEM", action: "export.expired", targetType: "ExportJob", targetId: job.id, outcome: "SUCCESS" });
          return true;
        });
        if (won) expired++;
      } catch {
        // A failed delete keeps the job due; the next sweep retries it.
      }
    }
    return expired;
  }

  return { claimQueued, recoverStale, processBatch, expireBatch };
}

export const exportWorkerService = createExportWorkerService({
  db: prisma,
  upload: uploadExportObject,
  deleteObject: deleteExportObject,
});
