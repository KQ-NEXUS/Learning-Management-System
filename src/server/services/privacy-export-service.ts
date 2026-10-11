/**
 * Learner data export, the read half of the D-12 privacy tool (NFR-11, NFR-13).
 *
 * Staff holding `privacy.manage` (Global only, 15-DECISIONS.md) can prepare one
 * learner's personal data as a single CSV file. This is not a new job system:
 * the file is a new dataset (`learner-subject`) and a new snapshot producer in
 * the export pipeline that already has the Queued, Processing, Succeeded,
 * Failed (retryable) and Expired states, the worker, the 24 hour expiry, the
 * short-lived download route that rechecks the permission, and the audit rows
 * `export.requested` and `export.download_authorized`.
 *
 * Output format (ledger P-02): one CSV in long format, one row per field of one
 * record: section, recordType, recordId, field, value, recordedAt.
 *
 * Licence class (ledger P-03): privacy.manage is a licence "write" (it also
 * guards anonymisation). The request call site carries a reviewed
 * `{ licence: "continuity" }` override, because LIC-08 keeps a permitted
 * data-access route open in restricted mode. Anonymisation stays blocked.
 *
 * What the file never holds (prohibition P6): another person's data, password
 * or token hashes, staff-only (INTERNAL) ticket messages, staff names or email
 * addresses, provider secrets, internal storage keys, staff free-text notes and
 * draft grades. Every query below uses an explicit `select`, so a column added
 * to a table later is not exported by accident.
 *
 * This module must not import `export-service` at runtime: `export-service`
 * imports `learnerSubjectProducer` from here, so the singleton reaches the
 * pipeline through a lazy dynamic import instead.
 */

import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { requestCorrelationId } from "@/server/auth/request-context";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAuditInTransaction, type BusinessAuditEvent } from "@/server/services/audit-service";
import type { SnapshotRow, TrustedExportProducer } from "@/server/services/export-service";

type WithPermission = ReturnType<typeof createWithPermission>;
type Tx = Prisma.TransactionClient;

/** The dataset id in `EXPORT_DATASET_REGISTRY`. */
export const LEARNER_EXPORT_DATASET = "learner-subject";

/** Fewest and most characters a staff member's reason may have (after trimming). */
export const MIN_EXPORT_REASON_LENGTH = 10;
export const MAX_EXPORT_REASON_LENGTH = 2000;

/** Every column of the dataset, in the registry's stable order. */
const ALL_COLUMNS = ["section", "recordType", "recordId", "field", "recordedAt", "value"] as const;

/** The sections of the file, in the order their rows appear. */
export const LEARNER_EXPORT_SECTIONS = Object.freeze([
  "profile",
  "consent",
  "enrolments",
  "orders",
  "payment-attempts",
  "refunds",
  "attendance",
  "submissions",
  "grades",
  "certificates",
  "support",
  "email-preferences",
] as const);
export type LearnerExportSection = (typeof LEARNER_EXPORT_SECTIONS)[number];

/**
 * One refusal for an unknown id, a staff account and an anonymised learner, so
 * the tool is not an oracle for which ids exist or who is staff. Screens turn
 * it into the standard 404.
 */
export class LearnerExportNotFoundError extends Error {
  constructor() {
    super("This learner could not be found.");
    this.name = "LearnerExportNotFoundError";
  }
}

/** The reason is missing or shorter than the minimum. Checked before the target. */
export class LearnerExportReasonError extends Error {
  constructor() {
    super(`Enter a reason of at least ${MIN_EXPORT_REASON_LENGTH} characters.`);
    this.name = "LearnerExportReasonError";
  }
}

// ---------------------------------------------------------------- the file

type Cell = string | number | boolean | Date | null | undefined;
type FileRow = {
  section: LearnerExportSection;
  recordType: string;
  recordId: string;
  field: string;
  value: string;
  recordedAt: string | null;
};

function text(value: Cell): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Collects the long-format rows; a field with no value produces no row. */
function collector() {
  const rows: FileRow[] = [];
  return {
    rows,
    record(
      section: LearnerExportSection,
      recordType: string,
      recordId: string,
      recordedAt: Date | null,
      fields: Readonly<Record<string, Cell>>,
    ) {
      for (const [field, raw] of Object.entries(fields)) {
        const value = text(raw);
        if (value === null) continue;
        rows.push({ section, recordType, recordId, field, value, recordedAt: text(recordedAt) });
      }
    },
  };
}

