/**
 * Shapes and the overall-status rule for the Operations status page (plan 15-13).
 *
 * Pure module with no imports, so the server components and their component
 * tests can use it without loading the database client. The service in
 * `ops-status-service.ts` builds these shapes; the page only renders them.
 *
 * Privacy (P5): nothing here can carry a recipient address, an email body,
 * provider error text, a webhook payload, a learner name or an amount. The
 * only identifying text is a short reference, a template, dataset or event
 * label, a provider name or a reason label.
 */

/** A section either loaded or failed on its own, so one failure never hides the rest. */
export type OpsSectionError = { state: "error" };

export type OpsListSection<R, Extra extends object = Record<never, never>> =
  | ({ state: "ok"; rows: R[]; total: number } & Extra)
  | OpsSectionError;

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

export type OpsJobId =
  | "drain-domain-events"
  | "dispatch-export-jobs"
  | "process-export-jobs"
  | "expire-export-jobs"
  | "reconcile-payments"
  | "release-expired-holds"
  | "cleanup-stale-uploads"
  | "close-resolved-tickets"
  | "cleanup-notifications"
  | "check-licence";

/** running = "Running normally", idle = "Nothing waiting", untracked = "Not tracked". */
export type OpsJobStatus = "running" | "behind" | "failing" | "idle" | "untracked";

export type OpsJobDetail = {
  text: string;
  /** When set, the page renders "{text}: {time}". */
  at?: Date;
};

export type OpsJobRow = {
  id: OpsJobId;
  name: string;
  status: OpsJobStatus;
  lastActivityAt: Date | null;
  detail: OpsJobDetail;
};

export type OpsJobsSection = { state: "ok"; jobs: OpsJobRow[] } | OpsSectionError;

// ---------------------------------------------------------------------------
// Failed and stuck work
// ---------------------------------------------------------------------------

export type OpsFailedWorkRow = {
  /** Stable React key: kind plus the record id. */
  key: string;
  kind: "export_failed" | "export_waiting" | "event_stopped" | "event_retrying";
  /** Dataset label for an export, plain-words event label for an event. */
  label: string;
  /** First eight characters of the record id. */
  reference: string;
  /** Failure time, waiting-since time or the time the event occurred. */
  at: Date;
  /** Events only. */
  attempts: number | null;
  maxAttempts: number | null;
};

export type OpsFailedWorkSection = OpsListSection<OpsFailedWorkRow>;

// ---------------------------------------------------------------------------
// Payment exceptions
// ---------------------------------------------------------------------------

export type OpsPaymentExceptionRow =
  | { key: string; kind: "order"; orderId: string; orderReference: string; reasonLabel: string; at: Date }
  | { key: string; kind: "webhook"; provider: string; reason: "signature_invalid" | "exception"; at: Date }
  | { key: string; kind: "refund"; orderId: string; orderReference: string; at: Date }
  | { key: string; kind: "stuck_attempt"; orderId: string; minutes: number; at: Date };

export type OpsReconciliationSummary = { open: number; highRisk: number };

export type OpsPaymentSection = OpsListSection<OpsPaymentExceptionRow, { reconciliation: OpsReconciliationSummary }>;

// ---------------------------------------------------------------------------
// Email failures
// ---------------------------------------------------------------------------

export type OpsEmailFailureRow = {
  id: string;
  reference: string;
  /** Plain-words template name, never the raw id. */
  templateLabel: string;
  attempts: number;
  maxAttempts: number;
  /** When the last send was attempted; null when no attempt was recorded. */
  lastAttemptAt: Date | null;
  /** True for a SENDING row older than the stale-sending limit ("Stuck sending since {time}"). */
  stuckSending: boolean;
  /** Time shown for the row: the last attempt, falling back to creation. */
  since: Date;
};

export type OpsEmailSection = OpsListSection<OpsEmailFailureRow>;

// ---------------------------------------------------------------------------
// Data integrity checks
// ---------------------------------------------------------------------------

export type OpsIntegrityRow = {
  id: string;
  label: string;
  /** "error" means the check itself could not run. */
  status: "passed" | "violations" | "error";
  violationCount: number;
};

export type OpsIntegritySection = { state: "ok"; checks: OpsIntegrityRow[] } | OpsSectionError;

// ---------------------------------------------------------------------------
// The snapshot and its overall status
// ---------------------------------------------------------------------------

export type OpsStatus = {
  checkedAt: Date;
  jobs: OpsJobsSection;
  failedWork: OpsFailedWorkSection;
  paymentExceptions: OpsPaymentSection;
  emailFailures: OpsEmailSection;
  integrity: OpsIntegritySection;
};

export type OpsSummary = {
  /** Band figures; null when the section behind a figure failed to load. */
  failedJobs: number | null;
  paymentExceptions: number | null;
  emailFailures: number | null;
  /** True when anything needs a person: a count above zero, a Behind or Failing job, a failed check. */
  needsAttention: boolean;
  /** True when at least one section could not load. */
  hasSectionError: boolean;
};

/**
 * The overall status (UI-SPEC S1): "All clear" only when every count is zero and
 * no job is Behind or Failing. Open reconciliation cases count as payment
 * exceptions and a failing integrity check counts as needing attention, so the
 * band never says "All clear" above a section that lists a problem. A section
 * that failed to load is not evidence of health, so it never reads as clear.
 */
export function summariseOpsStatus(status: OpsStatus): OpsSummary {
  const failedJobs = status.failedWork.state === "ok" ? status.failedWork.total : null;
  const paymentExceptions =
    status.paymentExceptions.state === "ok"
      ? status.paymentExceptions.total + status.paymentExceptions.reconciliation.open
      : null;
  const emailFailures = status.emailFailures.state === "ok" ? status.emailFailures.total : null;

  const jobsNeedAttention =
    status.jobs.state === "ok" && status.jobs.jobs.some((job) => job.status === "behind" || job.status === "failing");
  const integrityNeedsAttention =
    status.integrity.state === "ok" && status.integrity.checks.some((check) => check.status !== "passed");
  const hasSectionError = [
    status.jobs.state,
    status.failedWork.state,
    status.paymentExceptions.state,
    status.emailFailures.state,
    status.integrity.state,
  ].includes("error");

  const needsAttention =
    (failedJobs ?? 0) > 0 ||
    (paymentExceptions ?? 0) > 0 ||
    (emailFailures ?? 0) > 0 ||
    jobsNeedAttention ||
    integrityNeedsAttention ||
    hasSectionError;

  return { failedJobs, paymentExceptions, emailFailures, needsAttention, hasSectionError };
}
