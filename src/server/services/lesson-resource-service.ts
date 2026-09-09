/**
 * LessonResource — request-path operations for lesson file attachments
 * (CAT-04 / D-28).
 *
 * A resource has no permission of its own: every operation resolves through
 * LessonResource -> Lesson -> Module -> Course rather than trusting scope from
 * the caller. Scan verdict writes remain in scan-system-service.ts because the
 * worker has no request/session context.
 */

import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";

export type ScanStatusValue = "PENDING" | "CLEAN" | "INFECTED" | "ERROR";

export type LessonResourceRecord = {
  id: string;
  lessonId: string;
  title: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  scanStatus: ScanStatusValue;
  uploadedById: string | null;
  scannedAt: Date | null;
  scanDetail: string | null;
  position: number;
  createdAt: Date;
};

export type LessonResourceDelegate = Delegate<LessonResourceRecord>;

type WithPermissionFn = ReturnType<typeof createWithPermission>;

/** The parent lesson's course (for scope) and type (for download TTL). */
export type LessonContext = { courseId: string; type: string };

/** Thrown by `getDownloadableResource` while a file is not yet clean. */
export class ResourceNotScannedError extends Error {
  constructor() {
    super("This file is still being scanned. Try again in a moment.");
    this.name = "ResourceNotScannedError";
  }
}

/** Thrown by `getDownloadableResource` when the file cannot be downloaded. */
export class ResourceInfectedError extends Error {
  constructor() {
    super("This file did not pass a security scan and cannot be downloaded.");
    this.name = "ResourceInfectedError";
  }
}

/** Only ERROR is retriable; CLEAN/INFECTED are final and PENDING is active. */
export class ResourceRetryNotAllowedError extends Error {
  constructor() {
    super("Only a resource with a scan error can be retried.");
    this.name = "ResourceRetryNotAllowedError";
  }
}

export type CreateLessonResourceServiceDeps = {
  delegate: LessonResourceDelegate;
  resolveLessonContext: (lessonId: string) => Promise<LessonContext | null>;
  withPermission: WithPermissionFn;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
};

export type DownloadableResource = LessonResourceRecord & { lesson: { type: string } };

