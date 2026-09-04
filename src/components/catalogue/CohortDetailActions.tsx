"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/primitives";
import { blockingFailures, type ReadinessItem } from "@/server/services/readiness-service";
import { ReadinessSummary } from "./ReadinessPanel";
import {
  cancelCohortAction,
  publishCohortAction,
  type CancelCohortActionResult,
  type PublishCohortActionResult,
} from "@/app/staff/cohorts/[id]/publish-actions";

/**
 * The cohort detail action bar (COH-04, COH-05, D-31).
 *
 * Edit is a plain link — the form is a separate route. Publish opens a
 * dialog embedding the shared `ReadinessSummary`, disabled while
 * `blockingFailures(items)` is non-empty; that disabling is ONLY a
 * courtesy echo of the server-side gate (`publishCohortAction` ->
 * `publishCohort`, which refuses regardless of what this button shows —
 * T-05-99). Cancel opens the shared `ConfirmModal` in `tone="danger"` with
 * a mandatory 10-character reason and states the blast radius up front
 * (D-31, T-05-104): how many active enrolments this will withdraw.
 *
 * A control the viewer cannot use is hidden as a courtesy only — every
 * matching Server Action re-checks the permission and refuses regardless
 * (T-05-100).
 */

export type CohortDetailActionsProps = {
  cohortId: string;
  code: string;
  status: string;
  expectedUpdatedAt: string;
  readinessItems: ReadinessItem[];
  /** Live count of ACTIVE enrolments — the number the cancel confirmation
   *  states will be withdrawn (D-31). */
  activeEnrolmentCount: number;
  /** Viewer holds `cohorts.publish`. */
  canPublish: boolean;
  /** Viewer holds `cohorts.manage` (Edit + Cancel). */
  canManage: boolean;
};

type Feedback = { tone: "success" | "danger"; text: string } | null;

function failureText(result: Extract<PublishCohortActionResult | CancelCohortActionResult, { ok: false }>) {
  if (result.reason === "NOT_READY") {
    return `${result.message} Blocking: ${result.failures.map((item) => item.label).join(", ")}.`;
  }
  return result.message;
}

export function CohortDetailActions({
  cohortId,
  code,
  status,
  expectedUpdatedAt,
  readinessItems,
  activeEnrolmentCount,
  canPublish,
  canManage,
}: CohortDetailActionsProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<null | "publish" | "cancel">(null);

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancelled = status === "CANCELLED";
  const draft = status === "DRAFT";

  function settle(result: PublishCohortActionResult | CancelCohortActionResult, successText: string) {
    if (result.ok) {
      setFeedback({ tone: "success", text: successText });
      router.refresh();
      return true;
    }
    setFeedback({ tone: "danger", text: failureText(result) });
    return false;
  }

  async function runPublish() {
    setBusy("publish");
    setPublishError(null);
    const result = await publishCohortAction({ cohortId, expectedUpdatedAt });
    setBusy(null);
    if (result.ok) {
      setPublishOpen(false);
      settle(result, "Cohort published.");
      return;
    }
    setPublishError(failureText(result));
  }

  async function runCancel(reason: string) {
    setBusy("cancel");
    setCancelError(null);
    const result = await cancelCohortAction({ cohortId, expectedUpdatedAt, reason });
    setBusy(null);
    if (result.ok) {
      setCancelOpen(false);
      settle(
        result,
        `Cohort cancelled. ${result.withdrawnCount} enrolment(s) withdrawn, ${result.cancelledCount} cancelled, ` +
          `${result.sessionsCancelled} session(s) cancelled.`,
      );
      return;
    }
    // Keep the modal open and show the refusal in it (T-05-104).
    setCancelError(failureText(result));
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      {feedback && (
        <p
          role="alert"
          className={`px-3 py-2 text-xs ${
            feedback.tone === "success"
              ? "border border-success/30 bg-success/10 text-success"
              : "border border-danger/30 bg-danger-surface text-danger"
          }`}
        >
          {feedback.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canManage && (
          <a
            href={`/staff/cohorts/${cohortId}/edit`}
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            Edit
          </a>
        )}

        {canPublish && draft && (
          <button
            type="button"
            onClick={() => {
              setPublishError(null);
              setPublishOpen(true);
            }}
            className="bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90"
          >
            Publish cohort
          </button>
        )}

        {canManage && !cancelled && (
          <button
            type="button"
            onClick={() => {
              setCancelError(null);
              setCancelOpen(true);
            }}
            className="border border-danger/40 bg-white px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-surface"
          >
            Cancel cohort
          </button>
        )}
      </div>

      <PublishCohortDialog
        open={publishOpen}
        code={code}
        items={readinessItems}
        pending={busy === "publish"}
        error={publishError}
        onCancel={() => setPublishOpen(false)}
        onPublish={runPublish}
      />

      <ConfirmModal
        open={cancelOpen}
        eyebrow="Integrity action"
        title={`Cancel cohort ${code}?`}
        description={
          <>
            Withdraws all {activeEnrolmentCount} active enrolment{activeEnrolmentCount === 1 ? "" : "s"} with the
            reason below and cancels every scheduled session. The cohort is kept as cancelled, never deleted.
          </>
        }
        confirmLabel="Cancel cohort"
        tone="danger"
        minReasonLength={10}
        reasonLabel="Reason for cancelling"
        pending={busy === "cancel"}
        error={cancelError}
        onConfirm={runCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The publish confirmation — a `ConfirmModal`-shaped dialog embedding the
// shared `ReadinessSummary` (UI-SPEC line 187). Publish is accent, NOT
// destructive (UI-SPEC line 118), and carries no mandatory reason since a
// cohort never migrates (unlike a course/programme publish).
// ---------------------------------------------------------------------------

type PublishCohortDialogProps = {
  open: boolean;
  code: string;
  items: ReadinessItem[];
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onPublish: () => void | Promise<void>;
};

function PublishCohortDialog(props: PublishCohortDialogProps) {
  if (!props.open) return null;
  return <PublishCohortDialogBody {...props} />;
}

function PublishCohortDialogBody({
  code,
  items,
  pending = false,
  error = null,
  onCancel,
  onPublish,
}: PublishCohortDialogProps) {
  const titleId = useId();
  // T-05-99: this is a courtesy echo of the server gate — `publishCohortAction`
  // calls `publishCohort`, which refuses regardless of what this button shows.
  const blocking = blockingFailures(items);
  const canPublish = blocking.length === 0 && !pending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto border border-zinc-300 bg-white p-5 shadow-lg"
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            Publish cohort
          </span>
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            Publish cohort {code}?
          </h2>
          <p className="text-sm text-zinc-600">
            Learners can find and enrol once it is published. All blocking readiness checks pass.
          </p>
          <ReadinessSummary items={items} />
        </div>

        {blocking.length > 0 && (
          <p role="alert" className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
            {blocking.length} blocking {blocking.length === 1 ? "item" : "items"} must be cleared first:{" "}
            {blocking.map((item) => item.label).join(", ")}.
          </p>
        )}

        {error && (
          <div role="alert" className="border border-danger/30 bg-danger-surface px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-danger">Action not applied</p>
            <p className="mt-0.5 text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4">
          <button
            type="button"
            disabled={!canPublish}
            onClick={() => onPublish()}
            className="bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Publishing…" : "Publish"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
