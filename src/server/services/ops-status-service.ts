/**
 * Operations status (Phase 15, plan 15-13; D-18, NFR-07, NFR-13).
 *
 * One read-only snapshot for the staff page `/staff/operations`: scheduled job
 * health, failed and stuck work, payment exceptions, email failures and the
 * data integrity checks. Everything is derived from records the product
 * already stores (email log, domain events, export jobs, orders, webhooks,
 * refunds, reconciliation cases, the licence state). There is no new table, no
 * heartbeat, no polling and no error-tracking vendor (ledger OQ6).
 *
 * Rules:
 *   - Gated by `audit.view` at Global scope through `withPermission`; that is
 *     the real control, the nav entry only hides the link.
 *   - Privacy (P5, T-15-13-01): a section returns references, template and
 *     dataset labels, reason labels, counts and times only. Never a recipient
 *     address, an email body, provider error text, a webhook payload, a learner
 *     name or an amount. Every query selects only the columns it returns.
 *   - Section isolation: each section runs on its own. A failing section comes
 *     back as `{ state: "error" }` (logged by error name only) and the others
 *     still return.
 *   - Lists hold at most `OPS_LIST_LIMIT` rows, newest first, plus an exact
 *     total so the page can say "Showing 10 of 11."
 *   - Job health is worked out from the work each job leaves waiting (ledger
 *     P-11): Behind means the oldest waiting item has waited longer than three
 *     times the job's schedule interval, with a 5-minute minimum. A job with no
 *     stored signal is reported as Not tracked, never guessed.
 *
 * Shape follows `email-delivery-log-service.ts` (dependency-injected factory
 * plus a singleton bound to prisma).
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import {
  MAX_EVENT_ATTEMPTS,
  MAX_SEND_ATTEMPTS,
  STALE_SENDING_MS,
} from "@/server/communications/contracts";
import { providerLabel } from "@/lib/humanize";
// `event-mappers/staff.ts` and `event-intent-mappers.ts` import each other, and the second builds
// the mapper table the moment it loads. Loading the intent module first (as the drain does) keeps
// the cycle from reading a mapper before it exists, so this side-effect import must stay first.
import "@/server/services/event-intent-mappers";
import {
  DEFAULT_ORDER_EXCEPTION_REASON_LABEL,
  ORDER_EXCEPTION_REASON_LABELS,
} from "@/server/services/event-mappers/staff";
import { REPORT_REGISTRY } from "@/server/services/report-registry";
import { integrityCheckService } from "@/server/services/integrity-check-service";
import type { IntegrityCheckResult } from "@/server/services/integrity-check-service";
import type {
  OpsEmailSection,
  OpsFailedWorkRow,
  OpsFailedWorkSection,
  OpsIntegritySection,
  OpsJobDetail,
  OpsJobId,
  OpsJobRow,
  OpsJobStatus,
  OpsJobsSection,
  OpsPaymentExceptionRow,
  OpsPaymentSection,
  OpsStatus,
} from "@/server/services/ops-status-types";

export type * from "@/server/services/ops-status-types";

type WithPermission = ReturnType<typeof createWithPermission>;

/** The Prisma client the service reads from (a structural alias, so tests can pass their own). */
export type OpsClient = typeof prisma;

/** At most this many rows per list; the page shows "Showing 10 of {n}." beyond it. */
export const OPS_LIST_LIMIT = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Job staleness rules (ledger P-11)
// ---------------------------------------------------------------------------

/** Behind never fires sooner than this, however short the schedule interval. */
export const BEHIND_MINIMUM_MS = 5 * MINUTE_MS;

/** Behind means waited longer than three schedule intervals, with a 5-minute minimum. */
export function behindThresholdMs(intervalMs: number): number {
  return Math.max(3 * intervalMs, BEHIND_MINIMUM_MS);
}

export type JobStalenessRule = {
  /** Name shown on the page (UI-SPEC S1). */
  name: string;
  /** Schedule interval in milliseconds; null for the on-demand background function. */
  intervalMs: number | null;
  /**
   * How long the oldest waiting item may wait before the job reads Behind; null
   * when no stored record shows the job's work, so the job reads Not tracked.
   */
  thresholdMs: number | null;
};

