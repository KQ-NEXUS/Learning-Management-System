"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmManualPaymentAction } from "./actions";

/**
 * "Confirm manual payment" — the PAY-03 dialog (07-UI-SPEC §0.3, §6.1, §7.6).
 *
 * Built on the `PublishDialog.tsx` precedent, not a bare `ConfirmModal`:
 * structured fields (amount, currency, date, channel, reference,
 * evidence/note) plus a mandatory `MIN_REASON = 10`-character reason, and the
 * same focus-trap/ESC/return-focus behaviour `ConfirmModal` and
 * `PublishDialog` both already establish, reused verbatim rather than
 * re-derived.
 *
 * PLANNER ASSUMPTION (07-UI-SPEC §8, unresolved): neither `07-CONTEXT.md` nor
 * the source implementation plan specifies a maximum length or control type
 * for the evidence/note field. This assumes a multi-line `<textarea>` with a
 * 2000-character maximum, matching `ConfirmModal`'s own reason-field control
 * type for consistency within the dialog family — not a verified fit, and
 * flagged for confirmation or override at UAT rather than presented as
 * decided.
 */

const MIN_REASON = 10;
const MAX_EVIDENCE = 2000;

const CURRENCY_OPTIONS = ["NGN", "USD"] as const;
type ManualCurrency = (typeof CURRENCY_OPTIONS)[number];

function toManualCurrency(value: string): ManualCurrency {
  return value === "USD" ? "USD" : "NGN";
}

const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const FIELD_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-foreground";
const FIELD_INPUT =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:bg-surface-2";

export type ManualPaymentDialogProps = {
  orderId: string;
  /** The Order's own snapshot currency — pre-selects the currency field. */
  currency: string;
};

export function ManualPaymentDialog({ orderId, currency }: ManualPaymentDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  async function submit(input: {
    amountMinor: number;
    currency: ManualCurrency;
    manualPaidAt: string;
    manualChannel: string;
    manualReference: string;
    manualEvidenceKey: string;
    reason: string;
  }) {
    setPending(true);
    setError(null);
    const result = await confirmManualPaymentAction({ orderId, ...input });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    // ALREADY_PAID (a race between page load and submit) and a normal
    // ACTIVATED/EXCEPTION outcome are both handled the same way: close the
    // dialog and let the server-rendered page — the source of truth for
    // PAY-04's already-paid banner — re-render.
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BTN_PRIMARY}>
        Confirm manual payment
      </button>
      {open && (
        <ManualPaymentDialogBody
          currency={currency}
          pending={pending}
          error={error}
          onCancel={close}
          onConfirm={submit}
        />
      )}
    </>
  );
}

type ManualPaymentDialogBodyProps = {
  currency: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: {
    amountMinor: number;
    currency: ManualCurrency;
    manualPaidAt: string;
    manualChannel: string;
    manualReference: string;
    manualEvidenceKey: string;
    reason: string;
  }) => void | Promise<void>;
};

function ManualPaymentDialogBody({
  currency,
  pending,
  error,
  onCancel,
  onConfirm,
}: ManualPaymentDialogBodyProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [amount, setAmount] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState<ManualCurrency>(toManualCurrency(currency));
  const [date, setDate] = useState("");
  const [channel, setChannel] = useState("");
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");

  // Move focus into the dialog on open, and return it to whatever opened it
  // on close — `ConfirmModal`/`PublishDialog`'s shared precedent.
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
  const amountValid = Number.isInteger(amountMinor) && amountMinor > 0;
  const reasonValid = reason.trim().length >= MIN_REASON;
  const canConfirm =
    amountValid &&
    Boolean(date) &&
    channel.trim().length > 0 &&
    reference.trim().length > 0 &&
    evidence.trim().length > 0 &&
    reasonValid &&
    !pending;

  function submit() {
    if (!canConfirm) return;
    onConfirm({
      amountMinor,
      currency: selectedCurrency,
      manualPaidAt: date,
      manualChannel: channel.trim(),
      manualReference: reference.trim(),
      manualEvidenceKey: evidence.trim(),
      reason: reason.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-card"
      >
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Integrity action
          </span>
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            Confirm manual payment
          </h2>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-danger">Action not applied</p>
            <p className="mt-1 text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className={FIELD_LABEL} htmlFor="manual-amount">
              Amount (minor units)
            </label>
            <input
              id="manual-amount"
              type="number"
              min={1}
              step={1}
              disabled={pending}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${FIELD_INPUT} font-mono`}
              placeholder="e.g. 45675000"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className={FIELD_LABEL} htmlFor="manual-currency">
              Currency
            </label>
            <select
              id="manual-currency"
              disabled={pending}
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(toManualCurrency(e.target.value))}
              className={FIELD_INPUT}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className={FIELD_LABEL} htmlFor="manual-date">
              Date
            </label>
            <input
              id="manual-date"
              type="date"
              disabled={pending}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${FIELD_INPUT} font-mono`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className={FIELD_LABEL} htmlFor="manual-channel">
              Channel
            </label>
            <input
              id="manual-channel"
              type="text"
              disabled={pending}
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className={FIELD_INPUT}
              placeholder="e.g. Bank transfer"
            />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className={FIELD_LABEL} htmlFor="manual-reference">
              Reference
            </label>
            <input
              id="manual-reference"
              type="text"
              disabled={pending}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={`${FIELD_INPUT} font-mono`}
              placeholder="e.g. bank statement transaction id"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="manual-evidence">
            Evidence / note
          </label>
          {/* Multi-line, 2000-char max — a planner assumption; see this file's
              own header comment (07-UI-SPEC §8 unresolved). */}
          <textarea
            id="manual-evidence"
            rows={3}
            maxLength={MAX_EVIDENCE}
            disabled={pending}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            className={FIELD_INPUT}
            placeholder="e.g. reference to the bank statement or receipt held on file"
          />
          <p className="font-mono text-[11px] text-muted-foreground">
            {evidence.trim().length} / {MAX_EVIDENCE} maximum
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="manual-reason">
            Reason for manual confirmation
            <span className="ml-1 font-normal text-muted-foreground" aria-hidden>
              required
            </span>
          </label>
          <textarea
            id="manual-reason"
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
          <button type="button" disabled={!canConfirm} onClick={submit} className={BTN_PRIMARY}>
            {pending ? "Confirming…" : "Confirm payment"}
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