export function createLessonResourceService(deps: CreateLessonResourceServiceDeps) {
  const { delegate, resolveLessonContext } = deps;

  async function lessonResourceScope(id: string): Promise<ResourceScope> {
    const row = await delegate.findUnique({ where: { id } });
    if (!row) return { courseIds: [] };
    const context = await resolveLessonContext(row.lessonId);
    return { courseIds: context ? [context.courseId] : [] };
  }

  const lessonResourceService = createResourceService<LessonResourceRecord>({
    name: "LessonResource",
    delegate,
    permissions: { view: "courses.view", create: "courses.edit", edit: "courses.edit" },
    toScope: lessonResourceScope,
    withPermission: deps.withPermission,
    audit: deps.audit,
  });

  const createLessonResource = deps.withPermission<{
    lessonId: string;
    title: string;
    storageKey: string;
    filename: string;
    mimeType: string;
    sizeBytes: bigint;
  }>("courses.edit", async (input) => {
    const context = await resolveLessonContext(input.lessonId);
    return { courseIds: context ? [context.courseId] : [] };
  })(async (input, ctx) => {
    const created = await delegate.create({
      data: {
        lessonId: input.lessonId,
        title: input.title,
        storageKey: input.storageKey,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        scanStatus: "PENDING",
        uploadedById: ctx.actor.userId,
      },
    });

    await deps.audit({
      action: "lessonresource.created",
      targetType: "LessonResource",
      targetId: created.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      after: created,
    });
    return created;
  });

  const listLessonResources = deps.withPermission<string>(
    "courses.view",
    async (lessonId) => {
      const context = await resolveLessonContext(lessonId);
      return { courseIds: context ? [context.courseId] : [] };
    },
  )(async (lessonId) => {
    const rows = await delegate.findMany({ where: { lessonId } });
    return rows
      .filter((row) => row.lessonId === lessonId)
      .sort((left, right) => left.position - right.position);
  });

  const retryLessonResource = deps.withPermission<string>(
    "courses.edit",
    (id) => lessonResourceScope(id),
  )(async (id, ctx) => {
    const before = await delegate.findUnique({ where: { id } });
    if (!before || before.scanStatus !== "ERROR") {
      throw new ResourceRetryNotAllowedError();
    }

    // The row keeps its original `createdAt`, so a retried row immediately looks
    // "stuck" to `findStuckPending` (scan-system-service.ts) and the
    // reconciliation cron may re-enqueue it once before the worker clears
    // PENDING. That is harmless — `markScanResult` is idempotent, so the second
    // verdict is a no-op write. Tightening this would need a `scanRequestedAt`
    // column keyed by the enqueue, which is out of scope here.
    const after = await delegate.update({
      where: { id },
      data: { scanStatus: "PENDING", scannedAt: null, scanDetail: null },
    });
    await deps.audit({
      action: "lessonresource.scan_retry_requested",
      targetType: "LessonResource",
      targetId: id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before,
      after,
    });
    return after;
  });

  // Compensating write for the retry Route Handler. `retryLessonResource` has
  // already flipped the row to PENDING and audited it, but the route's
  // subsequent `enqueueScan` threw — so no job exists and nothing will move the
  // row off PENDING except the reconciliation cron, minutes later
  // (`findStuckPending` in scan-system-service.ts). Put the row back to ERROR
  // now with a truthful detail so the staff UI shows the failure immediately
  // and the Retry control stays available. No-ops if the row has already left
  // PENDING (a racing worker or sweep got there first).
  const markRetryEnqueueFailed = deps.withPermission<string>(
    "courses.edit",
    (id) => lessonResourceScope(id),
  )(async (id, ctx) => {
    const before = await delegate.findUnique({ where: { id } });
    if (!before || before.scanStatus !== "PENDING") {
      return before;
    }

    const after = await delegate.update({
      where: { id },
      data: {
        scanStatus: "ERROR",
        scanDetail: "The scan could not be queued. Try again in a moment.",
        scannedAt: null,
      },
    });
    await deps.audit({
      action: "lessonresource.scan_retry_enqueue_failed",
      targetType: "LessonResource",
      targetId: id,
      actorId: ctx.actor.userId,
      outcome: "FAILURE",
      reason: "scan enqueue failed after retry",
      before,
      after,
    });
    return after;
  });

  const getDownloadableResource = deps.withPermission<string>(
    "courses.view",
    (id) => lessonResourceScope(id),
  )(async (id): Promise<DownloadableResource | null> => {
    const row = await delegate.findUnique({ where: { id } });
    if (!row) return null;
    if (row.scanStatus === "PENDING") throw new ResourceNotScannedError();
    if (row.scanStatus === "INFECTED" || row.scanStatus === "ERROR") {
      throw new ResourceInfectedError();
    }

    const context = await resolveLessonContext(row.lessonId);
    return { ...row, lesson: { type: context?.type ?? "FILE" } };
  });

  return {
    lessonResourceScope,
    lessonResourceService,
    createLessonResource,
    listLessonResources,
    retryLessonResource,
    markRetryEnqueueFailed,
    getDownloadableResource,
  };
}

const built = createLessonResourceService({
  delegate: prisma.lessonResource as unknown as LessonResourceDelegate,
  resolveLessonContext: async (lessonId) => {
    const row = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { type: true, module: { select: { courseId: true } } },
    });
    if (!row) return null;
    return { courseId: row.module.courseId, type: row.type };
  },
  withPermission,
  audit: (entry) =>
    recordAudit({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      outcome: entry.outcome,
    }),
});

export const lessonResourceScope = built.lessonResourceScope;
export const lessonResourceService = built.lessonResourceService;
export const createLessonResource = built.createLessonResource;
export const listLessonResources = built.listLessonResources;
export const retryLessonResource = built.retryLessonResource;
export const markRetryEnqueueFailed = built.markRetryEnqueueFailed;
export const getDownloadableResource = built.getDownloadableResource;