/** Export processing is not scheduled. Its own recovery reclaims a stuck export after 20 minutes. */
const EXPORT_PROCESSING_STALE_MS = 20 * MINUTE_MS;

/** Abandoned uploads become removable after 24 hours; resolved tickets close after 7 days. */
const UPLOAD_ABANDONED_AFTER_MS = DAY_MS;
const TICKET_CLOSE_AFTER_MS = 7 * DAY_MS;

/** A payment attempt still PROCESSING after this long is stuck (UI-SPEC S1 section 3). */
export const PAYMENT_STUCK_AFTER_MS = 45 * MINUTE_MS;

/**
 * Webhooks that were rejected or could not be applied cannot be resolved from
 * the page, so only recent ones are listed; older ones are in Reconciliation.
 */
export const WEBHOOK_LOOKBACK_MS = 14 * DAY_MS;

export const JOB_STALENESS: Record<OpsJobId, JobStalenessRule> = {
  "drain-domain-events": { name: "Event processing", intervalMs: MINUTE_MS, thresholdMs: behindThresholdMs(MINUTE_MS) },
  "dispatch-export-jobs": { name: "Export dispatch", intervalMs: MINUTE_MS, thresholdMs: behindThresholdMs(MINUTE_MS) },
  "process-export-jobs": { name: "Export processing", intervalMs: null, thresholdMs: EXPORT_PROCESSING_STALE_MS },
  "expire-export-jobs": { name: "Export expiry", intervalMs: 15 * MINUTE_MS, thresholdMs: behindThresholdMs(15 * MINUTE_MS) },
  "reconcile-payments": { name: "Payment reconciliation", intervalMs: 15 * MINUTE_MS, thresholdMs: behindThresholdMs(15 * MINUTE_MS) },
  "release-expired-holds": { name: "Seat hold release", intervalMs: 5 * MINUTE_MS, thresholdMs: behindThresholdMs(5 * MINUTE_MS) },
  "cleanup-stale-uploads": { name: "Upload cleanup", intervalMs: HOUR_MS, thresholdMs: behindThresholdMs(HOUR_MS) },
  "close-resolved-tickets": { name: "Ticket auto-close", intervalMs: HOUR_MS, thresholdMs: behindThresholdMs(HOUR_MS) },
  // Archiving leaves no "last run" record and no countable backlog worth a page, so it is not tracked.
  "cleanup-notifications": { name: "Notification cleanup", intervalMs: DAY_MS, thresholdMs: null },
  "check-licence": { name: "Licence check", intervalMs: HOUR_MS, thresholdMs: behindThresholdMs(HOUR_MS) },
};

