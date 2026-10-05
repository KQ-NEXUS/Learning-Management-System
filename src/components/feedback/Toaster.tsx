"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

/**
 * App-wide confirmations (owner request, 2026-10-04).
 *
 * Before this, an action that worked usually said nothing: a dialog closed and
 * the page quietly refreshed. Every screen improvised its own feedback and most
 * skipped the success case. This is the one place a screen says "that happened":
 *
 *   const toast = useToast();
 *   toast.success("Learner withdrawn");
 *
 * Messages appear as small cards in the bottom-right corner, newest at the
 * bottom. A success or information message fades after `AUTO_DISMISS_MS`; an
 * error stays until it is closed, because it usually needs acting on. Hovering
 * or focusing a card holds it open. Each is announced to screen readers: a
 * success politely, an error at once.
 *
 * An error that belongs to a field or a dialog should STILL be shown there,
 * next to what failed. A toast is for the outcome of an action, not a
 * replacement for inline validation.
 *
 * `useToast()` outside a provider returns no-ops, so a component that uses it
 * can be rendered on its own (in a test, in a story) without a wrapper.
 */

export const AUTO_DISMISS_MS = 5000;
const MAX_VISIBLE = 4;

export type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; message: string };

export type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const NOOP: ToastApi = { success: () => {}, error: () => {}, info: () => {} };
const ToastContext = createContext<ToastApi>(NOOP);

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const TONE: Record<ToastTone, { icon: typeof Info; iconClass: string; border: string }> = {
  success: { icon: CheckCircle2, iconClass: "text-success", border: "border-success/40" },
  error: { icon: CircleAlert, iconClass: "text-danger", border: "border-danger/40" },
  info: { icon: Info, iconClass: "text-accent", border: "border-border" },
};

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: (id: number) => void }) {
  const [held, setHeld] = useState(false);
  const { icon: Icon, iconClass, border } = TONE[toast.tone];
  const persistent = toast.tone === "error";

  useEffect(() => {
    if (persistent || held) return;
    const timer = window.setTimeout(() => onClose(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [held, onClose, persistent, toast.id]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={`toast-in pointer-events-auto flex items-start gap-3 rounded-lg border ${border} bg-surface p-4 shadow-card`}
    >
      <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${iconClass}`} />
      <p className="min-w-0 flex-1 text-sm font-medium break-words text-foreground">{toast.message}</p>
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        aria-label="Dismiss message"
        className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const close = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, message: string) => {
    const text = message.trim();
    if (!text) return;
    setToasts((current) => {
      // The same message twice in a row (a double click, a re-render) is shown once.
      if (current.some((toast) => toast.tone === tone && toast.message === text)) return current;
      return [...current, { id: nextId.current++, tone, message: text }].slice(-MAX_VISIBLE);
    });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Above dialogs (z-50), so the result of a dialog's action is never hidden behind its backdrop. */}
      <div
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onClose={close} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
