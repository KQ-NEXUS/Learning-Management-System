/**
 * Submission — the learner Assignment upload pipeline (ASM-04) with
 * server-side enforcement of ASM-03's authored file-type/size constraints.
 *
 * Two-step verified upload, the same intent/complete shape
 * `lesson-resource-service.ts` already proved: `beginSubmissionUpload`
 * stages a presigned PUT and writes an `UPLOADING` row; `completeSubmission-
 * Upload` verifies the stored object against the row's declared metadata,
 * promotes it to a final key the browser could never write, and only THEN
 * marks the row `READY`. A submission never reaches `READY` on the browser's
 * word alone — that is ASM-04's "failures never display false success."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DD-15 — ZERO permission-choke-point-WRAPPED EXPORTS IN THIS FILE.
 * ─────────────────────────────────────────────────────────────────────────
 * Every export here is ownership-scoped, exactly like `checkout-service.ts`'s
 * `getOwnOrder` and `lesson-progress-service.ts`'s learner-facing exports:
 * the enrolment is re-derived from `actor.userId` against the Assessment's
 * course. Callers may disambiguate with an enrolmentId, which is matched
 * only within that actor's ACTIVE enrolments. This file imports no value from
 * `@/server/permissions` — only a type-only `Actor` import, which never
 * enters the module's runtime closure.
 *
 * ASM-03: file-type and size constraints come ONLY from the per-Assessment
 * authored `allowedFileTypes`/`maxFileSizeBytes` columns — never from the
 * static per-`LessonType` limits table `src/lib` carries for Lesson content, which
 * is keyed to `FILE`/`IMAGE`/`VIDEO` `LessonType`s and deliberately excludes
 * `QUIZ`/`ASSIGNMENT`.
 */

import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import type { ResourceAuditEntry } from "@/server/services/resource-service";
import { writeDomainEvent, type DomainEventTxClient } from "@/server/services/domain-event-service";
import {
  buildStagedSubmissionStorageKey,
  finalSubmissionKeyFor,
  presignLessonUploadUrl,
  presignLessonObjectUrl,
  inspectLessonObject,
  promoteLessonObject,
  deleteLessonObject,
} from "@/server/services/storage-service";

export type UploadStatusValue = "UPLOADING" | "READY" | "ERROR";

// ---------------------------------------------------------------------------
// Typed refusals
// ---------------------------------------------------------------------------

export type SubmissionNotAllowedReason =
  | "not-found"
  | "not-an-assignment"
  | "not-published"
  | "window-closed"
  | "resubmission-not-allowed"
  | "upload-in-progress";

/**
 * A structural refusal before any storage operation happens. `"not-found"`
 * covers BOTH a non-existent/non-reachable assessment AND an actor with no
 * enrolment covering its course — the two must be indistinguishable to the
 * caller (T-10-02).
 */
export class SubmissionNotAllowedError extends Error {
  readonly reason: SubmissionNotAllowedReason;

  constructor(reason: SubmissionNotAllowedReason) {
    super(SubmissionNotAllowedError.messageFor(reason));
    this.name = "SubmissionNotAllowedError";
    this.reason = reason;
  }

  private static messageFor(reason: SubmissionNotAllowedReason): string {
    switch (reason) {
      case "not-found":
        return "This assignment is not part of your enrolled path.";
      case "not-an-assignment":
        return "This assessment does not accept file submissions.";
      case "not-published":
        return "This assignment is not yet available.";
      case "window-closed":
        return "The submission window for this assignment has closed.";
      case "resubmission-not-allowed":
        return "You have already submitted this assignment and resubmission is not allowed.";
      case "upload-in-progress":
        return "An upload is already in progress for this assignment.";
    }
  }
}

export type SubmissionConstraintReason = "file-type-not-permitted" | "file-too-large" | "empty-file";

/** Refused BEFORE any presigned URL is issued — an over-limit or wrong-type file must never get a write URL at all (ASM-03). */
export class SubmissionConstraintError extends Error {
  readonly reason: SubmissionConstraintReason;
  readonly value: string | number;
  readonly limit: string | number | null;

  constructor(reason: SubmissionConstraintReason, value: string | number, limit: string | number | null) {
    super(SubmissionConstraintError.messageFor(reason, value, limit));
    this.name = "SubmissionConstraintError";
    this.reason = reason;
    this.value = value;
    this.limit = limit;
  }