/** Name used for any ticket message that was not written by the learner. */
const STAFF_AUTHOR_LABEL = "Support team";
const LEARNER_AUTHOR_LABEL = "Learner";

/**
 * Reads every section for one learner inside the export transaction. Refuses a
 * staff account, an unknown id and an anonymised learner with
 * `LearnerExportNotFoundError`, even if a caller reached the pipeline without
 * the privacy service.
 */
async function readLearnerRows(tx: Tx, userId: string): Promise<FileRow[]> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      pendingEmail: true,
      learnerNumber: true,
      status: true,
      emailVerified: true,
      createdAt: true,
      isStaff: true,
      anonymisedAt: true,
      _count: { select: { assignments: true } },
    },
  });
  if (!user || user.isStaff || user.anonymisedAt !== null || user._count.assignments > 0) {
    throw new LearnerExportNotFoundError();
  }

  const out = collector();

  out.record("profile", "User", user.id, user.createdAt, {
    name: user.name,
    email: user.email,
    phone: user.phone,
    pendingEmail: user.pendingEmail,
    learnerNumber: user.learnerNumber,
    status: user.status,
    registeredAt: user.createdAt,
    emailVerifiedAt: user.emailVerified,
  });

  for (const row of await tx.policyAcceptance.findMany({
    where: { userId },
    orderBy: [{ acceptedAt: "asc" }, { id: "asc" }],
    select: { id: true, policyType: true, version: true, accepted: true, acceptedAt: true },
  })) {
    out.record("consent", "PolicyAcceptance", row.id, row.acceptedAt, {
      policyType: row.policyType,
      version: row.version,
      accepted: row.accepted,
    });
  }

  for (const row of await tx.enrolment.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      accessStartsAt: true,
      accessEndsAt: true,
      activatedAt: true,
      withdrawnAt: true,
      createdAt: true,
      cohort: { select: { code: true, title: true } },
    },
  })) {
    out.record("enrolments", "Enrolment", row.id, row.createdAt, {
      cohortCode: row.cohort.code,
      cohortTitle: row.cohort.title,
      status: row.status,
      accessStartsAt: row.accessStartsAt,
      accessEndsAt: row.accessEndsAt,
      activatedAt: row.activatedAt,
      withdrawnAt: row.withdrawnAt,
    });
  }

  for (const row of await tx.order.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      reference: true,
      amountMinor: true,
      currency: true,
      status: true,
      selectedProvider: true,
      paidAt: true,
      createdAt: true,
      cohort: { select: { code: true } },
    },
  })) {
    out.record("orders", "Order", row.id, row.createdAt, {
      reference: row.reference,
      cohortCode: row.cohort.code,
      amountMinor: row.amountMinor,
      currency: row.currency,
      status: row.status,
      paymentProvider: row.selectedProvider,
      paidAt: row.paidAt,
    });
  }

  for (const row of await tx.paymentAttempt.findMany({
    where: { order: { userId } },
    orderBy: [{ initiatedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      provider: true,
      providerRef: true,
      amountMinor: true,
      currency: true,
      status: true,
      initiatedAt: true,
      confirmedAt: true,
      failedAt: true,
      manualChannel: true,
      manualReference: true,
      manualPaidAt: true,
      order: { select: { reference: true } },
    },
  })) {
    out.record("payment-attempts", "PaymentAttempt", row.id, row.initiatedAt, {
      orderReference: row.order.reference,
      provider: row.provider,
      providerReference: row.providerRef,
      amountMinor: row.amountMinor,
      currency: row.currency,
      status: row.status,
      confirmedAt: row.confirmedAt,
      failedAt: row.failedAt,
      manualChannel: row.manualChannel,
      manualReference: row.manualReference,
      manualPaidAt: row.manualPaidAt,
    });
  }

  for (const row of await tx.refund.findMany({
    where: { order: { userId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      amountMinor: true,
      currency: true,
      provider: true,
      status: true,
      createdAt: true,
      completedAt: true,
      order: { select: { reference: true } },
    },
  })) {
    out.record("refunds", "Refund", row.id, row.createdAt, {
      orderReference: row.order.reference,
      amountMinor: row.amountMinor,
      currency: row.currency,
      provider: row.provider,
      status: row.status,
      completedAt: row.completedAt,
    });
  }

  for (const row of await tx.attendanceRecord.findMany({
    where: { enrolment: { userId } },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      state: true,
      recordedAt: true,
      session: { select: { title: true, startsAt: true, cohort: { select: { code: true } } } },
    },
  })) {
    out.record("attendance", "AttendanceRecord", row.id, row.recordedAt, {
      cohortCode: row.session.cohort.code,
      sessionTitle: row.session.title,
      sessionStartsAt: row.session.startsAt,
      state: row.state,
    });
  }

  // Metadata only: the stored file and its internal storage key are not exported.
  for (const row of await tx.submission.findMany({
    where: { enrolment: { userId } },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      receiptId: true,
      attemptNumber: true,
      submittedAt: true,
      isLate: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      assessment: { select: { title: true } },
    },
  })) {
    out.record("submissions", "Submission", row.id, row.submittedAt, {
      assessmentTitle: row.assessment.title,
      attemptNumber: row.attemptNumber,
      receiptId: row.receiptId,
      isLate: row.isLate,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    });
  }

  // Released grades only: a draft is not yet a decision the learner has seen.
  for (const row of await tx.grade.findMany({
    where: { enrolment: { userId }, status: "RELEASED" },
    orderBy: [{ releasedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      score: true,
      maxScore: true,
      passed: true,
      feedback: true,
      releasedAt: true,
      gradedAt: true,
      assessment: { select: { title: true } },
    },
  })) {
    out.record("grades", "Grade", row.id, row.releasedAt ?? row.gradedAt, {
      assessmentTitle: row.assessment.title,
      score: row.score,
      maxScore: row.maxScore,
      passed: row.passed,
      feedback: row.feedback,
    });
  }

  for (const row of await tx.certificate.findMany({
    where: { userId },
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      verificationRef: true,
      awardTitle: true,
      learnerName: true,
      issuedAt: true,
      status: true,
      revokedAt: true,
    },
  })) {
    out.record("certificates", "Certificate", row.id, row.issuedAt, {
      verificationReference: row.verificationRef,
      awardTitle: row.awardTitle,
      learnerName: row.learnerName,
      status: row.status,
      revokedAt: row.revokedAt,
    });
  }

  // Support: only messages the learner could see. Staff-only notes are left out
  // by visibility AND by kind, and no author name or address is read at all.
  for (const ticket of await tx.ticket.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      reference: true,
      category: true,
      subject: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      closedAt: true,
      messages: {
        where: { visibility: "PUBLIC", kind: { not: "INTERNAL_NOTE" } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, authorId: true, body: true, createdAt: true },
      },
    },
  })) {
    out.record("support", "Ticket", ticket.id, ticket.createdAt, {
      reference: ticket.reference,
      category: ticket.category,
      subject: ticket.subject,
      status: ticket.status,
      resolvedAt: ticket.resolvedAt,
      closedAt: ticket.closedAt,
    });
    for (const message of ticket.messages) {
      out.record("support", "TicketMessage", message.id, message.createdAt, {
        ticketReference: ticket.reference,
        author: message.authorId === userId ? LEARNER_AUTHOR_LABEL : STAFF_AUTHOR_LABEL,
        message: message.body,
      });
    }
  }

  for (const row of await tx.emailPreference.findMany({
    where: { userId },
    orderBy: { category: "asc" },
    select: { category: true, muted: true, updatedAt: true },
  })) {
    out.record("email-preferences", "EmailPreference", row.category, row.updatedAt, {
      category: row.category,
      muted: row.muted,
    });
  }

  return out.rows;
}

