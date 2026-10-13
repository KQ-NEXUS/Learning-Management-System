"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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

// Dialogs can stack: the person picker opens on top of the session form. Each registers here
// while open, and only the last one in (the one on top) handles Escape and Tab, so Escape closes
// the picker and leaves the form behind it open.
const openDialogs: symbol[] = [];

export function FormDialog(props: FormDialogProps) {
  if (!props.open) return null;
  return <Dialog {...props} />;
}

function Dialog({ title, pending = false, onClose, children }: FormDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // How many dialogs were open when this one mounted, counting itself: its place in the stack.
  const [depth] = useState(() => openDialogs.length + 1);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const firstField = dialogRef.current?.querySelector<HTMLElement>("input, select, textarea");
    (firstField ?? dialogRef.current)?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const token = Symbol("form-dialog");
    openDialogs.push(token);
    return () => {
      const index = openDialogs.indexOf(token);
      if (index >= 0) openDialogs.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Not the dialog on top: the one above this handles the key.
      if (dialogRef.current?.dataset.dialogDepth !== String(openDialogs.length)) return;
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
    // `items-start` with `my-auto` on the panel: centred when it fits, and scrollable from its
    // very top when it does not. Centring with `items-center` would cut the top off a tall form.
    <div
      className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4"
      // A dialog opened from another sits above it.
      style={{ zIndex: 50 + depth }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-dialog-depth={depth}
        className="my-auto flex w-full max-w-xl flex-col gap-4 rounded-xl bg-surface p-6 shadow-card"
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
