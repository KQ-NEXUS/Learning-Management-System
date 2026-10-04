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

import { useCallback, useState } from "react";
import { ConfirmModal } from "@/components/primitives";
import { PersonPickerDialog, type PickablePerson } from "@/components/people/PersonPickerDialog";
import {
  addEnrolmentAction,
  listEnrolmentCandidatesAction,
  approveEnrolmentAction,
  transferEnrolmentAction,
  withdrawEnrolmentAction,
  cancelEnrolmentAction,
  type EnrolmentActionResult,
} from "./enrolment-actions";
import { useToast } from "@/components/feedback/Toaster";

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
};

/** Why a learner is listed but cannot be chosen, by the status of the place they already hold here. */
const HOLDING_REASON: Record<string, string> = {
  ACTIVE: "Already enrolled here",
  COMPLETED: "Completed this cohort",
  PENDING_PAYMENT: "Awaiting payment here",
};

const MIN_REASON_LENGTH = 10;

/** What the corner confirmation says once each roster action has gone through. */
const ENROLMENT_SUCCESS: Record<string, string> = {
  add: "Learner added to the cohort",
  approve: "Enrolment approved",
  transfer: "Learner transferred",
  withdraw: "Learner withdrawn",
  cancel: "Enrolment cancelled",
};

const FIELD_LABEL = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const FIELD_INPUT = "rounded-md border border-input-border bg-surface px-2 py-1 text-sm text-foreground";

export function EnrolmentActionModals({
  target,
  onClose,
  onSuccess,
  siblingCohorts = [],
}: EnrolmentActionModalsProps) {
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  // Adding is two steps: choose the learner in the picker, then give the reason. `choosingLearner`
  // reopens the picker from the second step ("Change"). The two are never open at once.
  const [addLearner, setAddLearner] = useState<PickablePerson | null>(null);
  const [choosingLearner, setChoosingLearner] = useState(false);
  const [addTarget, setAddTarget] = useState<"ACTIVE" | "PENDING_PAYMENT">("ACTIVE");
  const [transferTargetCohortId, setTransferTargetCohortId] = useState("");

  function close() {
    setError(null);
    setPending(false);
    setAddLearner(null);
    setChoosingLearner(false);
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
      toast.success(ENROLMENT_SUCCESS[target?.action ?? ""] ?? "Enrolment updated");
      close();
      onSuccess();
    } else {
      setError(result.message);
    }
  }

  const addCohortId = target?.action === "add" ? target.cohortId : null;
  const loadLearners = useCallback(
    async (query: string) => {
      if (!addCohortId) return { ok: false as const, message: "The list could not be loaded." };
      const result = await listEnrolmentCandidatesAction({ cohortId: addCohortId, query });
      if (!result.ok) return result;
      return {
        ok: true as const,
        people: result.people.map((person) => ({
          id: person.id,
          name: person.name,
          email: person.email,
          reference: person.learnerNumber ?? undefined,
          detail: person.unverified ? "Email not confirmed" : undefined,
          disabledReason: person.enrolledStatus
            ? (HOLDING_REASON[person.enrolledStatus] ?? "Already in this cohort")
            : undefined,
        })),
        note:
          result.total > result.people.length
            ? `Showing the first ${result.people.length} of ${result.total} learners. Search to narrow the list.`
            : undefined,
      };
    },
    [addCohortId],
  );
  const pickingLearner = target?.action === "add" && (addLearner === null || choosingLearner);

  const transferTargetCode = siblingCohorts.find((c) => c.id === transferTargetCohortId)?.code;

  return (
    <>
      <PersonPickerDialog
        open={pickingLearner}
        title="Choose a learner"
        description="Learners with an account. Search by learner number if you do not know the name."
        searchLabel="Search by name, email or learner number"
        confirmLabel="Continue"
        emptyText="No learners have an account yet."
        selectedId={addLearner?.id ?? null}
        load={loadLearners}
        onConfirm={(person) => {
          setAddLearner(person);
          setChoosingLearner(false);
          setError(null);
        }}
        // Leaving the picker without ever choosing abandons the add; leaving it after "Change" keeps the choice.
        onClose={() => (addLearner ? setChoosingLearner(false) : close())}
      />

      <ConfirmModal
        open={target?.action === "add" && !pickingLearner}
        title={`Add ${addLearner?.name ?? "learner"} to this cohort?`}
        description={
          <div className="flex flex-col gap-2">
            <p>
              Adds a comped, corporate or scholarship learner directly, bypassing checkout. The
              reason is audited.
            </p>
            <div className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Learner</span>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">{addLearner?.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {addLearner?.reference && (
                      <span className="font-mono font-semibold text-foreground">{addLearner.reference} · </span>
                    )}
                    {addLearner?.email}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setChoosingLearner(true)}
                  disabled={pending}
                  className="shrink-0 text-sm font-semibold text-accent underline-offset-2 hover:underline disabled:opacity-50"
                >
                  Change
                </button>
              </div>
            </div>
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
          if (!addLearner) {
            setError("Choose a learner first.");
            return;
          }
          run(
            addEnrolmentAction({
              cohortId: target.cohortId,
              userId: addLearner.id,
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
                <span className="text-xs text-muted-foreground">No other cohort shares this offer yet.</span>
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