/**
 * The trusted snapshot producer for dataset `learner-subject`. The pipeline
 * freezes whatever it returns inside the request transaction; the worker then
 * streams those frozen rows to CSV.
 */
export const learnerSubjectProducer: TrustedExportProducer = async ({ normalizedFilters, selectedColumns, tx }) => {
  const userId = normalizedFilters.userId;
  if (typeof userId !== "string" || userId.length === 0) throw new LearnerExportNotFoundError();
  const selected = new Set(selectedColumns.map((column) => column.key));
  const rows = await readLearnerRows(tx, userId);
  return rows.map(
    (row): SnapshotRow =>
      Object.freeze(Object.fromEntries(ALL_COLUMNS.filter((key) => selected.has(key)).map((key) => [key, row[key]]))),
  );
};

// ------------------------------------------------------------ the service

/** The slice of persistence the service reads for its checks and status. */
export type PrivacyExportStore = {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  user: Pick<PrismaClient["user"], "findUnique">;
  exportJob: Pick<PrismaClient["exportJob"], "findFirst">;
};

/** The export pipeline's request function, as this service needs it. */
export type LearnerExportPipeline = {
  requestExport(input: {
    dataset: string;
    filters: Record<string, unknown>;
    columns: string[];
    reason: string;
    idempotencyKey: string;
  }): Promise<{ jobId: string; status: string }>;
};

