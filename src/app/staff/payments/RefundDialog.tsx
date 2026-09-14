"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { recordRefundAction } from "./actions";

/**
 * "Record a refund" — the PAY-05 dialog (07-UI-SPEC §0.3, §6.1, §7.6).
 *
 * Built on the `PublishDialog.tsx` precedent, not a bare `ConfirmModal`:
 * structured fields (amount, access decision) plus a mandatory
 * `MIN_REASON = 10`-character reason, `tone="danger"` (a refund reverses
 * money already settled), and the same focus-trap/ESC/return-focus
 * behaviour `ConfirmModal`/`PublishDialog` already establish.
 *
 * The remaining-eligible-amount hint renders ABOVE the amount field (07-UI-
 * SPEC §7.6) so the cap the server enforces is visible before the staff
 * member types a number, not only as a rejection after submit — the amount
 * field's own `max` mirrors that same cap as a courtesy; `recordRefund`
 * (07-08) is the actual enforcement, not this input attribute (RBAC-06's
 * "hidden control is presentation, not the gate" reasoning applied to a
 * value ceiling instead of a permission).
 *
 * `accessDecision` (RETAINED/REVOKED) is a required field on `recordRefund`
 * with no locked copy in 07-UI-SPEC — a Rule 2 addition (missing critical
 * functionality: the dialog could not call the service at all without it).
 */

const MIN_REASON = 10;

const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_DANGER =
  "rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const FIELD_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-foreground";
const FIELD_INPUT =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:bg-surface-2";

function formatAmount(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100);
  } catch {
    return `${amountMinor} minor units ${currency}`;
  }
}

export type RefundDialogProps = {
  orderId: string;
  currency: string;
  /** The learner total minus every non-FAILED recorded refund — the cap this dialog's hint states. */
  eligibleRefundMinor: number;
};

export function RefundDialog({ orderId, currency, eligibleRefundMinor }: RefundDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  async function submit(input: { amountMinor: number; accessDecision: "RETAINED" | "REVOKED"; reason: string }) {
    setPending(true);
    setError(null);
    const result = await recordRefundAction({ orderId, ...input });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BTN_DANGER}>
        Record a refund
      </button>
      {open && (
        <RefundDialogBody
          currency={currency}
          eligibleRefundMinor={eligibleRefundMinor}
          pending={pending}
          error={error}
          onCancel={close}
          onConfirm={submit}
        />
      )}
    </>
  );
}

type RefundDialogBodyProps = {
  currency: string;
  eligibleRefundMinor: number;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: { amountMinor: number; accessDecision: "RETAINED" | "REVOKED"; reason: string }) => void | Promise<void>;
};

function RefundDialogBody({
  currency,
  eligibleRefundMinor,
  pending,
  error,
  onCancel,
  onConfirm,
}: RefundDialogBodyProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [amount, setAmount] = useState("");
  const [accessDecision, setAccessDecision] = useState<"RETAINED" | "REVOKED">("RETAINED");
  const [reason, setReason] = useState("");

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    );
    (focusable && focusable.length > 0 ? focusable[0] : dialogRef.current)?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onCancel]);

  const amountMinor = Number.parseInt(amount, 10);
  const amountValid = Number.isInteger(amountMinor) && amountMinor > 0 && amountMinor <= eligibleRefundMinor;
  const reasonValid = reason.trim().length >= MIN_REASON;
  const canConfirm = amountValid && reasonValid && !pending;

  function submit() {
    if (!canConfirm) return;
    onConfirm({ amountMinor, accessDecision, reason: reason.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-card"
      >
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Integrity action
          </span>
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            Record a refund
          </h2>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-danger">Action not applied</p>
            <p className="mt-1 text-sm text-danger">{error}</p>
          </div>
        )}

        {/* §6.1 — the cap is visible BEFORE the amount field, not only as a
            rejection after submit. */}
        <p className="text-sm text-muted-foreground">
          Up to {formatAmount(eligibleRefundMinor, currency)} can be refunded.
        </p>

        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="refund-amount">
            Amount (minor units)
          </label>
          <input
            id="refund-amount"
            type="number"
            min={1}
            max={eligibleRefundMinor}
            step={1}
            disabled={pending}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${FIELD_INPUT} font-mono`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="refund-access-decision">
            Access after refund
          </label>
          <select
            id="refund-access-decision"
            disabled={pending}
            value={accessDecision}
            onChange={(e) => setAccessDecision(e.target.value as "RETAINED" | "REVOKED")}
            className={FIELD_INPUT}
          >
            <option value="RETAINED">Learner keeps enrolment access</option>
            <option value="REVOKED">Revoke enrolment access</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="refund-reason">
            Reason for refund
            <span className="ml-1 font-normal text-muted-foreground" aria-hidden>
              required
            </span>
          </label>
          <textarea
            id="refund-reason"
            rows={3}
            disabled={pending}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={!reasonValid ? true : undefined}
            className={`${FIELD_INPUT} aria-[invalid=true]:border-danger`}
          />
          <p
            aria-live="polite"
            className={`font-mono text-[11px] ${reasonValid ? "text-muted-foreground" : "text-danger"}`}
          >
            {reason.trim().length} / {MIN_REASON} minimum
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button type="button" disabled={!canConfirm} onClick={submit} className={BTN_DANGER}>
            {pending ? "Recording…" : "Record refund"}
          </button>
          <button type="button" onClick={onCancel} disabled={pending} className={BTN}>
            Cancel
          </button>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {pending ? "ESC suppressed" : "ESC cancels"}
          </span>
        </div>
      </div>
    </div>
  );
}
