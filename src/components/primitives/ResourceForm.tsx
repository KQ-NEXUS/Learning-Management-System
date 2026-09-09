"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// The link/plain-text decision reads child DOM that only exists after commit,
// so it must run synchronously before paint to avoid a flash of the wrong
// element. `useLayoutEffect` warns during SSR, where there is nothing to
// measure, so fall back to `useEffect` on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * ResourceForm — the create/edit primitive.
 *
 * Behaviours carried over from the design spec:
 *   - An error summary at the top links to each offending field, and receives
 *     focus after a failed submit (WCAG 2.2 AA, PRD NFR-09).
 *   - Fields validate on blur, not on every keystroke.
 *   - Cross-field errors (for example "exactly one of course or programme")
 *     appear in the summary, since they belong to no single input. These have
 *     no `field-<name>` control to focus, so they render as plain alert text
 *     rather than as a link that would go nowhere (WR-02).
 *   - Field errors only become links once a matching `field-<name>` control is
 *     actually present in this form; an error for an absent field stays as
 *     plain text so the summary never contains a dead link.
 *   - A failed save never shows success and never clears the entered values.
 */

export type FieldError = {
  /**
   * Matches a FormField `name`. If a control with id `field-<name>` exists in
   * this form the summary links to it; otherwise the message is shown as plain
   * text (cross-field / form-level failures, or fields not rendered yet).
   */
  name: string;
  message: string;
};

export type ResourceFormState =
  | { status: "ready" }
  | { status: "loading" }
  | { status: "denied"; permission?: string }
  | { status: "error"; message?: string };

export type ResourceFormProps = {
  title: string;
  subtitle?: ReactNode;
  /** e.g. "Draft saved 14:02 WAT". Absent when there is no draft. */
  draftStatus?: string;
  errors?: FieldError[];
  state?: ResourceFormState;
  submitLabel?: string;
  pending?: boolean;
  onSubmit: (formData: FormData) => void | Promise<void>;
  onCancel?: () => void;
  onRetry?: () => void;
  children: ReactNode;
};

const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export function ResourceForm({
  title,
  subtitle,
  draftStatus,
  errors = [],
  state = { status: "ready" },
  submitLabel = "Save",
  pending = false,
  onSubmit,
  onCancel,
  onRetry,
  children,
}: ResourceFormProps) {
  const summaryId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Which error names resolve to a real `field-<name>` control *inside this
  // form*. Recomputed after every render because the offending fields are
  // rendered as children and only exist in the DOM after mount/update. An
  // error whose target is missing (cross-field failures, form-level failures,
  // or a field not currently rendered) stays as plain text — never a link
  // that leads nowhere (WR-02).
  const [linkableNames, setLinkableNames] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useIsomorphicLayoutEffect(() => {
    const form = formRef.current;
    if (!form) {
      if (linkableNames.size > 0) setLinkableNames(new Set());
      return;
    }
    const presentIds = new Set(
      Array.from(form.querySelectorAll<HTMLElement>("[id]")).map((el) => el.id),
    );
    const next = new Set(
      errors
        .filter((error) => presentIds.has(`field-${error.name}`))
        .map((error) => error.name),
    );
    const unchanged =
      next.size === linkableNames.size &&
      [...next].every((name) => linkableNames.has(name));
    if (!unchanged) setLinkableNames(next);
  }, [errors, linkableNames]);

  // Move focus to the error summary whenever it appears — the summary is
  // the first thing a screen reader user needs after a failed submit
  // (WCAG 2.2 AA, NFR-09). tabIndex={-1} on the summary makes it a valid
  // focus target without adding it to the normal tab order.
  useEffect(() => {
    if (errors.length > 0) {
      summaryRef.current?.focus();
    }
  }, [errors]);

  if (state.status === "denied") {
    return (
      <div className="mx-auto flex w-full max-w-[700px] flex-col items-start gap-2 rounded-xl border border-border bg-surface px-6 py-12 shadow-card">
        <span className="font-mono text-[11px] tracking-wide text-muted-foreground">403</span>
        <p className="text-sm font-semibold text-foreground">Editing needs additional permission</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Your role does not include{" "}
          {state.permission ? (
            <code className="rounded-sm bg-surface-2 px-1 font-mono text-[11px]">
              {state.permission}
            </code>
          ) : (
            "the required permission"
          )}{" "}
          at this scope. Ask a workspace administrator to grant it.
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-[700px] flex-col items-start gap-2 rounded-xl border border-border bg-surface px-6 py-12 shadow-card">
        <p className="text-sm font-semibold text-foreground">Could not load this record</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          {state.message ?? "The request failed. Nothing has been changed."}
        </p>
        {onRetry && (
          <button type="button" onClick={onRetry} className={BTN}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        aria-busy
        className="mx-auto flex w-full max-w-[700px] flex-col gap-4 rounded-xl border border-border bg-surface px-6 py-6 shadow-card"
      >
        <span className="h-4 w-48 animate-pulse rounded-sm bg-surface-2" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="h-2.5 w-24 animate-pulse rounded-sm bg-surface-2" />
            <span className="h-8 w-full animate-pulse rounded-sm bg-surface-2" />
          </div>
        ))}
        <p aria-live="polite" className="sr-only">
          Loading form
        </p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      noValidate
      className="mx-auto flex w-full max-w-[700px] flex-col rounded-xl border border-border bg-surface shadow-card"
    >
      <div className="flex flex-col gap-4 px-6 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>

        {errors.length > 0 && (
          <div
            ref={summaryRef}
            role="alert"
            aria-labelledby={summaryId}
            tabIndex={-1}
            className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2"
          >
            <p id={summaryId} className="text-sm font-semibold text-danger">
              {errors.length} {errors.length === 1 ? "issue needs" : "issues need"}{" "}
              attention before this can be saved
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {errors.map((error) => (
                <li key={error.name}>
                  {linkableNames.has(error.name) ? (
                    <a
                      href={`#field-${error.name}`}
                      className="text-sm text-danger underline underline-offset-2"
                    >
                      {error.message}
                    </a>
                  ) : (
                    <span className="text-sm text-danger">{error.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-4">{children}</div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-b-xl border-t border-border bg-surface-2 px-6 py-4">
        {draftStatus && (
          <p className="font-mono text-[11px] text-muted-foreground">{draftStatus}</p>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Saving…" : submitLabel}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className={BTN}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

export type FormFieldProps = {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    name: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
};

/**
 * Wires a control to its label, hint, and error.
 *
 * The render-prop shape exists so the aria wiring cannot be forgotten: there
 * is no way to render a control here without receiving the ids it needs.
 */
export function FormField({
  name,
  label,
  hint,
  error,
  required,
  children,
}: FormFieldProps) {
  const id = `field-${name}`;
  const errorId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
        {required && (
          <span className="ml-1 text-[11px] font-normal text-muted-foreground" aria-hidden>
            required
          </span>
        )}
      </label>

      {children({
        id,
        name,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}

      {hint && !error && (
        <p id={hintId} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The default text control, styled to match the spec sheet. */
export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean },
) {
  const { mono, className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger ${
        mono ? "font-mono tabular-nums" : ""
      } ${className ?? ""}`}
    />
  );
}
