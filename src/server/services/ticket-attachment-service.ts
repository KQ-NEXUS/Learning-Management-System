/**
 * Support-ticket attachments — private direct-upload lifecycle (SUP-01/02).
 *
 * Visibility is never accepted from the caller: it is derived from the parent
 * TicketMessage. Learners may only touch PUBLIC messages of their own tickets;
 * staff need `tickets.manage` (intent/complete) or `tickets.view`/`manage`
 * (download). Every authorization failure surfaces as the same
 * `TicketAttachmentNotFoundError` so internal-note existence never leaks.
 * There is no malware scanning: a file is READY once stored type and size
 * match the intent, and no `clean` status is claimed.
 */

import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import {
  buildStagedTicketAttachmentKey,
  deleteLessonObject,
  finalTicketAttachmentKeyFor,
  inspectLessonObject,
  presignLessonUploadUrl,
  promoteLessonObject,
} from "@/server/services/storage-service";
import {
  TICKET_MAX_ATTACHMENTS_PER_MESSAGE,
  UPLOAD_URL_TTL_SECONDS,
  validateTicketUpload,
} from "@/lib/upload-limits";

export type TicketAttachmentStatus = "UPLOADING" | "READY" | "ERROR";

export type TicketAttachmentRow = {
  id: string;
  ticketId: string;
  messageId: string;
  uploadedById: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  uploadStatus: TicketAttachmentStatus;
};

export type TicketMessageAuthContext = {
  id: string;
  ticketId: string;
  visibility: "PUBLIC" | "INTERNAL";
  ticketOwnerId: string;
};

export type TicketAttachmentRepository = {
  findMessage(messageId: string): Promise<TicketMessageAuthContext | null>;
  /** Atomically enforces the per-message cap; returns null when full. */
  createIfUnderCap(
    data: Omit<TicketAttachmentRow, "id" | "uploadStatus">,
    cap: number,
  ): Promise<TicketAttachmentRow | null>;
  findAttachment(
    id: string,
  ): Promise<(TicketAttachmentRow & { message: TicketMessageAuthContext }) | null>;
  /** Conditional UPLOADING -> READY; false when the row was no longer UPLOADING. */
  markReady(id: string, finalKey: string): Promise<boolean>;
  markError(id: string, detail: string): Promise<void>;
};

export type TicketAttachmentStorage = {
  buildStagedKey(ticketId: string): string;
  finalKey(stagedKey: string): string;
  presignPut(input: { key: string; contentType: string }): Promise<string>;
  inspect(key: string): Promise<{ sizeBytes: bigint; contentType: string | null }>;
  promote(input: { stagedKey: string; finalKey: string }): Promise<void>;
  delete(key: string): Promise<void>;
};

export type TicketAttachmentServiceDeps = {
  repository: TicketAttachmentRepository;
  storage: TicketAttachmentStorage;
  getActor: () => Promise<Actor | null>;
  hasPermission: (permission: "tickets.view" | "tickets.manage") => Promise<boolean>;
  audit: (event: {
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    outcome: string;
    reason?: string | null;
  }) => Promise<void>;
};

/** Every auth/existence/visibility/status failure — deliberately one type. */
export class TicketAttachmentNotFoundError extends Error {
  constructor() {
    super("Attachment not found.");
    this.name = "TicketAttachmentNotFoundError";
  }
}

export class TicketAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketAttachmentValidationError";
  }
}

export class TicketAttachmentConflictError extends Error {
  constructor(message = "The uploaded file could not be verified.") {
    super(message);
    this.name = "TicketAttachmentConflictError";
  }
}

/** Display-only filename: no separators, quotes or control characters. */
export function sanitizeTicketFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]/g, "_")
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : "attachment";
}

