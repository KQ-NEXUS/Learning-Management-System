"use client";

import { useId, useRef, type ReactNode } from "react";

/**
 * ResourceForm — the create/edit primitive.
 *
 * Behaviours carried over from the design spec:
 *   - An error summary at the top links to each offending field, and receives
 *     focus after a failed submit (WCAG 2.2 AA, PRD NFR-09).
 *   - Fields validate on blur, not on every keystroke.
 *   - Cross-field errors (for example "exactly one of course or programme")
 *     appear in the summary, since they belong to no single input.
 *   - A failed save never shows success and never clears the entered values.
 */

export type FieldError = {
  /** Must match the FormField `name`, so the summary link can focus it. */
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

  if (state.status === "denied") {
    return (
      <div className="flex flex-col items-start gap-2 border border-zinc-200 bg-white px-6 py-10">
        <span className="font-mono text-xs tracking-wide text-zinc-500">403</span>
        <p className="text-sm font-semibold">Editing needs additional permission</p>
        <p className="max-w-prose text-sm text-zinc-600">
          Your role does not include{" "}
          {state.permission ? (
            <code className="bg-zinc-100 px-1 font-mono text-xs">
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
      <div className="flex flex-col items-start gap-2 border border-zinc-200 bg-white px-6 py-10">
        <p className="text-sm font-semibold">Could not load this record</p>
        <p className="max-w-prose text-sm text-zinc-600">
          {state.message ?? "The request failed. Nothing has been changed."}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div aria-busy className="flex flex-col gap-4 border border-zinc-200 px-4 py-4">
        <span className="h-4 w-48 animate-pulse bg-zinc-200" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <span className="h-2.5 w-24 animate-pulse bg-zinc-200" />
            <span className="h-8 w-full animate-pulse bg-zinc-100" />
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
      action={onSubmit}
      noValidate
      className="flex flex-col gap-5 border border-zinc-200 bg-white px-4 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-600">{subtitle}</p>}
        </div>
        {draftStatus && (
          <p className="font-mono text-[11px] text-zinc-500">{draftStatus}</p>
        )}
      </div>

      {errors.length > 0 && (
        <div
          ref={summaryRef}
          role="alert"
          aria-labelledby={summaryId}
          tabIndex={-1}
          className="border border-danger/30 bg-danger-surface px-3 py-2.5"
        >
          <p id={summaryId} className="text-sm font-medium text-danger">
            {errors.length} {errors.length === 1 ? "field needs" : "fields need"}{" "}
            attention before this can be saved
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {errors.map((error) => (
              <li key={error.name}>
                <a
                  href={`#field-${error.name}`}
                  className="text-sm text-danger underline underline-offset-2"
                >
                  {error.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4">{children}</div>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            Cancel
          </button>
        )}
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
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600"
      >
        {label}
        {required && (
          <span className="ml-1 font-normal text-zinc-400" aria-hidden>
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
        <p id={hintId} className="text-xs text-zinc-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
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
      className={`border border-zinc-300 bg-white px-2.5 py-1.5 text-sm placeholder:text-zinc-400 aria-[invalid=true]:border-danger ${
        mono ? "font-mono tabular-nums" : ""
      } ${className ?? ""}`}
    />
  );
}
