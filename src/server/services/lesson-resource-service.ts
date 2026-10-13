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
 * `UPLOADING` or `ERROR` resource is simply not downloadable. `READY` is the
 * only "clean" state a resource has: every reader below (download, captions)
 * refuses anything else.
 *
 * NFR-09 (plan 15-23): a WebVTT caption track is a `text/vtt` resource linked to
 * one VIDEO resource of the same lesson through `captionForResourceId`. Captions
 * never appear in the ordinary resource lists (`listLessonResources*`), so the
 * "first resource is the file / video" rule the lesson renderer relies on is
 * unchanged; they have their own lists and their own same-origin reader.
 */

import { prisma } from "@/server/db";
import {
  withPermission,
  AuthenticationError,
  AuthorizationError,
} from "@/server/permissions";
import {
  UPLOAD_LIMITS,
  isValidCaptionLanguage,
  CAPTION_LABEL_MAX_LENGTH,
  CAPTION_FILE_MESSAGE,
  CAPTION_LANGUAGE_MESSAGE,
  CAPTION_LABEL_MESSAGE,
  CAPTION_PARENT_MESSAGE,
  validateUpload,
} from "@/lib/upload-limits";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission, Actor } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import { assertLessonOpenable, canOpenLessonAsLearner, type LearnerPath } from "@/server/services/learner-access";
import {
  inspectLessonObject,
  promoteLessonObject,
  deleteLessonObject,
  finalStorageKeyFor,
  readLessonObjectBounded,
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
  /** NFR-09 — set on a caption track: the VIDEO resource it captions. */
  captionForResourceId?: string | null;
  /** NFR-09 — BCP 47 language tag of a caption track. */
  captionLanguage?: string | null;
  /** NFR-09 — menu label of a caption track. */
  captionLabel?: string | null;
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

/**
 * Thrown by `beginLessonResourceUpload` when a caption upload names no valid
 * parent video, or carries a bad language, label, type or size. The message is
 * safe to show to the author.
 */
export class CaptionAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptionAttachmentError";
  }
}

const UNVERIFIED_DETAIL ="The uploaded object could not be verified.";
const MISMATCH_DETAIL = "The stored file does not match its upload request.";

export type LessonResourceStorage = {
  inspect(key: string): Promise<{ sizeBytes: bigint; contentType: string | null }>;
  promote(input: { stagedKey: string; finalKey: string }): Promise<void>;
  delete(key: string): Promise<void>;
  finalKey(stagedKey: string): string;
  /** Bounded read of one small object (caption files); throws when over `maxBytes`. */
  readBounded(key: string, maxBytes: number): Promise<Uint8Array>;
};

export type CreateLessonResourceServiceDeps = {
  delegate: LessonResourceDelegate;
  resolveLessonContext: (lessonId: string) => Promise<LessonContext | null>;
  withPermission: WithPermissionFn;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  storage: LessonResourceStorage;
  /** Injected so the learner predicate is unit-testable without a database (D-07/09-03). */
  /**
   * F-01 — may this learner open this lesson right now (pinned, unlocked,
   * access window open)? Bound to `learner-access.ts#canOpenLessonAsLearner`.
   */
  canOpenLesson: (actor: Actor, lessonId: string) => Promise<boolean>;
  /**
   * Whether a path the caller already loaded for themselves opens this lesson. Used instead of
   * `canOpenLesson` when the caller passes `verifiedPath`, which saves reloading the whole path
   * (plan 15-28, ledger P-09). Left out, `verifiedPath` is ignored and `canOpenLesson` decides.
   */
  lessonOpensInPath?: (path: LearnerPath, lessonId: string) => boolean;
  now?: () => Date;
};

/** Optional proof the learner pages pass so the lesson is not authorised twice in one render. */
export type LearnerReadOptions = {
  /** The caller's own path from `loadLearnerPath(actor, ...)` in the same request. */
  verifiedPath?: LearnerPath;
};

export type BeginLessonResourceUploadInput = {
  lessonId: string;
  title: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  /** Present only for a caption upload (NFR-09). */
  caption?: { forResourceId: string; language: string; label: string };
};

/** One caption track as the learner player needs it (no storage key). */
export type CaptionTrackRecord = {
  id: string;
  /** The VIDEO resource this track belongs to. */
  videoResourceId: string;
  language: string;
  label: string;
};