export function createTicketAttachmentService(deps: TicketAttachmentServiceDeps) {
  const { repository, storage } = deps;

  async function requireActor(): Promise<Actor> {
    const actor = await deps.getActor();
    if (!actor) throw new TicketAttachmentNotFoundError();
    return actor;
  }

  /** Upload authorization: owner on PUBLIC messages, or tickets.manage staff. */
  async function canUpload(actor: Actor, message: TicketMessageAuthContext): Promise<boolean> {
    if (await deps.hasPermission("tickets.manage")) return true;
    return message.ticketOwnerId === actor.userId && message.visibility === "PUBLIC";
  }

  async function canDownload(actor: Actor, message: TicketMessageAuthContext): Promise<boolean> {
    if (message.ticketOwnerId === actor.userId && message.visibility === "PUBLIC") return true;
    if (await deps.hasPermission("tickets.manage")) return true;
    return deps.hasPermission("tickets.view");
  }

  async function createUploadIntent(input: {
    messageId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    const actor = await requireActor();
    const message = await repository.findMessage(input.messageId);
    if (!message || !(await canUpload(actor, message))) {
      throw new TicketAttachmentNotFoundError();
    }

    const mimeType = input.mimeType.trim().toLowerCase();
    const check = validateTicketUpload({ mimeType, sizeBytes: input.sizeBytes });
    if (!check.ok) throw new TicketAttachmentValidationError(check.message);

    const stagedKey = storage.buildStagedKey(message.ticketId);
    const row = await repository.createIfUnderCap(
      {
        ticketId: message.ticketId,
        messageId: message.id,
        uploadedById: actor.userId,
        storageKey: stagedKey,
        filename: sanitizeTicketFilename(input.filename),
        mimeType,
        sizeBytes: BigInt(input.sizeBytes),
      },
      TICKET_MAX_ATTACHMENTS_PER_MESSAGE,
    );
    if (!row) {
      throw new TicketAttachmentValidationError(
        `A message can have at most ${TICKET_MAX_ATTACHMENTS_PER_MESSAGE} files.`,
      );
    }

    const uploadUrl = await storage.presignPut({ key: stagedKey, contentType: mimeType });
    await deps.audit({
      actorId: actor.userId,
      action: "ticketattachment.upload_started",
      targetType: "TicketAttachment",
      targetId: row.id,
      outcome: "SUCCESS",
    });
    return {
      attachment: {
        id: row.id,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: Number(row.sizeBytes),
        uploadStatus: row.uploadStatus,
      },
      upload: {
        url: uploadUrl,
        method: "PUT" as const,
        headers: { "Content-Type": mimeType },
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      },
    };
  }

  async function completeUpload(attachmentId: string) {
    const actor = await requireActor();
    const row = await repository.findAttachment(attachmentId);
    if (!row || !(await canUpload(actor, row.message))) {
      throw new TicketAttachmentNotFoundError();
    }
    const view = (status: TicketAttachmentStatus) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      uploadStatus: status,
    });
    if (row.uploadStatus === "READY") return view("READY");
    if (row.uploadStatus !== "UPLOADING") throw new TicketAttachmentNotFoundError();

    const stagedKey = row.storageKey;
    const fail = async (detail: string): Promise<never> => {
      try {
        await storage.delete(stagedKey);
      } catch (error) {
        console.error(`[ticket-attachment] staged cleanup failed for ${row.id}`, error);
      }
      await repository.markError(row.id, detail);
      await deps.audit({
        actorId: actor.userId,
        action: "ticketattachment.upload_failed",
        targetType: "TicketAttachment",
        targetId: row.id,
        outcome: "FAILURE",
        reason: detail,
      });
      throw new TicketAttachmentConflictError(detail);
    };

    let stored: { sizeBytes: bigint; contentType: string | null };
    try {
      stored = await storage.inspect(stagedKey);
    } catch {
      return fail("The uploaded object could not be verified.");
    }
    if (stored.sizeBytes !== row.sizeBytes || stored.contentType !== row.mimeType) {
      return fail("The stored file does not match its upload request.");
    }
    const recheck = validateTicketUpload({
      mimeType: stored.contentType ?? "",
      sizeBytes: Number(stored.sizeBytes),
    });
    if (!recheck.ok) return fail(recheck.message);

    const finalKey = storage.finalKey(stagedKey);
    await storage.promote({ stagedKey, finalKey });
    const won = await repository.markReady(row.id, finalKey);
    if (!won) {
      const current = await repository.findAttachment(row.id);
      if (current?.uploadStatus === "READY") return view("READY");
      throw new TicketAttachmentNotFoundError();
    }
    await deps.audit({
      actorId: actor.userId,
      action: "ticketattachment.upload_completed",
      targetType: "TicketAttachment",
      targetId: row.id,
      outcome: "SUCCESS",
    });
    try {
      await storage.delete(stagedKey);
    } catch (error) {
      console.error(`[ticket-attachment] staged cleanup failed for ${row.id}`, error);
    }
    return view("READY");
  }

  /** Authorizes BEFORE any presigning; one error type for every denial. */
  async function getDownload(attachmentId: string) {
    const actor = await deps.getActor();
    if (!actor) throw new TicketAttachmentNotFoundError();
    const row = await repository.findAttachment(attachmentId);
    if (!row || row.uploadStatus !== "READY" || !(await canDownload(actor, row.message))) {
      throw new TicketAttachmentNotFoundError();
    }
    return { storageKey: row.storageKey, filename: row.filename, mimeType: row.mimeType };
  }

  return { createUploadIntent, completeUpload, getDownload };
}

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

