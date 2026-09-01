"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * ConfirmModal — the integrity-action primitive.
 *
 * Used for the actions PRD §7.3 requires a reason for: manual payment
 * confirmation, refunds, grade overrides, attendance corrections, certificate
 * revocation, role changes, sensitive exports.
 *
 * Behaviours carried over from the design spec:
 *   - Confirm stays disabled until the reason meets its minimum, with a live
 *     counter rather than an error after the fact.
 *   - Focus is trapped while open and returned to the trigger on close.
 *   - ESC cancels — but is suppressed while the action is in flight, so a
 *     stray keypress cannot leave the user unsure whether it applied.
 *   - A failed action says "action not applied" explicitly. Ambiguity about
 *     whether money moved is the worst possible outcome here.
 */

export type ConfirmModalProps = {
  open: boolean;
  /** Small caps label, e.g. "Integrity action". */
  eyebrow?: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "default";
  /** When set, a reason of at least this many characters is required. */
  minReasonLength?: number;
  reasonLabel?: string;
  pending?: boolean;
  /** Rendered as "action not applied" — the action did not take effect. */
  error?: string | null;
  onConfirm: (reason: string) => void | Promise<void>;
  onCancel: () => void;
};

/**
 * The dialog body only mounts while open, so the reason field resets by
 * unmounting rather than by an effect that writes state during render.
 */
export function ConfirmModal(props: ConfirmModalProps) {
  if (!props.open) return null;
  return <ConfirmDialog {...props} />;
}

function ConfirmDialog({
  eyebrow = "Integrity action",
  title,
  description,
  confirmLabel,
  tone = "danger",
  minReasonLength,
  reasonLabel = "Reason",
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const titleId = useId();
  const reasonId = useId();
  const counterId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const requiresReason = typeof minReasonLength === "number";
  const reasonValid = !requiresReason || reason.trim().length >= minReasonLength;
  const canConfirm = reasonValid && !pending;

  // Move focus in, and return it to whatever opened the dialog on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (reasonRef.current ?? confirmRef.current)?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Suppressed while in flight — cancelling mid-action would leave the
      // user unsure whether it applied.
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

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

  const confirmClasses =
    tone === "danger"
      ? "bg-danger text-white hover:opacity-90"
      : "bg-accent text-accent-contrast hover:opacity-90";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-4 border border-zinc-300 bg-white p-5 shadow-lg"
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            {eyebrow}
          </span>
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          <div className="text-sm text-zinc-600">{description}</div>
        </div>

        {error && (
          <div
            role="alert"
            className="border border-danger/30 bg-danger-surface px-3 py-2"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-danger">
              Action not applied
            </p>
            <p className="mt-0.5 text-sm text-danger">{error}</p>
          </div>
        )}

        {requiresReason && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={reasonId}
              className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600"
            >
              {reasonLabel}
              <span className="ml-1 font-normal text-zinc-400" aria-hidden>
                required
              </span>
            </label>
            <textarea
              id={reasonId}
              ref={reasonRef}
              rows={3}
              value={reason}
              disabled={pending}
              aria-invalid={touched && !reasonValid ? true : undefined}
              aria-describedby={counterId}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              className="border border-zinc-300 px-2.5 py-1.5 text-sm aria-[invalid=true]:border-danger disabled:bg-zinc-50"
            />
            <p
              id={counterId}
              aria-live="polite"
              className={`font-mono text-[11px] ${
                touched && !reasonValid ? "text-danger" : "text-zinc-500"
              }`}
            >
              {reason.trim().length} / {minReasonLength} minimum
              {reasonValid && reason.length > 0 ? " · valid" : ""}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4">
          <button
            type="button"
            ref={confirmRef}
            disabled={!canConfirm}
            aria-disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm(reason.trim())}
            className={`px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${confirmClasses}`}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <span className="ml-auto font-mono text-[10px] text-zinc-400">
            {pending ? "ESC suppressed" : "ESC cancels"}
          </span>
        </div>
      </div>
    </div>
  );
}