  private static messageFor(
    reason: SubmissionConstraintReason,
    value: string | number,
    limit: string | number | null,
  ): string {
    switch (reason) {
      case "file-type-not-permitted":
        return `"${value}" is not an accepted file type for this assignment${limit ? ` (accepted: ${limit})` : ""}.`;
      case "file-too-large":
        return `This file exceeds the ${limit ?? "allowed"} byte limit for this assignment.`;
      case "empty-file":
        return "The declared file size must be greater than zero.";
    }
  }
}

export const UNVERIFIED_DETAIL = "The uploaded file could not be verified.";
export const MISMATCH_DETAIL = "The stored file does not match its upload request.";

/**
 * Thrown by `completeSubmissionUpload` when the stored object cannot be
 * verified against the row. Carries the now-`ERROR` row so the caller can
 * echo it back to the learner UI, mirroring `ResourceUploadValidationError`.
 */
export class SubmissionUploadValidationError extends Error {
  constructor(
    message: string,
    readonly submission: SubmissionRecord,
  ) {
    super(message);
    this.name = "SubmissionUploadValidationError";
  }
}

// ---------------------------------------------------------------------------
// Row / context shapes
// ---------------------------------------------------------------------------

export type SubmissionRecord = {
  id: string;
  assessmentId: string;
  enrolmentId: string;
  attemptNumber: number;
  versionUsed: number;
  receiptId: string;
  submittedAt: Date;
  isLate: boolean;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: UploadStatusValue;
};

export type SubmissionDelegate = {
  findMany(args: { where: { assessmentId: string; enrolmentId: string } }): Promise<SubmissionRecord[]>;
  findUnique(args: { where: { id: string } }): Promise<SubmissionRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<SubmissionRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<SubmissionRecord>;
};

/** The narrow authored-constraint context read from `Assessment`, never the static per-LessonType limits table. */
export type SubmissionAssessmentContext = {
  id: string;
  courseId: string;
  type: string;
  status: string;
  version: number;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  availableUntil: Date | null;
  allowedFileTypes: string[];
  maxFileSizeBytes: number | null;
  allowResubmission: boolean;
};

export type SubmissionEnrolmentStoreRow = { id: string; userId: string; cohortId: string; status: string };
export type SubmissionCohortStoreRow = { id: string; courseId: string | null };
export type SubmissionCohortCourseStoreRow = { cohortId: string; courseId: string };

/**
 * The narrow structural slice needed to re-derive "does this actor hold an
 * ACTIVE enrolment covering this course" — the same one-hop-per-cohort walk
 * `learner-access.ts`'s `hasActiveEnrolmentCoveringCourse` uses, duplicated
 * here (not imported) because that function returns only a boolean and this
 * module needs the actual enrolment id to scope every Submission row.
 */
export type SubmissionStore = {
  enrolment: {
    findUnique(args: { where: { id: string } }): Promise<SubmissionEnrolmentStoreRow | null>;
    findMany(args: { where: { userId: string; status: string } }): Promise<SubmissionEnrolmentStoreRow[]>;
  };
  cohort: {
    findUnique(args: { where: { id: string } }): Promise<SubmissionCohortStoreRow | null>;
  };
  cohortCourse: {
    findFirst(args: { where: { cohortId: string; courseId: string } }): Promise<SubmissionCohortCourseStoreRow | null>;
  };
};

/**
 * Injectable object-store surface, mirroring `LessonResourceStorage` plus
 * the two Submission-specific concerns `lesson-resource-service.ts` never
 * needed: `presign` (the intent step builds AND presigns its own staged key,
 * unlike the Lesson route which presigns before calling `begin`) and
 * `stagedKey` (the key builder itself, so the fake in tests never touches
 * MinIO).
 */
export type SubmissionStorage = {
  presign(input: { key: string; contentType: string }): Promise<string>;
  inspect(key: string): Promise<{ sizeBytes: number; contentType: string | null }>;
  promote(input: { stagedKey: string; finalKey: string }): Promise<void>;
  remove(key: string): Promise<void>;
  stagedKey(input: { enrolmentId: string; assessmentId: string }): string;
  finalKey(stagedKey: string): string;
};

export type SubmissionTxClient = DomainEventTxClient & {
  submission: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<SubmissionRecord>;
  };
};

