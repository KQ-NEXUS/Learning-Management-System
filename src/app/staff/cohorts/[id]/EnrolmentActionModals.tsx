"use client";

/**
 * The five COH-05 enrolment-action confirmations — add, approve, transfer,
 * withdraw, cancel — each behind a mandatory 10-character reason, per the
 * UI-SPEC's per-action confirmation table (lines 156-167).
 *
 * A shared, controlled component rather than five call sites duplicating
 * pending/error bookkeeping: the caller (the cohort Roster tab, and later
 * the global `/staff/enrolments` list) only decides WHICH action is open by
 * setting `target`; this file owns the reason capture, the in-flight state,
 * and rendering a failed action's message through `ConfirmModal`'s `error`
 * slot so it reads as "action not applied" (T-05-97).
 *
 * Only one `ConfirmModal` is ever actually open at a time — each is passed
 * `open={target?.action === "..."}`, and the primitive itself renders
 * nothing while `open` is false.
 */

import { useState } from "react";
import { ConfirmModal } from "@/components/primitives";
import {
  addEnrolmentAction,
  approveEnrolmentAction,
  transferEnrolmentAction,
  withdrawEnrolmentAction,
  cancelEnrolmentAction,
  type EnrolmentActionResult,
} from "./enrolment-actions";

/** Every action carries `cohortId` for revalidation (D-10) — see enrolment-actions.ts. */
export type EnrolmentActionTarget =
  | { action: "add"; cohortId: string }
  | { action: "approve"; cohortId: string; enrolmentId: string; learnerName: string }
  | { action: "transfer"; cohortId: string; enrolmentId: string; learnerName: string }
  | { action: "withdraw"; cohortId: string; enrolmentId: string; learnerName: string }
  | { action: "cancel"; cohortId: string; enrolmentId: string; learnerName: string };

export type EnrolmentActionModalsProps = {
  target: EnrolmentActionTarget | null;
  onClose: () => void;
  /** Called once an action completes successfully — the caller re-fetches (router.refresh()). */
  onSuccess: () => void;
  /** Cohorts of the same course/programme as the source (D-13) — the transfer target picker. */
  siblingCohorts?: { id: string; code: string }[];
  /** Learners eligible for a comped/corporate add — best-effort, supplied by the mounting page. */
  candidateLearners?: { id: string; name: string; email: string }[];
};

const MIN_REASON_LENGTH = 10;

const FIELD_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const FIELD_INPUT = "rounded-md border border-input-border bg-surface px-2 py-1 text-sm text-foreground";