export function createPrismaTicketAttachmentRepository(
  client: AnyPrisma,
): TicketAttachmentRepository {
  const messageSelect = {
    id: true,
    ticketId: true,
    visibility: true,
    ticket: { select: { userId: true } },
  };
  const toMessage = (m: {
    id: string;
    ticketId: string;
    visibility: "PUBLIC" | "INTERNAL";
    ticket: { userId: string };
  }): TicketMessageAuthContext => ({
    id: m.id,
    ticketId: m.ticketId,
    visibility: m.visibility,
    ticketOwnerId: m.ticket.userId,
  });

  return {
    async findMessage(messageId) {
      const m = await client.ticketMessage.findUnique({
        where: { id: messageId },
        select: messageSelect,
      });
      return m ? toMessage(m) : null;
    },
    createIfUnderCap(data, cap) {
      return client.$transaction(
        async (tx: AnyPrisma) => {
          const count = await tx.ticketAttachment.count({
            where: {
              messageId: data.messageId,
              uploadStatus: { in: ["READY", "UPLOADING"] },
            },
          });
          if (count >= cap) return null;
          return tx.ticketAttachment.create({ data: { ...data, uploadStatus: "UPLOADING" } });
        },
        { isolationLevel: "Serializable" },
      );
    },
    async findAttachment(id) {
      const row = await client.ticketAttachment.findUnique({
        where: { id },
        include: { message: { select: messageSelect } },
      });
      if (!row) return null;
      const { message, ...rest } = row;
      return { ...rest, message: toMessage(message) };
    },
    async markReady(id, finalKey) {
      const result = await client.ticketAttachment.updateMany({
        where: { id, uploadStatus: "UPLOADING" },
        data: {
          storageKey: finalKey,
          uploadStatus: "READY",
          uploadedAt: new Date(),
          uploadDetail: null,
        },
      });
      return result.count === 1;
    },
    async markError(id, detail) {
      await client.ticketAttachment.updateMany({
        where: { id, uploadStatus: "UPLOADING" },
        data: { uploadStatus: "ERROR", uploadDetail: { detail } },
      });
    },
  };
}

const live = createTicketAttachmentService({
  repository: createPrismaTicketAttachmentRepository(prisma as AnyPrisma),
  storage: {
    buildStagedKey: (ticketId) => buildStagedTicketAttachmentKey({ ticketId }),
    finalKey: finalTicketAttachmentKeyFor,
    presignPut: presignLessonUploadUrl,
    inspect: inspectLessonObject,
    promote: promoteLessonObject,
    delete: deleteLessonObject,
  },
  getActor: async () => {
    const { getCurrentActor } = await import("@/server/auth/current-actor");
    return getCurrentActor();
  },
  hasPermission: async (permission) => {
    const { can } = await import("@/server/permissions");
    return can(permission, {});
  },
  audit: (event) => recordAudit(event),
});

export const createTicketAttachmentUploadIntent = live.createUploadIntent;
export const completeTicketAttachmentUpload = live.completeUpload;
export const getTicketAttachmentDownload = live.getDownload;
