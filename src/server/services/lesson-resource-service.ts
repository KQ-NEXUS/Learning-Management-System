/**
 * LessonResource — the request-path operations for lesson file attachments
 * (CAT-04 / D-28).
 *
 * A LessonResource has no permission of its own: every operation gates on the
 * grandparent Course's `courses.*`, resolved by querying
 * LessonResource -> Lesson -> Module -> Course rather than trusting a
 * caller-supplied id (T-04-11 pattern, same as Module and Lesson).
 *
 * The scan-verdict operations do NOT live here — they run in a process with no
 * request context and are deliberately unauthorized. See
 * `scan-system-service.ts`.
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

/** The parent lesson's course (for scope) and type (for the download TTL). */
export type LessonContext = { courseId: string; type: string };

/** Thrown by `getDownloadableResource` when the file is not yet scanned clean. */
export class ResourceNotScannedError extends Error {
  constructor() {
    super("This file is still being scanned. Try again in a moment.");
    this.name = "ResourceNotScannedError";
  }
}

/** Thrown by `getDownloadableResource` when the file is INFECTED or errored. */
export class ResourceInfectedError extends Error {
  constructor() {
    super("This file did not pass a security scan and cannot be downloaded.");
    this.name = "ResourceInfectedError";
  }
}

export type CreateLessonResourceServiceDeps = {
  delegate: LessonResourceDelegate;
  /**
   * Resolves a Lesson id to its parent Course id and its LessonType. Production
   * queries Prisma (`Lesson -> Module -> Course`); tests inject an in-memory
   * lookup. Null when the Lesson does not exist.
   */
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

  // Built on the factory for `get`/`list` parity. No `archiveData`/`restoreData`:
  // LessonResource has neither a `status` nor a `withdrawnAt` column, so the
  // factory's `archive` would write a column that does not exist. It is not
  // re-exported from this module. An INFECTED file is marked, never deleted
  // (`markScanResult` in scan-system-service.ts) and stays visible to staff.
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
        // Attribution is taken from the authenticated actor, never the request
        // (T-04-28).
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

    // CLEAN only from here. The parent lesson's type drives the presign TTL
    // (D-37), so it is resolved alongside the row rather than in a second
    // query from the Route Handler.
    const context = await resolveLessonContext(row.lessonId);
    return { ...row, lesson: { type: context?.type ?? "FILE" } };
  });

  return {
    lessonResourceScope,
    lessonResourceService,
    createLessonResource,
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
export const getDownloadableResource = built.getDownloadableResource;
