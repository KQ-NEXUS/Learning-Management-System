"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * FormDialog — a pop-up that holds a short form.
 *
 * Built for the session calendar: clicking a day opens the session form here,
 * on top of the calendar, instead of in a panel further down the page. It
 * follows `ConfirmModal`'s rules for a modal: focus moves in when it opens and
 * back to whatever opened it when it closes, Tab stays inside it, and Escape
 * or the Close button dismisses it (not while a save is in flight).
 *
 * The caller owns the form, its buttons and its state; this is only the frame.
 */
export type FormDialogProps = {
  open: boolean;
  title: string;
  /** A save is in flight: Escape and Close are ignored so the outcome is never ambiguous. */
  pending?: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function FormDialog(props: FormDialogProps) {
  if (!props.open) return null;
  return <Dialog {...props} />;
}

function Dialog({ title, pending = false, onClose, children }: FormDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const firstField = dialogRef.current?.querySelector<HTMLElement>("input, select, textarea");
    (firstField ?? dialogRef.current)?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
  }, [pending, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex w-full max-w-xl flex-col gap-4 rounded-xl bg-surface p-6 shadow-card"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X aria-hidden className="size-4" />
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