export type RequestLearnerExportInput = { userId: string; reason: string };
export type RequestLearnerExportResult = { jobId: string; status: string; reused: boolean };

/** What the staff screen shows for a learner's export (UI-SPEC S3). */
export type LearnerExportState = "none" | "queued" | "processing" | "succeeded" | "failed" | "expired";
export type LearnerExportStatus = {
  state: LearnerExportState;
  jobId: string | null;
  requestedAt: Date | null;
  /** Set while Succeeded and not yet expired. */
  expiresAt: Date | null;
  /** True when a download link may be offered right now. */
  canDownload: boolean;
  /** The existing short-lived download route; it rechecks the permission. */
  downloadPath: string | null;
  /** True for a Failed job: retry with the pipeline's own retry. */
  canRetry: boolean;
  /** True while a request is Queued or Processing: a new one would only return it. */
  inFlight: boolean;
};

const STATE_BY_STATUS = {
  QUEUED: "queued",
  PROCESSING: "processing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  EXPIRED: "expired",
} as const;

function jobFilter(actorId: string, userId: string): Prisma.ExportJobWhereInput {
  return {
    dataset: LEARNER_EXPORT_DATASET,
    requestedById: actorId,
    filters: { path: ["userId"], equals: userId },
  };
}

export function createPrivacyExportService(deps: {
  store: PrivacyExportStore;
  withPermission: WithPermission;
  pipeline: LearnerExportPipeline;
  /** Writes the audit row. */
  auditInTransaction?: (tx: Tx, event: BusinessAuditEvent) => Promise<void>;
  /** Ties the audit row to the request log. */
  correlationId?: () => Promise<string>;
  now?: () => Date;
}) {
  const { store, withPermission: authorize, pipeline } = deps;
  const writeAudit = deps.auditInTransaction ?? recordAuditInTransaction;
  const correlationId = deps.correlationId ?? requestCorrelationId;
  const now = deps.now ?? (() => new Date());

  async function requestHandler(
    input: RequestLearnerExportInput,
    ctx: { actor: { userId: string } },
  ): Promise<RequestLearnerExportResult> {
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < MIN_EXPORT_REASON_LENGTH || reason.length > MAX_EXPORT_REASON_LENGTH) {
      throw new LearnerExportReasonError();
    }
    const userId = typeof input.userId === "string" ? input.userId : "";
    if (userId.length === 0 || userId.length > 128) throw new LearnerExportNotFoundError();

    const target = await store.user.findUnique({
      where: { id: userId },
      select: { id: true, isStaff: true, anonymisedAt: true, _count: { select: { assignments: true } } },
    });
    if (!target || target.isStaff || target.anonymisedAt !== null || target._count.assignments > 0) {
      throw new LearnerExportNotFoundError();
    }

    const actorId = ctx.actor.userId;
    const auditCorrelationId = await correlationId();

    // One open request per actor and learner: a second click returns it.
    const open = await store.exportJob.findFirst({
      where: { ...jobFilter(actorId, userId), status: { in: ["QUEUED", "PROCESSING"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true },
    });

    let result: RequestLearnerExportResult;
    if (open) {
      result = { jobId: open.id, status: open.status, reused: true };
    } else {
      // The pipeline's idempotency key is permanent, so it is derived from the
      // learner and the actor's latest job for them: two simultaneous first
      // clicks share a key (one job), and a later request after that job has
      // finished gets a new key (a new job).
      const latest = await store.exportJob.findFirst({
        where: jobFilter(actorId, userId),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      const digest = createHash("sha256").update(`learner-export:${userId}:${latest?.id ?? "first"}`).digest("hex");
      const created = await pipeline.requestExport({
        dataset: LEARNER_EXPORT_DATASET,
        filters: { userId },
        columns: [...ALL_COLUMNS],
        reason,
        idempotencyKey: `lx-${digest.slice(0, 40)}`,
      });
      result = { jobId: created.jobId, status: created.status, reused: false };
    }

    await store.$transaction((tx) =>
      writeAudit(tx, {
        actorId,
        action: "privacy.learner_export_requested",
        targetType: "User",
        targetId: userId,
        scopeType: "GLOBAL",
        scopeId: null,
        after: { jobId: result.jobId, status: result.status, reused: result.reused },
        reason,
        outcome: "SUCCESS",
        correlationId: auditCorrelationId,
      }),
    );

    return result;
  }

  async function statusHandler(
    input: { userId: string },
    ctx: { actor: { userId: string } },
  ): Promise<LearnerExportStatus> {
    const none: LearnerExportStatus = {
      state: "none",
      jobId: null,
      requestedAt: null,
      expiresAt: null,
      canDownload: false,
      downloadPath: null,
      canRetry: false,
      inFlight: false,
    };
    if (typeof input.userId !== "string" || input.userId.length === 0 || input.userId.length > 128) return none;
    const job = await store.exportJob.findFirst({
      where: jobFilter(ctx.actor.userId, input.userId),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, createdAt: true, expiresAt: true, storageKey: true },
    });
    if (!job) return none;
    const state = STATE_BY_STATUS[job.status];
    // A Succeeded job past its expiry is shown as Expired even before the sweep runs.
    const lapsed = job.status === "SUCCEEDED" && (!job.expiresAt || job.expiresAt <= now());
    const effective: LearnerExportState = lapsed ? "expired" : state;
    const canDownload = effective === "succeeded" && job.storageKey !== null;
    return {
      state: effective,
      jobId: job.id,
      requestedAt: job.createdAt,
      expiresAt: effective === "succeeded" ? job.expiresAt : null,
      canDownload,
      downloadPath: canDownload ? `/api/staff/reports/exports/${encodeURIComponent(job.id)}/download` : null,
      canRetry: effective === "failed",
      inFlight: effective === "queued" || effective === "processing",
    };
  }

  // ONE permission call site for the file (the licence boundary test pins one
  // reviewed override per file and permission). privacy.manage is a licence
  // "write" because it also guards anonymisation; this site carries the
  // reviewed continuity exception for LIC-08 permitted data access (ledger
  // P-03): preparing a person's data and reading its state keep working in
  // restricted mode. Global scope: an empty ResourceScope matches only a Global
  // grant, and privacy.manage is Global-only in the catalogue.
  type Operation =
    | { kind: "request"; input: RequestLearnerExportInput }
    | { kind: "status"; input: { userId: string } };
  const run = authorize<Operation>(
    "privacy.manage",
    () => ({}),
    { licence: "continuity", reason: "LIC-08 permitted data access" },
  )(
    async (operation, ctx): Promise<RequestLearnerExportResult | LearnerExportStatus> =>
      operation.kind === "request" ? requestHandler(operation.input, ctx) : statusHandler(operation.input, ctx),
  );

  return {
    requestLearnerExport: (input: RequestLearnerExportInput) =>
      run({ kind: "request", input }) as Promise<RequestLearnerExportResult>,
    getLearnerExportStatus: (input: { userId: string }) =>
      run({ kind: "status", input }) as Promise<LearnerExportStatus>,
  };
}

export const privacyExportService = createPrivacyExportService({
  store: prisma as unknown as PrivacyExportStore,
  withPermission,
  pipeline: {
    // Lazy: export-service imports this module (for the producer), so it cannot
    // be imported here at load time.
    requestExport: async (input) => (await import("@/server/services/export-service")).exportService.requestExport(input),
  },
});
