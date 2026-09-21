import type { ExportJob } from "@prisma/client";
import { prisma } from "@/server/db";
import { getCurrentActor } from "@/server/auth/current-actor";
import type { RawGrant } from "@/server/permissions/with-permission";
import { loadGrantsForUser } from "@/server/services/grant-service";
import { presignExportObjectUrl } from "@/server/services/storage-service";
import { canAccessExportJob, ExportUnavailableError } from "@/server/services/export-read-service";
import { recordAuditInTransaction } from "@/server/services/audit-service";

export function createExportDownloadService(deps: {
  actor: () => Promise<{ userId: string } | null>;
  loadGrants: (userId: string) => Promise<RawGrant[]>;
  findJob: (id: string, userId: string) => Promise<ExportJob | null>;
  countCohorts: (where: Record<string, unknown>) => Promise<number>;
  audit: (jobId: string, actorId: string) => Promise<void>;
  presign: (input: { key: string; filename: string }) => Promise<string>;
  now?: () => Date;
}) {
  return {
    async getDownloadUrl(jobId: string): Promise<string> {
      const actor = await deps.actor();
      if (!actor || !jobId || jobId.length > 128) throw new ExportUnavailableError();
      const job = await deps.findJob(jobId, actor.userId);
      const now = deps.now?.() ?? new Date();
      if (!job || job.status !== "SUCCEEDED" || !job.storageKey || !job.expiresAt || job.expiresAt <= now) throw new ExportUnavailableError();
      const grants = await deps.loadGrants(actor.userId);
      if (!(await canAccessExportJob(job, actor.userId, grants, now, deps))) throw new ExportUnavailableError();
      await deps.audit(job.id, actor.userId);
      return deps.presign({ key: job.storageKey, filename: `${job.dataset}-${job.asOf.toISOString().slice(0, 10)}.csv` });
    },
  };
}

export const exportDownloadService = createExportDownloadService({
  actor: getCurrentActor,
  loadGrants: loadGrantsForUser,
  findJob: (id, userId) => prisma.exportJob.findFirst({ where: { id, requestedById: userId } }),
  countCohorts: (where) => prisma.cohort.count({ where }),
  audit: async (jobId, actorId) => {
    await prisma.$transaction(async (tx) => {
      await recordAuditInTransaction(tx, { actorId, action: "export.download_authorized", targetType: "ExportJob", targetId: jobId, outcome: "SUCCESS" });
      await tx.exportJob.update({ where: { id: jobId }, data: { downloadedAt: new Date() } });
    });
  },
  presign: presignExportObjectUrl,
});