export function EnrolmentActionModals({
  target,
  onClose,
  onSuccess,
  siblingCohorts = [],
  candidateLearners = [],
}: EnrolmentActionModalsProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addLearnerId, setAddLearnerId] = useState("");
  const [addTarget, setAddTarget] = useState<"ACTIVE" | "PENDING_PAYMENT">("ACTIVE");
  const [transferTargetCohortId, setTransferTargetCohortId] = useState("");

  function close() {
    setError(null);
    setPending(false);
    setAddLearnerId("");
    setAddTarget("ACTIVE");
    setTransferTargetCohortId("");
    onClose();
  }

  async function run(action: Promise<EnrolmentActionResult>) {
    setPending(true);
    setError(null);
    const result = await action;
    setPending(false);
    if (result.ok) {
      close();
      onSuccess();
    } else {
      setError(result.message);
    }
  }

  const transferTargetCode = siblingCohorts.find((c) => c.id === transferTargetCohortId)?.code;

  return (
    <>
      <ConfirmModal
        open={target?.action === "add"}
        title="Add enrolment?"
        description={
          <div className="flex flex-col gap-2">
            <p>
              Adds a comped, corporate or scholarship learner directly, bypassing checkout. The
              reason is audited.
            </p>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Learner</span>
              {candidateLearners.length > 0 ? (
                <select
                  value={addLearnerId}
                  onChange={(e) => setAddLearnerId(e.target.value)}
                  className={FIELD_INPUT}
                >
                  <option value="">Select a learner…</option>
                  {candidateLearners.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} · {l.email}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={addLearnerId}
                  onChange={(e) => setAddLearnerId(e.target.value)}
                  placeholder="Learner id"
                  className={FIELD_INPUT}
                />
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Target status</span>
              <select
                value={addTarget}
                onChange={(e) => setAddTarget(e.target.value as "ACTIVE" | "PENDING_PAYMENT")}
                className={FIELD_INPUT}
              >
                <option value="ACTIVE">Active — seat taken now</option>
                <option value="PENDING_PAYMENT">Pending payment — seat held per cohort policy</option>
              </select>
            </label>
          </div>
        }
        confirmLabel="Add enrolment"
        tone="default"
        minReasonLength={MIN_REASON_LENGTH}
        pending={pending}
        error={error}
        onConfirm={(reason) => {
          if (!target || target.action !== "add") return;
          if (!addLearnerId) {
            setError("Choose a learner first.");
            return;
          }
          run(
            addEnrolmentAction({
              cohortId: target.cohortId,
              userId: addLearnerId,
              target: addTarget,
              reason,
            }),
          );
        }}
        onCancel={close}
      />

      <ConfirmModal
        open={target?.action === "approve"}
        title={`Approve ${target?.action === "approve" ? target.learnerName : ""}?`}
        description="Moves this pending enrolment to active with no payment recorded. The reason is audited."
        confirmLabel="Approve"
        tone="default"
        minReasonLength={MIN_REASON_LENGTH}
        pending={pending}
        error={error}
        onConfirm={(reason) => {
          if (!target || target.action !== "approve") return;
          run(
            approveEnrolmentAction({
              cohortId: target.cohortId,
              enrolmentId: target.enrolmentId,
              reason,
            }),
          );
        }}
        onCancel={close}
      />

      <ConfirmModal
        open={target?.action === "transfer"}
        title={`Transfer ${target?.action === "transfer" ? target.learnerName : ""} to ${
          transferTargetCode ?? "…"
        }?`}
        description={
          <div className="flex flex-col gap-2">
            <p>
              A new active enrolment is created in the target cohort and this one is marked
              transferred. Attendance and progress do not move.
            </p>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Target cohort</span>
              <select
                value={transferTargetCohortId}
                onChange={(e) => setTransferTargetCohortId(e.target.value)}
                className={FIELD_INPUT}
              >
                <option value="">Select a cohort of the same offer…</option>
                {siblingCohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </select>
              {siblingCohorts.length === 0 && (
                <span className="text-[11px] text-muted-foreground">No other cohort shares this offer yet.</span>
              )}
            </label>
          </div>
        }
        confirmLabel="Transfer"
        tone="default"
        minReasonLength={MIN_REASON_LENGTH}
        pending={pending}
        error={error}
        onConfirm={(reason) => {
          if (!target || target.action !== "transfer") return;
          if (!transferTargetCohortId) {
            setError("Choose a target cohort first.");
            return;
          }
          run(
            transferEnrolmentAction({
              cohortId: target.cohortId,
              enrolmentId: target.enrolmentId,
              targetCohortId: transferTargetCohortId,
              reason,
            }),
          );
        }}
        onCancel={close}
      />

      <ConfirmModal
        open={target?.action === "withdraw"}
        title={`Withdraw ${target?.action === "withdraw" ? target.learnerName : ""}?`}
        description="Access ends now and the seat is released. Attendance and progress stay on this enrolment."
        confirmLabel="Withdraw"
        tone="danger"
        minReasonLength={MIN_REASON_LENGTH}
        pending={pending}
        error={error}
        onConfirm={(reason) => {
          if (!target || target.action !== "withdraw") return;
          run(
            withdrawEnrolmentAction({
              cohortId: target.cohortId,
              enrolmentId: target.enrolmentId,
              reason,
            }),
          );
        }}
        onCancel={close}
      />

      <ConfirmModal
        open={target?.action === "cancel"}
        title={`Cancel ${target?.action === "cancel" ? target.learnerName : ""}'s enrolment?`}
        description="Use before access starts, or to void an enrolment made in error. The seat is released."
        confirmLabel="Cancel enrolment"
        tone="danger"
        minReasonLength={MIN_REASON_LENGTH}
        pending={pending}
        error={error}
        onConfirm={(reason) => {
          if (!target || target.action !== "cancel") return;
          run(
            cancelEnrolmentAction({
              cohortId: target.cohortId,
              enrolmentId: target.enrolmentId,
              reason,
            }),
          );
        }}
        onCancel={close}
      />
    </>
  );
}