/** Job names in the order the page lists them (UI-SPEC S1). */
const JOB_ORDER: readonly OpsJobId[] = [
  "drain-domain-events",
  "dispatch-export-jobs",
  "process-export-jobs",
  "expire-export-jobs",
  "reconcile-payments",
  "release-expired-holds",
  "cleanup-stale-uploads",
  "close-resolved-tickets",
  "cleanup-notifications",
  "check-licence",
];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** "staff-ticket-assigned" -> "Staff ticket assigned"; a stored code never reaches the page raw. */
export function labelFromCode(code: string): string {
  const words = code.replace(/[-_.]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "—";
}

/** The first eight characters of a record id, the short reference staff match elsewhere. */
export function shortReference(id: string): string {
  return id.slice(0, 8);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "less than a minute", "12 minutes", "3 hours", "2 days"; whole units, rounded down. */
export function waitText(ms: number): string {
  if (ms < MINUTE_MS) return "less than a minute";
  if (ms < 2 * HOUR_MS) return plural(Math.floor(ms / MINUTE_MS), "minute");
  if (ms < 2 * DAY_MS) return plural(Math.floor(ms / HOUR_MS), "hour");
  return plural(Math.floor(ms / DAY_MS), "day");
}

/** Behind is strictly longer than the threshold: waiting exactly the threshold is still on time. */
export function isBehind(waitedMs: number, thresholdMs: number): boolean {
  return waitedMs > thresholdMs;
}

/** A job's work-queue state: nothing waiting, waiting on time, or waiting too long. */
function queueState(
  count: number,
  oldestDueAt: Date | null,
  thresholdMs: number,
  at: Date,
): { status: "idle" | "running" | "behind"; waitedMs: number } {
  if (count <= 0 || !oldestDueAt) return { status: "idle", waitedMs: 0 };
  const waitedMs = Math.max(0, at.getTime() - oldestDueAt.getTime());
  return { status: isBehind(waitedMs, thresholdMs) ? "behind" : "running", waitedMs };
}

function earliest(...dates: (Date | null | undefined)[]): Date | null {
  const present = dates.filter((d): d is Date => d instanceof Date);
  if (present.length === 0) return null;
  return present.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

const EXTRA_DATASET_LABELS: Record<string, string> = {
  "reconciliation-refunds": "Reconciliation refunds",
  audit: "Audit",
};

function datasetLabel(dataset: string): string {
  const report = REPORT_REGISTRY.find((definition) => definition.id === dataset);
  return report?.label ?? EXTRA_DATASET_LABELS[dataset] ?? labelFromCode(dataset);
}

function orderExceptionLabel(reason: unknown): string {
  if (typeof reason === "string" && Object.hasOwn(ORDER_EXCEPTION_REASON_LABELS, reason)) {
    return ORDER_EXCEPTION_REASON_LABELS[reason];
  }
  return DEFAULT_ORDER_EXCEPTION_REASON_LABEL;
}

function readStringField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entry = (value as Record<string, unknown>)[field];
  return typeof entry === "string" ? entry : null;
}

function newestFirst<R extends { at: Date }>(rows: R[]): R[] {
  return [...rows].sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type OpsStatusServiceDeps = {
  client: OpsClient;
  withPermission: WithPermission;
  integrity: { runIntegrityChecks(): Promise<IntegrityCheckResult[]> };
  now?: () => Date;
  /** Receives one line naming the failed section and the error name, nothing else. */
  log?: (message: string) => void;
};

export function createOpsStatusService(deps: OpsStatusServiceDeps) {
  const { client, withPermission: authorize, integrity } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  /** Runs one section; a failure becomes `{ state: "error" }` and never reaches the others. */
  async function isolated<T>(name: string, load: () => Promise<T>): Promise<T | { state: "error" }> {
    try {
      return await load();
    } catch (error) {
      log(`[ops-status] section ${name} failed: ${error instanceof Error ? error.name : "unknown"}`);
      return { state: "error" };
    }
  }

  // ---- Scheduled jobs ------------------------------------------------------

  function jobRow(
    id: OpsJobId,
    status: OpsJobStatus,
    lastActivityAt: Date | null,
    detail: OpsJobDetail,
  ): OpsJobRow {
    return { id, name: JOB_STALENESS[id].name, status, lastActivityAt, detail };
  }

  /** Reads one job's health; a job that cannot be read is reported as an error for the whole section. */
  const jobLoaders: Record<OpsJobId, (at: Date) => Promise<OpsJobRow>> = {
    async "drain-domain-events"(at) {
      const threshold = JOB_STALENESS["drain-domain-events"].thresholdMs!;
      const [waiting, oldest, poisoned, last] = await Promise.all([
        client.domainEvent.count({ where: { processedAt: null } }),
        client.domainEvent.findFirst({
          where: { processedAt: null },
          orderBy: { occurredAt: "asc" },
          select: { occurredAt: true },
        }),
        client.domainEvent.count({ where: { processedAt: { not: null }, lastError: { not: null } } }),
        client.domainEvent.aggregate({
          where: { processedAt: { not: null }, lastError: null },
          _max: { processedAt: true },
        }),
      ]);
      const lastActivityAt = last._max.processedAt;
      if (poisoned > 0) {
        return jobRow("drain-domain-events", "failing", lastActivityAt, {
          text: `${plural(poisoned, "event")} stopped after ${MAX_EVENT_ATTEMPTS} attempts`,
        });
      }
      const { status, waitedMs } = queueState(waiting, oldest?.occurredAt ?? null, threshold, at);
      return jobRow("drain-domain-events", status, lastActivityAt, {
        text: status === "idle" ? "No events waiting" : `Oldest waiting event: ${waitText(waitedMs)}`,
      });
    },

    async "dispatch-export-jobs"(at) {
      const threshold = JOB_STALENESS["dispatch-export-jobs"].thresholdMs!;
      const [waiting, oldest, last] = await Promise.all([
        client.exportJob.count({ where: { status: "QUEUED" } }),
        client.exportJob.findFirst({
          where: { status: "QUEUED" },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
        client.exportJob.aggregate({ _max: { startedAt: true } }),
      ]);
      const { status } = queueState(waiting, oldest?.createdAt ?? null, threshold, at);
      return jobRow("dispatch-export-jobs", status, last._max.startedAt, {
        text: status === "idle" ? "No exports waiting" : `${plural(waiting, "export")} waiting`,
      });
    },

    async "process-export-jobs"(at) {
      const threshold = JOB_STALENESS["process-export-jobs"].thresholdMs!;
      const staleBefore = new Date(at.getTime() - threshold);
      const [failed, processing, stale, last] = await Promise.all([
        client.exportJob.count({ where: { status: "FAILED", retries: { none: {} } } }),
        client.exportJob.count({ where: { status: "PROCESSING" } }),
        client.exportJob.count({
          where: {
            status: "PROCESSING",
            OR: [{ startedAt: { lt: staleBefore } }, { startedAt: null, updatedAt: { lt: staleBefore } }],
          },
        }),
        client.exportJob.aggregate({ _max: { completedAt: true } }),
      ]);
      const lastActivityAt = last._max.completedAt;
      if (failed > 0) {
        return jobRow("process-export-jobs", "failing", lastActivityAt, {
          text: `${plural(failed, "failed export")}`,
        });
      }
      if (stale > 0) {
        return jobRow("process-export-jobs", "behind", lastActivityAt, {
          text: `${plural(stale, "export")} processing longer than expected`,
        });
      }
      if (processing > 0) {
        return jobRow("process-export-jobs", "running", lastActivityAt, {
          text: `${plural(processing, "export")} processing`,
        });
      }
      return jobRow("process-export-jobs", "idle", lastActivityAt, { text: "No exports processing" });
    },

    async "expire-export-jobs"(at) {
      const threshold = JOB_STALENESS["expire-export-jobs"].thresholdMs!;
      const where = { status: "SUCCEEDED", storageKey: { not: null }, expiresAt: { lte: at } } as const;
      const [waiting, oldest, last] = await Promise.all([
        client.exportJob.count({ where }),
        client.exportJob.findFirst({ where, orderBy: { expiresAt: "asc" }, select: { expiresAt: true } }),
        client.exportJob.aggregate({ where: { status: "EXPIRED" }, _max: { updatedAt: true } }),
      ]);
      const { status } = queueState(waiting, oldest?.expiresAt ?? null, threshold, at);
      return jobRow("expire-export-jobs", status, last._max.updatedAt, {
        text: status === "idle" ? "No exports waiting to expire" : `${plural(waiting, "export")} waiting to expire`,
      });
    },

    async "reconcile-payments"(at) {
      const threshold = JOB_STALENESS["reconcile-payments"].thresholdMs!;
      const where: Prisma.PaymentAttemptWhereInput = {
        status: "SUCCEEDED",
        reconciledAt: null,
        provider: { in: ["PAYSTACK", "STRIPE"] },
      };
      const [waiting, oldest, last] = await Promise.all([
        client.paymentAttempt.count({ where }),
        client.paymentAttempt.findFirst({
          where,
          orderBy: [{ confirmedAt: { sort: "asc", nulls: "last" } }, { initiatedAt: "asc" }],
          select: { confirmedAt: true, initiatedAt: true },
        }),
        client.paymentAttempt.aggregate({ _max: { reconciledAt: true } }),
      ]);
      const { status } = queueState(waiting, oldest ? (oldest.confirmedAt ?? oldest.initiatedAt) : null, threshold, at);
      return jobRow("reconcile-payments", status, last._max.reconciledAt, {
        text: status === "idle" ? "No payments waiting" : `${plural(waiting, "payment")} waiting to be checked`,
      });
    },

    async "release-expired-holds"(at) {
      const threshold = JOB_STALENESS["release-expired-holds"].thresholdMs!;
      const where: Prisma.EnrolmentWhereInput = {
        status: "PENDING_PAYMENT",
        holdExpiresAt: { not: null, lt: at },
      };
      const [waiting, oldest, last] = await Promise.all([
        client.enrolment.count({ where }),
        client.enrolment.findFirst({ where, orderBy: { holdExpiresAt: "asc" }, select: { holdExpiresAt: true } }),
        client.auditEvent.aggregate({ where: { action: "enrolment.hold_expired" }, _max: { createdAt: true } }),
      ]);
      const { status } = queueState(waiting, oldest?.holdExpiresAt ?? null, threshold, at);
      return jobRow("release-expired-holds", status, last._max.createdAt, {
        text: status === "idle" ? "No expired holds waiting" : `${plural(waiting, "expired hold")} waiting for release`,
      });
    },

    async "cleanup-stale-uploads"(at) {
      const threshold = JOB_STALENESS["cleanup-stale-uploads"].thresholdMs!;
      const dueBefore = new Date(at.getTime() - UPLOAD_ABANDONED_AFTER_MS);
      const where = { uploadStatus: "UPLOADING", createdAt: { lt: dueBefore } } as const;
      const [lessons, lessonOldest, attachments, attachmentOldest, last] = await Promise.all([
        client.lessonResource.count({ where }),
        client.lessonResource.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
        client.ticketAttachment.count({ where }),
        client.ticketAttachment.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
        client.auditEvent.aggregate({ where: { action: "lessonresource.upload_abandoned" }, _max: { createdAt: true } }),
      ]);
      const oldest = earliest(lessonOldest?.createdAt, attachmentOldest?.createdAt);
      const waiting = lessons + attachments;
      // The work is due 24 hours after the upload started, so the wait counts from then.
      const oldestDueAt = oldest ? new Date(oldest.getTime() + UPLOAD_ABANDONED_AFTER_MS) : null;
      const { status } = queueState(waiting, oldestDueAt, threshold, at);
      return jobRow("cleanup-stale-uploads", status, last._max.createdAt, {
        text: status === "idle" ? "No abandoned uploads waiting" : `${plural(waiting, "abandoned upload")} waiting to be removed`,
      });
    },

    async "close-resolved-tickets"(at) {
      const threshold = JOB_STALENESS["close-resolved-tickets"].thresholdMs!;
      const dueBefore = new Date(at.getTime() - TICKET_CLOSE_AFTER_MS);
      const where: Prisma.TicketWhereInput = { status: "RESOLVED", resolvedAt: { lte: dueBefore } };
      const [waiting, oldest, last] = await Promise.all([
        client.ticket.count({ where }),
        client.ticket.findFirst({ where, orderBy: { resolvedAt: "asc" }, select: { resolvedAt: true } }),
        client.auditEvent.aggregate({ where: { action: "ticket.auto_closed" }, _max: { createdAt: true } }),
      ]);
      // A ticket is due for closing 7 days after it was resolved, so the wait counts from then.
      const oldestDueAt = oldest?.resolvedAt ? new Date(oldest.resolvedAt.getTime() + TICKET_CLOSE_AFTER_MS) : null;
      const { status } = queueState(waiting, oldestDueAt, threshold, at);
      return jobRow("close-resolved-tickets", status, last._max.createdAt, {
        text: status === "idle" ? "No resolved tickets waiting" : `${plural(waiting, "resolved ticket")} waiting to be closed`,
      });
    },

    async "cleanup-notifications"() {
      return jobRow("cleanup-notifications", "untracked", null, {
        text: "No stored record shows when this job last ran. Check the host's function log.",
      });
    },

    async "check-licence"(at) {
      const threshold = JOB_STALENESS["check-licence"].thresholdMs!;
      const state = await client.licenceState.findUnique({
        where: { id: "current" },
        select: { lastVerifiedAt: true },
      });
      const verifiedAt = state?.lastVerifiedAt ?? null;
      if (!verifiedAt) {
        return jobRow("check-licence", "untracked", null, {
          text: "No stored record shows when this job last ran. Check the host's function log.",
        });
      }
      const waitedMs = Math.max(0, at.getTime() - verifiedAt.getTime());
      return jobRow("check-licence", isBehind(waitedMs, threshold) ? "behind" : "running", verifiedAt, {
        text: "Last licence check",
        at: verifiedAt,
      });
    },
  };

  async function loadJobs(at: Date): Promise<OpsJobsSection> {
    const jobs = await Promise.all(JOB_ORDER.map((id) => jobLoaders[id](at)));
    return { state: "ok", jobs };
  }

  // ---- Failed and stuck work -----------------------------------------------

  async function loadFailedWork(at: Date): Promise<OpsFailedWorkSection> {
    const queuedBefore = new Date(at.getTime() - JOB_STALENESS["dispatch-export-jobs"].thresholdMs!);
    const processingBefore = new Date(at.getTime() - JOB_STALENESS["process-export-jobs"].thresholdMs!);

    // A failed export that was retried is closed by its retry (the failed row stays for the record).
    const failedExportWhere: Prisma.ExportJobWhereInput = { status: "FAILED", retries: { none: {} } };
    const waitingExportWhere: Prisma.ExportJobWhereInput = {
      OR: [
        { status: "QUEUED", createdAt: { lt: queuedBefore } },
        {
          status: "PROCESSING",
          OR: [{ startedAt: { lt: processingBefore } }, { startedAt: null, updatedAt: { lt: processingBefore } }],
        },
      ],
    };
    const poisonedWhere: Prisma.DomainEventWhereInput = { processedAt: { not: null }, lastError: { not: null } };
    const retryingWhere: Prisma.DomainEventWhereInput = { processedAt: null, attempts: { gt: 0 } };

    const [failedExports, failedExportTotal, waitingExports, waitingExportTotal, poisoned, poisonedTotal, retrying, retryingTotal] =
      await Promise.all([
        client.exportJob.findMany({
          where: failedExportWhere,
          orderBy: { updatedAt: "desc" },
          take: OPS_LIST_LIMIT,
          select: { id: true, dataset: true, updatedAt: true, completedAt: true },
        }),
        client.exportJob.count({ where: failedExportWhere }),
        client.exportJob.findMany({
          where: waitingExportWhere,
          orderBy: { createdAt: "desc" },
          take: OPS_LIST_LIMIT,
          select: { id: true, dataset: true, status: true, createdAt: true, startedAt: true, updatedAt: true },
        }),
        client.exportJob.count({ where: waitingExportWhere }),
        client.domainEvent.findMany({
          where: poisonedWhere,
          orderBy: { processedAt: "desc" },
          take: OPS_LIST_LIMIT,
          // Never lastError or payload: they can carry internal or personal detail.
          select: { id: true, type: true, attempts: true, processedAt: true, occurredAt: true },
        }),
        client.domainEvent.count({ where: poisonedWhere }),
        client.domainEvent.findMany({
          where: retryingWhere,
          orderBy: { occurredAt: "desc" },
          take: OPS_LIST_LIMIT,
          select: { id: true, type: true, attempts: true, occurredAt: true },
        }),
        client.domainEvent.count({ where: retryingWhere }),
      ]);

    const rows: OpsFailedWorkRow[] = [
      ...failedExports.map((row): OpsFailedWorkRow => ({
        key: `export_failed:${row.id}`,
        kind: "export_failed",
        label: datasetLabel(row.dataset),
        reference: shortReference(row.id),
        at: row.completedAt ?? row.updatedAt,
        attempts: null,
        maxAttempts: null,
      })),
      ...waitingExports.map((row): OpsFailedWorkRow => ({
        key: `export_waiting:${row.id}`,
        kind: "export_waiting",
        label: datasetLabel(row.dataset),
        reference: shortReference(row.id),
        at: row.status === "PROCESSING" ? (row.startedAt ?? row.updatedAt) : row.createdAt,
        attempts: null,
        maxAttempts: null,
      })),
      ...poisoned.map((row): OpsFailedWorkRow => ({
        key: `event_stopped:${row.id}`,
        kind: "event_stopped",
        label: labelFromCode(row.type),
        reference: shortReference(row.id),
        at: row.processedAt ?? row.occurredAt,
        attempts: row.attempts,
        maxAttempts: MAX_EVENT_ATTEMPTS,
      })),
      ...retrying.map((row): OpsFailedWorkRow => ({
        key: `event_retrying:${row.id}`,
        kind: "event_retrying",
        label: labelFromCode(row.type),
        reference: shortReference(row.id),
        at: row.occurredAt,
        attempts: row.attempts,
        maxAttempts: MAX_EVENT_ATTEMPTS,
      })),
    ];

    return {
      state: "ok",
      rows: newestFirst(rows).slice(0, OPS_LIST_LIMIT),
      total: failedExportTotal + waitingExportTotal + poisonedTotal + retryingTotal,
    };
  }

  // ---- Payment exceptions --------------------------------------------------

  async function loadPaymentExceptions(at: Date): Promise<OpsPaymentSection> {
    const webhookSince = new Date(at.getTime() - WEBHOOK_LOOKBACK_MS);
    const stuckBefore = new Date(at.getTime() - PAYMENT_STUCK_AFTER_MS);

    const orderWhere: Prisma.OrderWhereInput = { status: "EXCEPTION" };
    const webhookWhere: Prisma.WebhookEventWhereInput = {
      status: { in: ["SIGNATURE_INVALID", "EXCEPTION"] },
      receivedAt: { gte: webhookSince },
    };
    const refundWhere: Prisma.RefundWhereInput = { status: "FAILED" };
    const stuckWhere: Prisma.PaymentAttemptWhereInput = { status: "PROCESSING", initiatedAt: { lt: stuckBefore } };
    const openCaseWhere: Prisma.ReconciliationCaseWhereInput = { status: { in: ["OPEN", "REOPENED"] } };

    const [
      orders,
      orderTotal,
      webhooks,
      webhookTotal,
      refunds,
      refundTotal,
      stuck,
      stuckTotal,
      openCases,
      highRiskCases,
    ] = await Promise.all([
      client.order.findMany({
        where: orderWhere,
        orderBy: { updatedAt: "desc" },
        take: OPS_LIST_LIMIT,
        select: { id: true, reference: true, updatedAt: true },
      }),
      client.order.count({ where: orderWhere }),
      client.webhookEvent.findMany({
        where: webhookWhere,
        orderBy: { receivedAt: "desc" },
        take: OPS_LIST_LIMIT,
        // Never payload, error or the provider's event id.
        select: { id: true, provider: true, status: true, receivedAt: true },
      }),
      client.webhookEvent.count({ where: webhookWhere }),
      client.refund.findMany({
        where: refundWhere,
        orderBy: { createdAt: "desc" },
        take: OPS_LIST_LIMIT,
        select: { id: true, orderId: true, createdAt: true, completedAt: true, order: { select: { reference: true } } },
      }),
      client.refund.count({ where: refundWhere }),
      client.paymentAttempt.findMany({
        where: stuckWhere,
        orderBy: { initiatedAt: "desc" },
        take: OPS_LIST_LIMIT,
        select: { id: true, orderId: true, initiatedAt: true },
      }),
      client.paymentAttempt.count({ where: stuckWhere }),
      client.reconciliationCase.count({ where: openCaseWhere }),
      client.reconciliationCase.count({ where: { ...openCaseWhere, risk: "CAPTURED_MONEY" } }),
    ]);

    // The coded reason for each listed order comes from its latest order.exception event.
    const reasonByOrder = new Map<string, string>();
    if (orders.length > 0) {
      const events = await client.domainEvent.findMany({
        where: {
          type: "order.exception",
          OR: orders.map((order) => ({ payload: { path: ["orderId"], equals: order.id } })),
        },
        orderBy: { occurredAt: "desc" },
        select: { payload: true },
      });
      for (const event of events) {
        const orderId = readStringField(event.payload, "orderId");
        const reason = readStringField(event.payload, "reason");
        if (orderId && reason && !reasonByOrder.has(orderId)) reasonByOrder.set(orderId, reason);
      }
    }

    const rows: OpsPaymentExceptionRow[] = [
      ...orders.map((order): OpsPaymentExceptionRow => ({
        key: `order:${order.id}`,
        kind: "order",
        orderId: order.id,
        orderReference: order.reference,
        reasonLabel: orderExceptionLabel(reasonByOrder.get(order.id)),
        at: order.updatedAt,
      })),
      ...webhooks.map((hook): OpsPaymentExceptionRow => ({
        key: `webhook:${hook.id}`,
        kind: "webhook",
        provider: providerLabel(hook.provider),
        reason: hook.status === "SIGNATURE_INVALID" ? "signature_invalid" : "exception",
        at: hook.receivedAt,
      })),
      ...refunds.map((refund): OpsPaymentExceptionRow => ({
        key: `refund:${refund.id}`,
        kind: "refund",
        orderId: refund.orderId,
        orderReference: refund.order.reference,
        at: refund.completedAt ?? refund.createdAt,
      })),
      ...stuck.map((attempt): OpsPaymentExceptionRow => ({
        key: `stuck:${attempt.id}`,
        kind: "stuck_attempt",
        orderId: attempt.orderId,
        minutes: Math.floor((at.getTime() - attempt.initiatedAt.getTime()) / MINUTE_MS),
        at: attempt.initiatedAt,
      })),
    ];

    return {
      state: "ok",
      rows: newestFirst(rows).slice(0, OPS_LIST_LIMIT),
      total: orderTotal + webhookTotal + refundTotal + stuckTotal,
      reconciliation: { open: openCases, highRisk: highRiskCases },
    };
  }

  // ---- Email failures (UI-SPEC S1 section 4; NFR-13) -------------------------

  async function loadEmailFailures(at: Date): Promise<OpsEmailSection> {
    const staleBefore = new Date(at.getTime() - STALE_SENDING_MS);
    const where: Prisma.EmailDispatchWhereInput = {
      OR: [
        { status: "FAILED" },
        {
          status: "SENDING",
          OR: [
            { lastAttemptAt: { lt: staleBefore } },
            { lastAttemptAt: null, createdAt: { lt: staleBefore } },
          ],
        },
      ],
    };
    const [rows, total] = await Promise.all([
      client.emailDispatch.findMany({
        where,
        orderBy: [{ lastAttemptAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: OPS_LIST_LIMIT,
        // Never toEmail, error, templateParams or any body field (P5).
        select: { id: true, template: true, attempts: true, lastAttemptAt: true, status: true, createdAt: true },
      }),
      client.emailDispatch.count({ where }),
    ]);
    return {
      state: "ok",
      total,
      rows: rows.map((row) => ({
        id: row.id,
        reference: shortReference(row.id),
        templateLabel: labelFromCode(row.template),
        attempts: row.attempts,
        maxAttempts: MAX_SEND_ATTEMPTS,
        lastAttemptAt: row.lastAttemptAt,
        stuckSending: row.status === "SENDING",
        since: row.lastAttemptAt ?? row.createdAt,
      })),
    };
  }

  // ---- Data integrity checks -------------------------------------------------

  async function loadIntegrity(): Promise<OpsIntegritySection> {
    const results = await integrity.runIntegrityChecks();
    return {
      state: "ok",
      // Counts and status only: the sample ids stay in the CLI output.
      checks: results.map((result) => ({
        id: result.id,
        label: result.label,
        status: result.status,
        violationCount: result.violationCount,
      })),
    };
  }

  const getOperationsStatusInternal = authorize<Record<string, never>>("audit.view", () => ({}))(
    async (): Promise<OpsStatus> => {
      const checkedAt = now();
      const [jobs, failedWork, paymentExceptions, emailFailures, integritySection] = await Promise.all([
        isolated("jobs", () => loadJobs(checkedAt)),
        isolated("failedWork", () => loadFailedWork(checkedAt)),
        isolated("paymentExceptions", () => loadPaymentExceptions(checkedAt)),
        isolated("emailFailures", () => loadEmailFailures(checkedAt)),
        isolated("integrity", () => loadIntegrity()),
      ]);
      return { checkedAt, jobs, failedWork, paymentExceptions, emailFailures, integrity: integritySection };
    },
  );

  return {
    getOperationsStatus: (): Promise<OpsStatus> => getOperationsStatusInternal({}),
  };
}

export const opsStatusService = createOpsStatusService({
  client: prisma,
  withPermission,
  integrity: integrityCheckService,
  log: (message) => console.error(message),
});