/** A caption file ready to serve: the VTT text plus its identity. */
export type CaptionFile = { id: string; body: string };

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

  /**
   * The learner gate for the two reads above. A path the caller loaded for themselves that opens
   * the lesson is enough; a path that does not open it, or no path, runs the full check.
   */
  async function mayOpenLesson(actor: Actor, lessonId: string, options?: LearnerReadOptions): Promise<boolean> {
    if (options?.verifiedPath && deps.lessonOpensInPath?.(options.verifiedPath, lessonId)) return true;
    return deps.canOpenLesson(actor, lessonId);
  }

  const lessonResourceService = createResourceService<LessonResourceRecord>({
    name: "LessonResource",
    delegate,
    permissions: { view: "courses.view", create: "courses.edit", edit: "courses.edit" },
    toScope: lessonResourceScope,
    withPermission: deps.withPermission,
    audit: deps.audit,
  });

  /**
   * NFR-09 — the rules a caption upload must satisfy, enforced here (not only in
   * the route) so no caller can attach a track the player would mishandle: the
   * file is text/vtt within the CAPTION cap, the parent is an ordinary resource of
   * a VIDEO lesson in the SAME lesson as the caption, and language and label are
   * well formed. Returns the three columns to store.
   */
  async function validatedCaptionFields(
    input: BeginLessonResourceUploadInput,
    caption: NonNullable<BeginLessonResourceUploadInput["caption"]>,
  ) {
    const language = caption.language.trim();
    const label = caption.label.trim();

    const check = validateUpload({
      lessonType: "CAPTION",
      mimeType: input.mimeType,
      sizeBytes: Number(input.sizeBytes),
    });
    if (!check.ok) throw new CaptionAttachmentError(CAPTION_FILE_MESSAGE);
    if (!isValidCaptionLanguage(language)) {
      throw new CaptionAttachmentError(CAPTION_LANGUAGE_MESSAGE);
    }
    if (label.length < 1 || label.length > CAPTION_LABEL_MAX_LENGTH) {
      throw new CaptionAttachmentError(CAPTION_LABEL_MESSAGE);
    }

    const parent = await delegate.findUnique({ where: { id: caption.forResourceId } });
    const context = parent ? await resolveLessonContext(parent.lessonId) : null;
    if (
      !parent ||
      parent.lessonId !== input.lessonId ||
      parent.captionForResourceId != null ||
      context?.type !== "VIDEO"
    ) {
      throw new CaptionAttachmentError(CAPTION_PARENT_MESSAGE);
    }

    return {
      captionForResourceId: parent.id,
      captionLanguage: language,
      captionLabel: label,
    };
  }

  const beginLessonResourceUpload = deps.withPermission<BeginLessonResourceUploadInput>(
    "courses.edit",
    async (input) => {
      const context = await resolveLessonContext(input.lessonId);
      return { courseIds: context ? [context.courseId] : [] };
    },
  )(async (input, ctx) => {
    const captionFields = input.caption ? await validatedCaptionFields(input, input.caption) : {};

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
        ...captionFields,
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

    // The database cascade removes a video's caption rows; their objects must go
    // with them or they would be orphaned in storage.
    const captionRows = (await delegate.findMany({ where: { captionForResourceId: id } })).filter(
      (row) => row.captionForResourceId === id,
    );
    for (const key of [before.storageKey, ...captionRows.map((row) => row.storageKey)]) {
      try {
        await storage.delete(key);
      } catch (error) {
        console.error(`[lesson-resource] storage delete failed for ${before.id}`, error);
      }
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

  /**
   * NFR-09 — remove one caption track (plan 15-24). Same editing permission and
   * scope path as `removeLessonResource`, but it refuses anything that is not a
   * caption so the caption control can never delete a lesson's file or video. The
   * stored object goes with the row; a failed object delete is logged and does not
   * keep the row, matching `removeLessonResource`.
   */
  const removeCaption = deps.withPermission<string>(
    "courses.edit",
    (id) => lessonResourceScope(id),
  )(async (id, ctx): Promise<void> => {
    const before = await delegate.findUnique({ where: { id } });
    if (!before) return;
    if (before.captionForResourceId == null) {
      throw new CaptionAttachmentError("Only caption files can be removed here.");
    }

    try {
      await storage.delete(before.storageKey);
    } catch (error) {
      console.error(`[lesson-resource] caption storage delete failed for ${before.id}`, error);
    }
    await delegate.delete({ where: { id } });

    await deps.audit({
      action: "lessonresource.caption_removed",
      targetType: "LessonResource",
      targetId: id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before,
      after: null,
    });
  });

  /**
   * The shared find-filter-sort body behind BOTH `listLessonResources`
   * (staff, `courses.view`) and `listLessonResourcesForLearner` (DD-26,
   * ownership) — factored once so the ordering rule cannot drift between
   * the two entry points, mirroring `shapeDownloadable`'s identical reason
   * for existing.
   */
  async function sortedLessonResources(lessonId: string): Promise<LessonResourceRecord[]> {
    // Caption tracks are separate rows of the same table; they are listed by
    // `listLessonCaptions*` and never here, so the lesson renderer's "first
    // resource" is always the file, image or video itself.
    const rows = await delegate.findMany({ where: { lessonId, captionForResourceId: null } });
    return rows
      .filter((row) => row.lessonId === lessonId && row.captionForResourceId == null)
      .sort((left, right) => left.position - right.position);
  }

  async function captionRowsForLesson(lessonId: string): Promise<LessonResourceRecord[]> {
    const rows = await delegate.findMany({ where: { lessonId, captionForResourceId: { not: null } } });
    return rows
      .filter((row) => row.lessonId === lessonId && row.captionForResourceId != null)
      .sort(
        (left, right) =>
          left.position - right.position || left.createdAt.getTime() - right.createdAt.getTime(),
      );
  }

  function toCaptionTrack(row: LessonResourceRecord): CaptionTrackRecord {
    return {
      id: row.id,
      videoResourceId: row.captionForResourceId as string,
      language: row.captionLanguage ?? "",
      label: row.captionLabel ?? "",
    };
  }

  /**
   * Staff (`courses.view`) view of a lesson's caption tracks in every upload
   * state, so the authoring panel can show an upload in progress or a failure.
   */
  const listLessonCaptions = deps.withPermission<string>(
    "courses.view",
    async (lessonId) => {
      const context = await resolveLessonContext(lessonId);
      return { courseIds: context ? [context.courseId] : [] };
    },
  )(async (lessonId) => (await captionRowsForLesson(lessonId)).map((row) => ({
    ...toCaptionTrack(row),
    uploadStatus: row.uploadStatus,
    uploadDetail: row.uploadDetail,
  })));

  /**
   * The caption tracks a learner's player may offer: READY ones only, and only
   * when the learner may open the lesson. Same ownership rule as
   * `listLessonResourcesForLearner` (deliberately not `withPermission`-wrapped).
   */
  async function listLessonCaptionsForLearner(
    actor: Actor,
    lessonId: string,
    options?: LearnerReadOptions,
  ): Promise<CaptionTrackRecord[]> {
    const context = await resolveLessonContext(lessonId);
    if (!context) return [];
    if (!(await mayOpenLesson(actor, lessonId, options))) return [];
    const rows = await captionRowsForLesson(lessonId);
    return rows.filter((row) => row.uploadStatus === "READY").map(toCaptionTrack);
  }

  const listLessonResources = deps.withPermission<string>(
    "courses.view",
    async (lessonId) => {
      const context = await resolveLessonContext(lessonId);
      return { courseIds: context ? [context.courseId] : [] };
    },
  )((lessonId) => sortedLessonResources(lessonId));

  /**
   * DD-26 — the ownership-scoped sibling read `listLessonResources` cannot
   * serve: `listLessonResources` is `courses.view`-wrapped, and a learner
   * has no such grant (nor should be given one — a matched grant is not
   * action-scoped once matched, so widening it would hand a learner every
   * other course-scoped staff action). Deliberately NOT wrapped in
   * `withPermission`, same reasoning as `getDownloadableResourceForLearner`
   * above. Returns `[]` (never throws) for a non-enrolled actor or an
   * unknown lesson id — both cases indistinguishable to the caller by
   * design — and otherwise the SAME ordered rows the staff path returns via
   * the shared `sortedLessonResources` helper.
   */
  async function listLessonResourcesForLearner(
    actor: Actor,
    lessonId: string,
    options?: LearnerReadOptions,
  ): Promise<LessonResourceRecord[]> {
    const context = await resolveLessonContext(lessonId);
    if (!context) return [];

    const authorized = await mayOpenLesson(actor, lessonId, options);
    if (!authorized) return [];

    return sortedLessonResources(lessonId);
  }

  /**
   * The shared shaping step behind BOTH `getDownloadableResource` (staff,
   * `courses.view`) and `getDownloadableResourceForLearner` (ownership,
   * ACTIVE enrolment) — written once so the `UPLOADING` / non-`READY`
   * refusal cannot be bypassed by entering through whichever predicate was
   * NOT updated (RESEARCH Pitfall 1). Returns `null` for an unknown id;
   * throws `ResourceUploadPendingError` / `ResourceUploadUnavailableError`
   * for a row whose upload has not finished or failed.
   */
  async function shapeDownloadable(id: string): Promise<DownloadableResource | null> {
    const row = await delegate.findUnique({ where: { id } });
    if (!row) return null;
    if (row.uploadStatus === "UPLOADING") throw new ResourceUploadPendingError();
    if (row.uploadStatus !== "READY") throw new ResourceUploadUnavailableError();

    const context = await resolveLessonContext(row.lessonId);
    return { ...row, lesson: { type: context?.type ?? "FILE" } };
  }

  const getDownloadableResource = deps.withPermission<string>(
    "courses.view",
    (id) => lessonResourceScope(id),
  )((id) => shapeDownloadable(id));

  /**
   * DD-14 / RESEARCH Pitfall 1: the second, ownership-based predicate for
   * LRN-03. Deliberately NOT wrapped in `withPermission` and never consults
   * a grant — granting a learner `courses.view` instead would hand them
   * every other course-scoped staff action, because a matched grant is not
   * action-scoped once matched. The predicate here differs from the staff
   * path (ACTIVE enrolment covering the lesson's course, not a permission
   * grant) but everything after the predicate — the upload-status checks,
   * the row shape, the `null` for "not found" — is deliberately shared via
   * `shapeDownloadable` so the two paths can never drift apart.
   *
   * Returns `null` (never throws an authorization error) for both an
   * unknown resource id and a signed-in caller with no ACTIVE enrolment
   * covering the lesson's course — the two cases are indistinguishable to
   * the caller by design.
   */
  async function getDownloadableResourceForLearner(
    actor: Actor,
    id: string,
  ): Promise<DownloadableResource | null> {
    const row = await delegate.findUnique({ where: { id } });
    if (!row) return null;

    const context = await resolveLessonContext(row.lessonId);
    if (!context) return null;

    const authorized = await deps.canOpenLesson(actor, row.lessonId);
    if (!authorized) return null;

    return shapeDownloadable(id);
  }

  const staffCanViewResource = deps.withPermission<string>(
    "courses.view",
    (id) => lessonResourceScope(id),
  )(async () => true);

  /**
   * NFR-09 / NFR-06 — the caption file for one track, or `null`. Authorises
   * exactly like the download route: staff `courses.view` on the resource's
   * course first (an authentication or authorisation failure falls through),
   * then a learner who may open the lesson. Every refusal is the same `null`:
   * unknown id, a resource that is not a caption, a caption that is not READY
   * (UPLOADING or ERROR), no access. The body is read with a size bound.
   * `actor` is `null` when there is no session.
   */
  async function readCaptionForLearnerOrStaff(
    actor: Actor | null,
    id: string,
  ): Promise<CaptionFile | null> {
    const row = await delegate.findUnique({ where: { id } });
    if (!row || row.captionForResourceId == null || row.uploadStatus !== "READY") return null;
    if (row.sizeBytes > BigInt(UPLOAD_LIMITS.CAPTION.maxBytes)) return null;

    let allowed = await staffCanViewResource(id).catch((err) => {
      if (err instanceof AuthenticationError || err instanceof AuthorizationError) return false;
      throw err;
    });
    if (!allowed && actor) {
      const context = await resolveLessonContext(row.lessonId);
      allowed = context !== null && (await deps.canOpenLesson(actor, row.lessonId));
    }
    if (!allowed) return null;

    let bytes: Uint8Array;
    try {
      bytes = await storage.readBounded(row.storageKey, UPLOAD_LIMITS.CAPTION.maxBytes);
    } catch (error) {
      console.error(`[lesson-resource] caption read failed for ${row.id}`, error);
      return null;
    }
    return { id: row.id, body: new TextDecoder("utf-8").decode(bytes) };
  }

  return {
    lessonResourceScope,
    lessonResourceService,
    beginLessonResourceUpload,
    completeLessonResourceUpload,
    removeLessonResource,
    removeCaption,
    listLessonResources,
    listLessonResourcesForLearner,
    getDownloadableResource,
    getDownloadableResourceForLearner,
    listLessonCaptions,
    listLessonCaptionsForLearner,
    readCaptionForLearnerOrStaff,
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
    readBounded: readLessonObjectBounded,
  },
  canOpenLesson: canOpenLessonAsLearner,
  lessonOpensInPath: (path, lessonId) => assertLessonOpenable(path, lessonId).ok,
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
export const removeCaption = built.removeCaption;
export const listLessonResources = built.listLessonResources;
export const listLessonResourcesForLearner = built.listLessonResourcesForLearner;
export const getDownloadableResource = built.getDownloadableResource;
export const getDownloadableResourceForLearner = built.getDownloadableResourceForLearner;
export const listLessonCaptions = built.listLessonCaptions;
export const listLessonCaptionsForLearner = built.listLessonCaptionsForLearner;
export const readCaptionForLearnerOrStaff = built.readCaptionForLearnerOrStaff;