export type CreateSubmissionServiceDeps = {
  delegate: SubmissionDelegate;
  resolveAssessment: (assessmentId: string) => Promise<SubmissionAssessmentContext | null>;
  store: SubmissionStore;
  storage: SubmissionStorage;
  /** A time-limited presigned GET for the FINAL key only (T-10-20). */
  presignDownload: (input: { key: string; filename: string; mimeType: string }) => Promise<string>;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  writeEvent: typeof writeDomainEvent;
  runInTransaction: <R>(fn: (tx: SubmissionTxClient) => Promise<R>) => Promise<R>;
  now?: () => Date;
};

export type BeginSubmissionUploadInput = {
  assessmentId: string;
  /** Disambiguation only; resolved within actor.userId's ACTIVE owned set. */
  enrolmentId?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * The intent step's result. Deliberately has NO `receiptId` — a receipt only
 * becomes displayable after `completeSubmissionUpload` verifies the object
 * (ASM-04's never-false-success invariant applies to the API surface too).
 */
export type BeginSubmissionUploadResult = {
  submissionId: string;
  uploadUrl: string;
  stagedKey: string;
  attemptNumber: number;
  isLate: boolean;
};

export type SubmissionReceipt = {
  submissionId: string;
  receiptId: string;
  attemptNumber: number;
  filename: string;
  sizeBytes: number;
  submittedAt: Date;
  isLate: boolean;
  uploadStatus: UploadStatusValue;
};

/**
 * The pre-submit view (ASM-03) — everything `AssignmentSubmissionPanel` must
 * show BEFORE a learner picks a file: the authored instructions and
 * constraints, plus the full submission history (D-04). Deliberately built
 * from the same `resolveAssessment`/`resolveOwnEnrolmentForCourse` pair
 * every write path already uses, so a learner can never see constraints for
 * an assessment their enrolment does not cover.
 */
export type SubmissionAssignmentView = {
  assessmentId: string;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  availableUntil: Date | null;
  allowedFileTypes: string[];
  maxFileSizeBytes: number | null;
  allowResubmission: boolean;
  submissions: SubmissionReceipt[];
};

function toReceipt(row: SubmissionRecord): SubmissionReceipt {
  return {
    submissionId: row.id,
    receiptId: row.receiptId,
    attemptNumber: row.attemptNumber,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    submittedAt: row.submittedAt,
    isLate: row.isLate,
    uploadStatus: row.uploadStatus,
  };
}

/** Lowercased extension with no leading dot, or `null` for an extensionless filename. */
function extractExtension(filename: string): string | null {
  const idx = filename.lastIndexOf(".");
  if (idx === -1 || idx === filename.length - 1) return null;
  return filename.slice(idx + 1).toLowerCase();
}

/** Normalises an authored `allowedFileTypes` entry the same way — tolerates both `"pdf"` and `".pdf"`. */
function normaliseExt(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\./, "");
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createSubmissionService(deps: CreateSubmissionServiceDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * `true` iff `userId` holds an ACTIVE enrolment in a cohort whose offer
   * covers `courseId` — mirrors `learner-access.ts`'s
   * `hasActiveEnrolmentCoveringCourse` walk, but returns the enrolment id
   * itself (the boolean-only helper cannot scope a Submission row).
   */
  async function resolveOwnEnrolmentForCourse(userId: string, courseId: string, requestedEnrolmentId?: string): Promise<string | null> {
    const activeEnrolments = await deps.store.enrolment.findMany({ where: { userId, status: "ACTIVE" } });

    for (const enrolment of activeEnrolments) {
      if (requestedEnrolmentId && enrolment.id !== requestedEnrolmentId) continue;
      const cohort = await deps.store.cohort.findUnique({ where: { id: enrolment.cohortId } });
      if (!cohort) continue;
      if (cohort.courseId === courseId) return enrolment.id;

      const member = await deps.store.cohortCourse.findFirst({ where: { cohortId: cohort.id, courseId } });
      if (member) return enrolment.id;
    }

    return null;
  }

  /** `null` for a stranger's submission id, indistinguishable from an unknown one. */
  async function loadOwnSubmission(actor: Actor, submissionId: string): Promise<SubmissionRecord | null> {
    const submission = await deps.delegate.findUnique({ where: { id: submissionId } });
    if (!submission) return null;
    const enrolment = await deps.store.enrolment.findUnique({ where: { id: submission.enrolmentId } });
    if (!enrolment || enrolment.userId !== actor.userId) return null;
    return submission;
  }

  // -------------------------------------------------------------------------
  // beginSubmissionUpload — the intent step (ASM-03 constraints, D-03, D-04)
  // -------------------------------------------------------------------------

  async function beginSubmissionUpload(
    actor: Actor,
    input: BeginSubmissionUploadInput,
  ): Promise<BeginSubmissionUploadResult> {
    const assessment = await deps.resolveAssessment(input.assessmentId);
    const enrolmentId = assessment ? await resolveOwnEnrolmentForCourse(actor.userId, assessment.courseId, input.enrolmentId) : null;
    if (!assessment || !enrolmentId) {
      throw new SubmissionNotAllowedError("not-found");
    }

    if (assessment.type !== "ASSIGNMENT") throw new SubmissionNotAllowedError("not-an-assignment");
    if (assessment.status !== "PUBLISHED") throw new SubmissionNotAllowedError("not-published");

    const nowValue = now();

    // D-03: the due date is informational, never a block. Only the hard
    // cutoff (`availableUntil`) refuses.
    if (assessment.availableUntil !== null && nowValue > assessment.availableUntil) {
      throw new SubmissionNotAllowedError("window-closed");
    }

    // ASM-03 — authored constraints, enforced BEFORE any presigned URL.
    const ext = extractExtension(input.filename);
    const allowed = assessment.allowedFileTypes.map(normaliseExt);
    if (!ext || !allowed.includes(ext)) {
      throw new SubmissionConstraintError("file-type-not-permitted", ext ?? "", assessment.allowedFileTypes.join(", "));
    }
    if (!(input.sizeBytes > 0)) {
      throw new SubmissionConstraintError("empty-file", input.sizeBytes, null);
    }
    if (assessment.maxFileSizeBytes !== null && input.sizeBytes > assessment.maxFileSizeBytes) {
      throw new SubmissionConstraintError("file-too-large", input.sizeBytes, assessment.maxFileSizeBytes);
    }

    // D-04 — resubmission is always a NEW row, never an overwrite.
    const existing = await deps.delegate.findMany({ where: { assessmentId: assessment.id, enrolmentId } });
    const uploadingExists = existing.some((s) => s.uploadStatus === "UPLOADING");
    if (uploadingExists) throw new SubmissionNotAllowedError("upload-in-progress");

    const readyExists = existing.some((s) => s.uploadStatus === "READY");
    if (readyExists && !assessment.allowResubmission) {
      throw new SubmissionNotAllowedError("resubmission-not-allowed");
    }

    const attemptNumber = existing.reduce((max, s) => Math.max(max, s.attemptNumber), 0) + 1;
    const isLate = assessment.dueAt !== null && nowValue > assessment.dueAt;

    const stagedKey = deps.storage.stagedKey({ enrolmentId, assessmentId: assessment.id });
    const uploadUrl = await deps.storage.presign({ key: stagedKey, contentType: input.mimeType });

    const created = await deps.delegate.create({
      data: {
        assessmentId: assessment.id,
        enrolmentId,
        attemptNumber,
        versionUsed: assessment.version,
        storageKey: stagedKey,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadStatus: "UPLOADING",
        isLate,
      },
    });

    await deps.audit({
      action: "submission.upload_started",
      targetType: "Submission",
      targetId: created.id,
      actorId: actor.userId,
      outcome: "SUCCESS",
      reason: null,
      after: created,
    });

    return {
      submissionId: created.id,
      uploadUrl,
      stagedKey,
      attemptNumber: created.attemptNumber,
      isLate: created.isLate,
    };
  }

  // -------------------------------------------------------------------------
  // completeSubmissionUpload — inspect -> promote -> READY (ASM-04)
  // -------------------------------------------------------------------------

  async function completeSubmissionUpload(
    actor: Actor,
    input: { submissionId: string },
  ): Promise<SubmissionReceipt> {
    const before = await loadOwnSubmission(actor, input.submissionId);
    if (!before) throw new SubmissionNotAllowedError("not-found");

    // A second complete call on an already-READY row is a no-op receipt
    // replay, never a duplicate promote.
    if (before.uploadStatus === "READY") return toReceipt(before);
    if (before.uploadStatus !== "UPLOADING") {
      throw new SubmissionUploadValidationError(UNVERIFIED_DETAIL, before);
    }

    // Capture the staged key before any write: `before` is promoted in
    // place, so reading it afterwards would give the final key.
    const stagedKey = before.storageKey;

    const failUpload = async (detail: string): Promise<SubmissionRecord> => {
      const failed = await deps.delegate.update({
        where: { id: before.id },
        data: { uploadStatus: "ERROR" },
      });
      await deps.audit({
        action: "submission.upload_failed",
        targetType: "Submission",
        targetId: before.id,
        actorId: actor.userId,
        outcome: "FAILURE",
        reason: detail,
        before,
        after: failed,
      });
      return failed;
    };

    const cleanupStaged = async () => {
      try {
        await deps.storage.remove(stagedKey);
      } catch (error) {
        console.error(`[submission] invalid staged cleanup failed for ${before.id}`, error);
      }
    };

    let stored: { sizeBytes: number; contentType: string | null };
    try {
      stored = await deps.storage.inspect(stagedKey);
    } catch {
      await cleanupStaged();
      throw new SubmissionUploadValidationError(UNVERIFIED_DETAIL, await failUpload(UNVERIFIED_DETAIL));
    }

    const declaredMime = before.mimeType.trim().toLowerCase();
    if (stored.sizeBytes !== before.sizeBytes || stored.contentType !== declaredMime) {
      await cleanupStaged();
      throw new SubmissionUploadValidationError(MISMATCH_DETAIL, await failUpload(MISMATCH_DETAIL));
    }

    const finalKey = deps.storage.finalKey(stagedKey);
    await deps.storage.promote({ stagedKey, finalKey });

    const nowValue = now();
    let after!: SubmissionRecord;
    await deps.runInTransaction(async (tx) => {
      after = await tx.submission.update({
        where: { id: before.id },
        data: { storageKey: finalKey, uploadStatus: "READY", submittedAt: nowValue },
      });
      await deps.writeEvent(tx, {
        type: "submission.created",
        payload: {
          submissionId: after.id,
          assessmentId: after.assessmentId,
          enrolmentId: after.enrolmentId,
          attemptNumber: after.attemptNumber,
          isLate: after.isLate,
        },
        occurredAt: nowValue,
      });
    });

    await deps.audit({
      action: "submission.upload_completed",
      targetType: "Submission",
      targetId: after.id,
      actorId: actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: { uploadStatus: before.uploadStatus, storageKey: before.storageKey },
      after: { uploadStatus: after.uploadStatus, storageKey: after.storageKey },
    });

    try {
      await deps.storage.remove(stagedKey);
    } catch (error) {
      console.error(`[submission] staged cleanup failed for ${before.id}`, error);
    }

    return toReceipt(after);
  }

  /** The browser-side abort path — marks ERROR, cleans up staged storage, never deletes the row (no-hard-deletes convention). */
  async function failSubmissionUpload(actor: Actor, input: { submissionId: string; detail: string }): Promise<void> {
    const before = await loadOwnSubmission(actor, input.submissionId);
    if (!before) throw new SubmissionNotAllowedError("not-found");

    const after = await deps.delegate.update({
      where: { id: before.id },
      data: { uploadStatus: "ERROR" },
    });

    try {
      await deps.storage.remove(before.storageKey);
    } catch (error) {
      console.error(`[submission] staged cleanup failed for ${before.id}`, error);
    }

    await deps.audit({
      action: "submission.upload_failed",
      targetType: "Submission",
      targetId: before.id,
      actorId: actor.userId,
      outcome: "FAILURE",
      reason: input.detail,
      before,
      after,
    });
  }

  /** This enrolment's submissions for one assessment, newest attempt first — the full history, not just the latest (D-04). */
  async function getOwnSubmissions(actor: Actor, input: { assessmentId: string; enrolmentId?: string }): Promise<SubmissionReceipt[]> {
    const assessment = await deps.resolveAssessment(input.assessmentId);
    if (!assessment) return [];

    const enrolmentId = await resolveOwnEnrolmentForCourse(actor.userId, assessment.courseId, input.enrolmentId);
    if (!enrolmentId) return [];

    const rows = await deps.delegate.findMany({ where: { assessmentId: assessment.id, enrolmentId } });
    return rows
      .slice()
      .sort((a, b) => b.attemptNumber - a.attemptNumber)
      .map(toReceipt);
  }

  /**
   * The pre-submit view-builder's service half (ASM-03) — resolves the
   * published constraints plus the full submission history for one
   * assessment, scoped the same way every other export here is: `null` for
   * a wrong type, an unpublished assessment, or an actor with no covering
   * enrolment, never a distinguishable error.
   */
  async function getOwnAssignmentView(
    actor: Actor,
    input: { assessmentId: string; enrolmentId: string },
  ): Promise<SubmissionAssignmentView | null> {
    const assessment = await deps.resolveAssessment(input.assessmentId);
    if (!assessment || assessment.type !== "ASSIGNMENT" || assessment.status !== "PUBLISHED") return null;

    const enrolmentId = await resolveOwnEnrolmentForCourse(actor.userId, assessment.courseId, input.enrolmentId);
    if (!enrolmentId) return null;

    const submissions = await getOwnSubmissions(actor, { assessmentId: assessment.id, enrolmentId });

    return {
      assessmentId: assessment.id,
      title: assessment.title,
      instructions: assessment.instructions,
      dueAt: assessment.dueAt,
      availableUntil: assessment.availableUntil,
      allowedFileTypes: assessment.allowedFileTypes,
      maxFileSizeBytes: assessment.maxFileSizeBytes,
      allowResubmission: assessment.allowResubmission,
      submissions,
    };
  }

  /** Presigns the FINAL key only, and only once verified (T-10-20) — a staged key must never be downloadable. */
  async function getOwnSubmissionDownloadUrl(actor: Actor, input: { submissionId: string }): Promise<string> {
    const submission = await loadOwnSubmission(actor, input.submissionId);
    if (!submission || submission.uploadStatus !== "READY") {
      throw new SubmissionNotAllowedError("not-found");
    }

    return deps.presignDownload({
      key: submission.storageKey,
      filename: submission.filename,
      mimeType: submission.mimeType,
    });
  }

  return {
    beginSubmissionUpload,
    completeSubmissionUpload,
    failSubmissionUpload,
    getOwnSubmissions,
    getOwnAssignmentView,
    getOwnSubmissionDownloadUrl,
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

const liveStorage: SubmissionStorage = {
  presign: (input) => presignLessonUploadUrl(input),
  inspect: async (key) => {
    const result = await inspectLessonObject(key);
    return { sizeBytes: Number(result.sizeBytes), contentType: result.contentType };
  },
  promote: (input) => promoteLessonObject(input),
  remove: (key) => deleteLessonObject(key),
  stagedKey: (input) => buildStagedSubmissionStorageKey(input),
  finalKey: (stagedKey) => finalSubmissionKeyFor(stagedKey),
};

const liveAudit = (entry: ResourceAuditEntry) =>
  recordAudit({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before,
    after: entry.after,
    reason: entry.reason,
    outcome: entry.outcome,
  });

const built = createSubmissionService({
  delegate: prisma.submission as unknown as SubmissionDelegate,
  resolveAssessment: async (assessmentId) => {
    const row = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        courseId: true,
        type: true,
        status: true,
        version: true,
        title: true,
        instructions: true,
        dueAt: true,
        availableUntil: true,
        allowedFileTypes: true,
        maxFileSizeBytes: true,
        allowResubmission: true,
      },
    });
    return row;
  },
  // Cast the whole client to the narrow structural store — the same
  // `prisma as unknown as <Store>` idiom `learner-access.ts` uses — so
  // `status` stays a plain `string` in this module's own type (no
  // `@prisma/client` enum import needed) while the live binding still runs
  // the real, fully-typed Prisma delegate underneath.
  store: prisma as unknown as SubmissionStore,
  storage: liveStorage,
  presignDownload: (input) =>
    presignLessonObjectUrl({
      key: input.key,
      lessonType: "ASSIGNMENT",
      filename: input.filename,
      contentType: input.mimeType,
    }),
  audit: liveAudit,
  writeEvent: writeDomainEvent,
  runInTransaction: (fn) => (prisma as AnyPrisma).$transaction((tx: unknown) => fn(tx as SubmissionTxClient)),
});

export const beginSubmissionUpload = built.beginSubmissionUpload;
export const completeSubmissionUpload = built.completeSubmissionUpload;
export const failSubmissionUpload = built.failSubmissionUpload;
export const getOwnSubmissions = built.getOwnSubmissions;
export const getOwnAssignmentView = built.getOwnAssignmentView;
export const getOwnSubmissionDownloadUrl = built.getOwnSubmissionDownloadUrl;
