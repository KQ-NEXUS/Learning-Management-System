/**
 * LessonResource — request-path operations for lesson file attachments
 * (CAT-04 / D-28).
 *
 * A resource has no permission of its own: every operation resolves through
 * LessonResource -> Lesson -> Module -> Course rather than trusting scope from
 * the caller.
 *
 * The upload is a three-step flow. `beginLessonResourceUpload` creates an
 * `UPLOADING` row and the route hands back a presigned `PUT`;
 * `completeLessonResourceUpload` verifies the stored object against the row's
 * declared metadata, promotes the staged object to a final key the browser
 * could never write, and marks the row `READY`. Nothing here scans — an
 * `UPLOADING` or `ERROR` resource is simply not downloadable.
 */

import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import {
  inspectLessonObject,
  promoteLessonObject,
  deleteLessonObject,
  finalStorageKeyFor,
} from "@/server/services/storage-service";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";

export type UploadStatusValue = "UPLOADING" | "READY" | "ERROR";

export type LessonResourceRecord = {
  id: string;
  lessonId: string;
  title: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  uploadStatus: UploadStatusValue;
  uploadedById: string | null;
  uploadedAt: Date | null;
  uploadDetail: string | null;
  position: number;
  createdAt: Date;
};

/** The lesson-resource delegate also deletes rows — a staff removal and the
 * scheduled stale-upload sweep both hard-delete an unpromoted attachment. */
export type LessonResourceDelegate = Delegate<LessonResourceRecord> & {
  delete(args: { where: { id: string } }): Promise<LessonResourceRecord>;
};

type WithPermissionFn = ReturnType<typeof createWithPermission>;

/** The parent lesson's course (for scope) and type (for download TTL). */
export type LessonContext = { courseId: string; type: string };

/** Thrown by `getDownloadableResource` while an upload has not completed. */
export class ResourceUploadPendingError extends Error {
  constructor(message = "This upload is not ready yet.") {
    super(message);
    this.name = "ResourceUploadPendingError";
  }
}

/** Thrown when a resource is in a state from which it can never be served. */
export class ResourceUploadUnavailableError extends Error {
  constructor(message = "This resource is unavailable.") {
    super(message);
    this.name = "ResourceUploadUnavailableError";
  }
}

/**
 * Thrown by `completeLessonResourceUpload` when the stored object cannot be
 * verified against the row. Carries the now-`ERROR` row so the route can echo
 * it back to the authoring UI.
 */
export class ResourceUploadValidationError extends Error {
  constructor(
    message: string,
    readonly resource: LessonResourceRecord,
  ) {
    super(message);
    this.name = "ResourceUploadValidationError";
  }
}

const UNVERIFIED_DETAIL = "The uploaded object could not be verified.";
const MISMATCH_DETAIL = "The stored file does not match its upload request.";

export type LessonResourceStorage = {
  inspect(key: string): Promise<{ sizeBytes: bigint; contentType: string | null }>;
  promote(input: { stagedKey: string; finalKey: string }): Promise<void>;
  delete(key: string): Promise<void>;
  finalKey(stagedKey: string): string;
};

export type CreateLessonResourceServiceDeps = {
  delegate: LessonResourceDelegate;
  resolveLessonContext: (lessonId: string) => Promise<LessonContext | null>;
  withPermission: WithPermissionFn;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  storage: LessonResourceStorage;
  now?: () => Date;
};

export type BeginLessonResourceUploadInput = {
  lessonId: string;
  title: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
};

export type DownloadableResource = LessonResourceRecord & { lesson: { type: string } };

