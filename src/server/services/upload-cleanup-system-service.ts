/**
 * WORKER-ONLY stale-upload sweep — DELIBERATELY unauthorized.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE "FIXING" THE MISSING AUTHORIZATION CHECK.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A hourly Netlify Scheduled Function invokes this to clear lesson resources
 * and support-ticket attachments left `UPLOADING` for more than 24 hours — an intent whose browser never
 * completed the direct upload. It runs with no request and no session, so it
 * cannot pass through the request-scoped permission choke point
 * (`src/server/permissions/*`); wrapping it there would make it throw on the
 * first scheduled run and the abandoned rows would accumulate forever.
 *
 * Same shape and same structural controls as `hold-release-system-service.ts`:
 *   1. The exported operation is suffixed `AsSystem`.
 *   2. It takes NO caller-supplied filter — it resolves its own work set from
 *      `uploadStatus = 'UPLOADING'` AND `createdAt` older than the cutoff, and
 *      defensively re-filters what it reads back.
 *   3. It audits every removal — `actorId: null, actorType: "SYSTEM"` — under a
 *      distinct action name (`lessonresource.upload_abandoned`).
 *   4. `tests/boundary.test.ts` keeps the scheduled-function import closure away
 *      from request-only APIs.
 *
 * This module MUST NOT import the permission choke point, the request
 * actor-getter, or anything under `next/`. It imports only the database client,
 * `storage-service.ts` and `audit-service.ts`.
 */

import { prisma } from "@/server/db";
import { recordAudit } from "@/server/services/audit-service";
import { deleteLessonObject } from "@/server/services/storage-service";

export const SYSTEM_ACTOR_TYPE = "SYSTEM";

type StaleUploadRow = {
  id: string;
  storageKey: string;
  uploadStatus: string;
  createdAt: Date;
};

type LessonResourceCleanupDelegate = {
  findMany(args: {
    where: { uploadStatus: "UPLOADING"; createdAt: { lt: Date } };
    orderBy: { createdAt: "asc" };
    take: number;
  }): Promise<StaleUploadRow[]>;
  delete(args: { where: { id: string } }): Promise<unknown>;
};

export type CreateUploadCleanupSystemServiceDeps = {
  lessonResource: LessonResourceCleanupDelegate;
  /** Support-ticket attachments; swept with the same predicate and bound. */
  ticketAttachment?: LessonResourceCleanupDelegate;
  deleteObject: (key: string) => Promise<void>;
  audit: (event: {
    actorId: string | null;
    actorType?: string;
    action: string;
    targetType: string;
    targetId: string;
    outcome: string;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
  }) => Promise<void>;
};

/**
 * Returns a bounded, failure-isolated sweep. Each candidate's staged object is
 * deleted before its row, so a failure between the two leaves a harmless orphan
 * the R2 lifecycle rule reaps rather than a row pointing at nothing. A per-row
 * failure is caught, logged and counted — one poison row cannot stall the rest.
 */
export function createUploadCleanupSystemService(deps: CreateUploadCleanupSystemServiceDeps) {
  async function sweep(
    delegate: LessonResourceCleanupDelegate,
    kind: { targetType: string; action: string },
    olderThan: Date,
    batchLimit: number,
  ): Promise<{ removed: number; failed: number }> {
    const candidates = await delegate.findMany({
      where: { uploadStatus: "UPLOADING", createdAt: { lt: olderThan } },
      orderBy: { createdAt: "asc" },
      take: batchLimit,
    });

    // Defensive re-filter so a delegate that ignores the `lt` operator (a
    // simple test fake) still yields exactly the correct set — never a recent
    // intent, never a row already promoted to READY or failed to ERROR.
    const work = candidates.filter(
      (row) => row.uploadStatus === "UPLOADING" && row.createdAt < olderThan,
    );

    let removed = 0;
    let failed = 0;

    for (const row of work) {
      try {
        await deps.deleteObject(row.storageKey);
        await delegate.delete({ where: { id: row.id } });
        await deps.audit({
          actorId: null,
          actorType: SYSTEM_ACTOR_TYPE,
          action: kind.action,
          targetType: kind.targetType,
          targetId: row.id,
          outcome: "SUCCESS",
          reason: "upload incomplete after 24 hours",
          before: row,
          after: null,
        });
        removed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[upload-cleanup] failed for ${row.id}`, error);
      }
    }

    return { removed, failed };
  }

  /**
   * Each kind is bounded by `batchLimit`, so one invocation touches at most
   * 2 x batchLimit rows. The name is kept for the existing scheduled wrapper.
   */
  return async function cleanupStaleLessonUploads(
    olderThan: Date,
    batchLimit: number,
  ): Promise<{ removed: number; failed: number }> {
    const lessons = await sweep(
      deps.lessonResource,
      { targetType: "LessonResource", action: "lessonresource.upload_abandoned" },
      olderThan,
      batchLimit,
    );
    if (!deps.ticketAttachment) return lessons;
    const tickets = await sweep(
      deps.ticketAttachment,
      { targetType: "TicketAttachment", action: "ticketattachment.upload_abandoned" },
      olderThan,
      batchLimit,
    );
    return {
      removed: lessons.removed + tickets.removed,
      failed: lessons.failed + tickets.failed,
    };
  };
}

const built = createUploadCleanupSystemService({
  lessonResource: prisma.lessonResource as unknown as LessonResourceCleanupDelegate,
  ticketAttachment: prisma.ticketAttachment as unknown as LessonResourceCleanupDelegate,
  deleteObject: deleteLessonObject,
  audit: (event) => recordAudit(event),
});

/**
 * Removes lesson resources abandoned in `UPLOADING` before `olderThan`, at most
 * `batchLimit` per call. No actor, no session — audits as `actorType: "SYSTEM"`.
 * Scheduled function only.
 */
export function cleanupStaleLessonUploadsAsSystem(
  olderThan: Date,
  batchLimit: number,
): Promise<{ removed: number; failed: number }> {
  return built(olderThan, batchLimit);
}