export function createLessonResourceService(deps: CreateLessonResourceServiceDeps) {
  const { delegate, resolveLessonContext, storage } = deps;
  const now = deps.now ?? (() => new Date());

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

  const beginLessonResourceUpload = deps.withPermission<BeginLessonResourceUploadInput>(
    "courses.edit",
    async (input) => {
      const context = await resolveLessonContext(input.lessonId);
      return { courseIds: context ? [context.courseId] : [] };
    },
  )(async (input, ctx) => {
    const created = await delegate.create({
      data: {
        lessonId: input.lessonId,
        title: input.title,
        storageKey: input.storageKey,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadStatus: "UPLOADING",
        uploadedById: ctx.actor.userId,
      },
    });

    await deps.audit({
      action: "lessonresource.upload_started",
      targetType: "LessonResource",
      targetId: created.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      after: created,
    });
    return created;
  });

  const completeLessonResourceUpload = deps.withPermission<string>(
    "courses.edit",
    (id) => lessonResourceScope(id),
  )(async (id, ctx): Promise<LessonResourceRecord> => {
    const before = await delegate.findUnique({ where: { id } });
    if (!before) throw new ResourceUploadUnavailableError();
    if (before.uploadStatus === "READY") return before;
    if (before.uploadStatus !== "UPLOADING") throw new ResourceUploadUnavailableError();

    // Capture the staged key before any write: the `before` row is promoted in
    // place, so reading `before.storageKey` afterwards would give the final key.
    const stagedKey = before.storageKey;

    const failUpload = async (detail: string): Promise<LessonResourceRecord> => {
      const failed = await delegate.update({
        where: { id: before.id },
        data: { uploadStatus: "ERROR", uploadDetail: detail, uploadedAt: null },
      });
      await deps.audit({
        action: "lessonresource.upload_failed",
        targetType: "LessonResource",
        targetId: before.id,
        actorId: ctx.actor.userId,
        outcome: "FAILURE",
        reason: detail,
        before,
        after: failed,
      });
      return failed;
    };

    const cleanupStaged = async () => {
      try {
        await storage.delete(stagedKey);
      } catch (error) {
        console.error(`[lesson-resource] invalid staged cleanup failed for ${before.id}`, error);
      }
    };

    let stored: { sizeBytes: bigint; contentType: string | null };
    try {
      stored = await storage.inspect(stagedKey);
    } catch {
      await cleanupStaged();
      throw new ResourceUploadValidationError(UNVERIFIED_DETAIL, await failUpload(UNVERIFIED_DETAIL));
    }

    const contentType = before.mimeType.trim().toLowerCase();
    if (stored.sizeBytes !== before.sizeBytes || stored.contentType !== contentType) {
      await cleanupStaged();
      throw new ResourceUploadValidationError(MISMATCH_DETAIL, await failUpload(MISMATCH_DETAIL));
    }

    const finalKey = storage.finalKey(stagedKey);
    await storage.promote({ stagedKey, finalKey });
    const after = await delegate.update({
      where: { id: before.id },
      data: {
        storageKey: finalKey,
        uploadStatus: "READY",
        uploadedAt: now(),
        uploadDetail: null,
      },
    });
    await deps.audit({
      action: "lessonresource.upload_completed",
      targetType: "LessonResource",
      targetId: after.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before,
      after,
    });
    try {
      await storage.delete(stagedKey);
    } catch (error) {
      console.error(`[lesson-resource] staged cleanup failed for ${before.id}`, error);
    }
    return after;
  });

  const removeLessonResource = deps.withPermission<string>(
    "courses.edit",
    (id) => lessonResourceScope(id),
  )(async (id, ctx): Promise<void> => {
    const before = await delegate.findUnique({ where: { id } });
    if (!before) return;

    try {
      await storage.delete(before.storageKey);
    } catch (error) {
      console.error(`[lesson-resource] storage delete failed for ${before.id}`, error);
    }
    await delegate.delete({ where: { id } });

    await deps.audit({
      action: "lessonresource.removed",
      targetType: "LessonResource",
      targetId: id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before,
      after: null,
    });
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

  const getDownloadableResource = deps.withPermission<string>(
    "courses.view",
    (id) => lessonResourceScope(id),
  )(async (id): Promise<DownloadableResource | null> => {
    const row = await delegate.findUnique({ where: { id } });
    if (!row) return null;
    if (row.uploadStatus === "UPLOADING") throw new ResourceUploadPendingError();
    if (row.uploadStatus !== "READY") throw new ResourceUploadUnavailableError();

    const context = await resolveLessonContext(row.lessonId);
    return { ...row, lesson: { type: context?.type ?? "FILE" } };
  });

  return {
    lessonResourceScope,
    lessonResourceService,
    beginLessonResourceUpload,
    completeLessonResourceUpload,
    removeLessonResource,
    listLessonResources,
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
  storage: {
    inspect: inspectLessonObject,
    promote: promoteLessonObject,
    delete: deleteLessonObject,
    finalKey: finalStorageKeyFor,
  },
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
export const beginLessonResourceUpload = built.beginLessonResourceUpload;
export const completeLessonResourceUpload = built.completeLessonResourceUpload;
export const removeLessonResource = built.removeLessonResource;
export const listLessonResources = built.listLessonResources;
export const getDownloadableResource = built.getDownloadableResource;
